// Cache Warmer Service - Pre-populates cache with critical data
import { logger } from '../utils/logger.js';
import { positioningService } from './positioning.service.js';
import { redisCache } from './redis-cache.service.js';
import { db } from './database.service.js';

interface WarmingConfig {
  enabled: boolean;
  criticalSymbols: string[];
  refreshThreshold: number; // Refresh when TTL < threshold (seconds)
  retryConfig: {
    maxRetries: number;
    backoffMs: number;
  };
}

class CacheWarmerService {
  private config: WarmingConfig;
  private isWarming = false;
  private warmingInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.config = {
      enabled: true,
      criticalSymbols: ['SPY', 'QQQ'],
      refreshThreshold: 60, // Refresh when < 1 minute remaining
      retryConfig: {
        maxRetries: 3,
        backoffMs: 1000,
      },
    };
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      logger.info('Cache warming disabled');
      return;
    }

    logger.info('Starting cache warmer');
    
    // Initial warming (non-blocking)
    this.warmCriticalData().catch(err => {
      logger.error('Initial cache warming failed', err);
    });

    // Schedule proactive refresh every 5 minutes
    this.warmingInterval = setInterval(() => {
      this.warmCriticalData().catch(err => {
        logger.error('Scheduled cache warming failed', err);
      });
    }, 5 * 60 * 1000); // 5 minutes
  }

  async stop(): Promise<void> {
    if (this.warmingInterval) {
      clearInterval(this.warmingInterval);
      this.warmingInterval = null;
    }
    logger.info('Cache warmer stopped');
  }

  async warmCriticalData(): Promise<void> {
    if (this.isWarming) {
      logger.debug('Cache warming already in progress, skipping');
      return;
    }

    this.isWarming = true;
    const startTime = Date.now();

    try {
      logger.info('Warming critical cache data');

      // Warm in parallel
      await Promise.allSettled([
        this.warmGEXData(this.config.criticalSymbols),
        this.warmAnalytics(),
        this.warmSourcePerformance(),
      ]);

      const duration = Date.now() - startTime;
      logger.info('Cache warming completed', { durationMs: duration });
    } catch (error) {
      logger.error('Cache warming failed', error);
    } finally {
      this.isWarming = false;
    }
  }

  private async warmGEXData(symbols: string[]): Promise<void> {
    for (const symbol of symbols) {
      await this.retryWarming(
        `GEX-${symbol}`,
        async () => {
          const cacheKey = redisCache.buildKey('gex', { 
            symbol, 
            date: new Date().toISOString().split('T')[0] 
          });
          
          // Check if already cached and fresh
          const ttl = await redisCache.getTTL(cacheKey);
          if (ttl > this.config.refreshThreshold) {
            logger.debug('GEX cache still fresh, skipping', { symbol, ttlRemaining: ttl });
            return;
          }

          // Fetch and cache
          await positioningService.getGexSnapshot(symbol);
          logger.info('Warmed GEX cache', { symbol });
        }
      );
    }
  }

  private async warmAnalytics(): Promise<void> {
    const days = [30, 14]; // Common date ranges

    for (const dayCount of days) {
      // Warm PnL curve
      await this.retryWarming(
        `PnL-${dayCount}d`,
        async () => {
          const cacheKey = redisCache.buildKey('analytics', { 
            type: 'pnl', 
            days: dayCount.toString() 
          });
          
          const ttl = await redisCache.getTTL(cacheKey);
          if (ttl > this.config.refreshThreshold) {
            logger.debug('PnL cache still fresh, skipping', { days: dayCount, ttlRemaining: ttl });
            return;
          }

          // Fetch and cache
          const result = await db.query(
            `SELECT DATE_TRUNC('day', exit_timestamp) AS day,
                    SUM(COALESCE(realized_pnl, 0))::float AS pnl
             FROM refactored_positions
             WHERE exit_timestamp >= NOW() - ($1::int || ' days')::interval
             GROUP BY day
             ORDER BY day ASC`,
            [dayCount]
          );

          const series = result.rows.map((row: any) => ({
            date: new Date(row.day).toISOString(),
            value: Number(row.pnl ?? 0),
          }));

          let cumulative = 0;
          const data = series.map((point) => {
            cumulative += point.value;
            return { date: point.date, value: cumulative };
          });

          const cacheTTL = redisCache.getTTLForType('analytics');
          await redisCache.setCached(cacheKey, data, cacheTTL);
          logger.info('Warmed PnL cache', { days: dayCount });
        }
      );

      // Warm daily returns
      await this.retryWarming(
        `Returns-${dayCount}d`,
        async () => {
          const cacheKey = redisCache.buildKey('analytics', { 
            type: 'returns', 
            days: dayCount.toString() 
          });
          
          const ttl = await redisCache.getTTL(cacheKey);
          if (ttl > this.config.refreshThreshold) {
            logger.debug('Returns cache still fresh, skipping', { days: dayCount, ttlRemaining: ttl });
            return;
          }

          // Fetch and cache
          const result = await db.query(
            `SELECT DATE_TRUNC('day', exit_timestamp) AS day,
                    SUM(COALESCE(realized_pnl, 0))::float AS pnl
             FROM refactored_positions
             WHERE exit_timestamp >= NOW() - ($1::int || ' days')::interval
             GROUP BY day
             ORDER BY day ASC`,
            [dayCount]
          );

          const data = result.rows.map((row: any) => ({
            date: new Date(row.day).toISOString(),
            value: Number(row.pnl ?? 0),
          }));

          const cacheTTL = redisCache.getTTLForType('analytics');
          await redisCache.setCached(cacheKey, data, cacheTTL);
          logger.info('Warmed returns cache', { days: dayCount });
        }
      );
    }
  }

  private async warmSourcePerformance(): Promise<void> {
    await this.retryWarming(
      'SourcePerformance',
      async () => {
        const cacheKey = redisCache.buildKey('performance', { type: 'sources' });
        
        const ttl = await redisCache.getTTL(cacheKey);
        if (ttl > this.config.refreshThreshold) {
          logger.debug('Source performance cache still fresh, skipping', { ttlRemaining: ttl });
          return;
        }

        // Fetch and cache
        const result = await db.query(
          `SELECT
            COALESCE(raw_payload->>'source', raw_payload->>'strategy', raw_payload->>'indicator', 'unknown') AS source,
            COUNT(*)::int AS total,
            SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END)::int AS approved,
            SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END)::int AS rejected
           FROM signals
           GROUP BY source
           ORDER BY total DESC
           LIMIT 50`
        );

        const data = result.rows.map((row: any) => {
          const total = Number(row.total || 0);
          const approved = Number(row.approved || 0);
          const acceptanceRate = total ? Math.round((approved / total) * 100) : 0;

          return {
            source: row.source,
            acceptance_rate: acceptanceRate,
            win_rate: 0,
            avg_confidence: 0,
            weight: 0,
          };
        });

        const cacheTTL = redisCache.getTTLForType('performance');
        await redisCache.setCached(cacheKey, data, cacheTTL);
        logger.info('Warmed source performance cache');
      }
    );
  }

  private async retryWarming(
    name: string,
    warmFn: () => Promise<void>
  ): Promise<void> {
    const { maxRetries, backoffMs } = this.config.retryConfig;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await warmFn();
        return;
      } catch (error) {
        if (attempt === maxRetries) {
          logger.error('Cache warming failed after retries', {
            name,
            attempts: attempt + 1,
            error,
          });
          return;
        }

        const delay = backoffMs * Math.pow(2, attempt);
        logger.warn('Cache warming attempt failed, retrying', {
          name,
          attempt: attempt + 1,
          delayMs: delay,
          error,
        });

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}

export const cacheWarmer = new CacheWarmerService();
