// Rate Limiter Service: Token bucket algorithm for API throttling
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

interface TokenBucket {
  tokens: number;
  capacity: number;
  refillRate: number;
  lastRefill: number;
}

interface RateLimiterStats {
  provider: string;
  capacity: number;
  currentTokens: number;
  utilizationPercent: string;
  requestsAllowed: number;
  requestsBlocked: number;
}

export class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private requestsAllowed: Map<string, number> = new Map();
  private requestsBlocked: Map<string, number> = new Map();

  constructor() {
    // Initialize rate limiters for different providers
    this.createBucket('alpaca', config.alpacaRateLimit, 60000); // 200 req/min
    this.createBucket('twelvedata', config.twelveDataRateLimit, 86400000); // 800 req/day
  }

  private createBucket(
    provider: string,
    capacity: number,
    refillIntervalMs: number
  ): void {
    const refillRate = capacity / refillIntervalMs;
    this.buckets.set(provider, {
      tokens: capacity,
      capacity,
      refillRate,
      lastRefill: Date.now(),
    });
    this.requestsAllowed.set(provider, 0);
    this.requestsBlocked.set(provider, 0);
    logger.info(`Rate limiter created for ${provider}`, { capacity, refillIntervalMs });
  }

  private refillBucket(bucket: TokenBucket): void {
    const now = Date.now();
    const timePassed = now - bucket.lastRefill;
    const tokensToAdd = timePassed * bucket.refillRate;

    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
  }

  async tryAcquire(provider: string, tokens: number = 1): Promise<boolean> {
    const bucket = this.buckets.get(provider);
    if (!bucket) {
      logger.error(`Rate limiter not found for provider: ${provider}`);
      return true; // Fail open
    }

    this.refillBucket(bucket);

    // Check if approaching limit (90%)
    const utilizationPercent = ((bucket.capacity - bucket.tokens) / bucket.capacity) * 100;
    if (utilizationPercent >= 90) {
      logger.warn(`Rate limit approaching for ${provider}`, {
        utilizationPercent: utilizationPercent.toFixed(2),
        tokensRemaining: bucket.tokens,
      });
    }

    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      this.requestsAllowed.set(provider, (this.requestsAllowed.get(provider) || 0) + 1);
      logger.debug(`Rate limit acquired for ${provider}`, {
        tokensUsed: tokens,
        tokensRemaining: bucket.tokens,
      });
      return true;
    }

    this.requestsBlocked.set(provider, (this.requestsBlocked.get(provider) || 0) + 1);
    logger.warn(`Rate limit exceeded for ${provider}`, {
      tokensRequested: tokens,
      tokensAvailable: bucket.tokens,
    });
    return false;
  }

  async waitForToken(provider: string, tokens: number = 1, maxWaitMs: number = 60000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      if (await this.tryAcquire(provider, tokens)) {
        return true;
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    logger.error(`Rate limit wait timeout for ${provider}`, { maxWaitMs });
    return false;
  }

  getStats(provider: string): RateLimiterStats | null {
    const bucket = this.buckets.get(provider);
    if (!bucket) {
      return null;
    }

    this.refillBucket(bucket);

    const utilizationPercent = (
      ((bucket.capacity - bucket.tokens) / bucket.capacity) *
      100
    ).toFixed(2);

    return {
      provider,
      capacity: bucket.capacity,
      currentTokens: Math.floor(bucket.tokens),
      utilizationPercent: `${utilizationPercent}%`,
      requestsAllowed: this.requestsAllowed.get(provider) || 0,
      requestsBlocked: this.requestsBlocked.get(provider) || 0,
    };
  }

  getAllStats(): RateLimiterStats[] {
    const stats: RateLimiterStats[] = [];
    for (const provider of this.buckets.keys()) {
      const providerStats = this.getStats(provider);
      if (providerStats) {
        stats.push(providerStats);
      }
    }
    return stats;
  }

  reset(provider: string): void {
    const bucket = this.buckets.get(provider);
    if (bucket) {
      bucket.tokens = bucket.capacity;
      bucket.lastRefill = Date.now();
      this.requestsAllowed.set(provider, 0);
      this.requestsBlocked.set(provider, 0);
      logger.info(`Rate limiter reset for ${provider}`);
    }
  }

  resetAll(): void {
    for (const provider of this.buckets.keys()) {
      this.reset(provider);
    }
    logger.info('All rate limiters reset');
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();
