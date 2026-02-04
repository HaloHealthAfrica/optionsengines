// Cache Service: In-memory caching with TTL
import NodeCache from 'node-cache';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

interface CacheStats {
  hits: number;
  misses: number;
  keys: number;
  hitRate: string;
}

export class CacheService {
  private cache: NodeCache;
  private hits: number = 0;
  private misses: number = 0;

  constructor(ttlSeconds: number = config.cacheTtlSeconds) {
    this.cache = new NodeCache({
      stdTTL: ttlSeconds,
      checkperiod: ttlSeconds * 0.2,
      useClones: false,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.cache.on('set', (key, _value) => {
      logger.debug('Cache set', { key });
    });

    this.cache.on('del', (key, _value) => {
      logger.debug('Cache delete', { key });
    });

    this.cache.on('expired', (key, _value) => {
      logger.debug('Cache expired', { key });
    });

    this.cache.on('flush', () => {
      logger.debug('Cache flushed');
    });
  }

  get<T>(key: string): T | undefined {
    const value = this.cache.get<T>(key);

    if (value !== undefined) {
      this.hits++;
      logger.debug('Cache hit', { key });
      return value;
    }

    this.misses++;
    logger.debug('Cache miss', { key });
    return undefined;
  }

  set<T>(key: string, value: T, ttl?: number): boolean {
    try {
      const success = this.cache.set(key, value, ttl || 0);
      if (success) {
        logger.debug('Cache set successful', { key, ttl });
      }
      return success;
    } catch (error) {
      logger.error('Cache set failed', error, { key });
      return false;
    }
  }

  delete(key: string): number {
    const deleted = this.cache.del(key);
    logger.debug('Cache delete', { key, deleted });
    return deleted;
  }

  deleteMany(keys: string[]): number {
    const deleted = this.cache.del(keys);
    logger.debug('Cache delete many', { count: deleted });
    return deleted;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.flushAll();
    this.hits = 0;
    this.misses = 0;
    logger.info('Cache cleared');
  }

  getStats(): CacheStats {
    const keys = this.cache.keys().length;
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? ((this.hits / total) * 100).toFixed(2) : '0.00';

    const stats: CacheStats = {
      hits: this.hits,
      misses: this.misses,
      keys,
      hitRate: `${hitRate}%`,
    };

    // Log warning if hit rate is below threshold
    if (total > 100 && parseFloat(hitRate) < 70) {
      logger.warn('Cache hit rate below 70%', stats);
    }

    return stats;
  }

  getTTL(key: string): number | undefined {
    return this.cache.getTtl(key);
  }

  setTTL(key: string, ttl: number): boolean {
    return this.cache.ttl(key, ttl);
  }

  getKeys(): string[] {
    return this.cache.keys();
  }

  // Helper method for cache-aside pattern
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await fetchFn();
    this.set(key, value, ttl);
    return value;
  }

  // Helper method for memoization
  memoize<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    keyGenerator: (...args: Parameters<T>) => string,
    ttl?: number
  ): T {
    return (async (...args: Parameters<T>) => {
      const key = keyGenerator(...args);
      return this.getOrSet(key, () => fn(...args), ttl);
    }) as T;
  }

  // Close/cleanup method for graceful shutdown
  close(): void {
    this.cache.close();
    logger.info('Cache service closed');
  }
}

// Singleton instance
export const cache = new CacheService();
