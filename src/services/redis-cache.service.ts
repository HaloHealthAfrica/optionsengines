// Redis Cache Manager - Handles caching with TTL-based expiration
import Redis from 'ioredis';
import { logger } from '../utils/logger.js';
import * as Sentry from '@sentry/node';

interface CacheConfig {
  ttl: {
    gex: number;        // 300 seconds (5 min)
    analytics: number;  // 900 seconds (15 min)
    performance: number; // 600 seconds (10 min)
  };
}

interface CachedResult<T> {
  data: T | null;
  hit: boolean;
  age_seconds?: number;
  ttl_remaining?: number;
}

export class RedisCacheService {
  private client: Redis | null = null;
  private config: CacheConfig;
  private isConnected = false;

  constructor() {
    this.config = {
      ttl: {
        gex: 300,        // 5 minutes
        analytics: 900,  // 15 minutes
        performance: 600, // 10 minutes
      },
    };
  }

  async connect(redisUrl?: string): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      const url = redisUrl || process.env.REDIS_URL;
      
      if (!url) {
        logger.warn('REDIS_URL not configured, caching disabled');
        return;
      }

      this.client = new Redis(url, {
        maxRetriesPerRequest: 3,
        tls: url.includes('upstash.io') ? {} : undefined, // Enable TLS for Upstash
        connectTimeout: 2000,
        enableOfflineQueue: false,
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 1000, 5000);
          logger.warn('Redis connection retry', { attempt: times, delayMs: delay });
          return delay;
        },
        reconnectOnError: (err: Error) => {
          logger.error('Redis connection error', err);
          return true;
        },
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        logger.info('Redis cache connected');
        Sentry.captureMessage('REDIS_CONNECTED', {
          level: 'info',
          tags: { stage: 'redis' },
        });
      });

      this.client.on('error', (error: Error) => {
        logger.error('Redis error', error);
        this.isConnected = false;
        Sentry.captureException(error, { tags: { stage: 'redis' } });
      });

      this.client.on('close', () => {
        this.isConnected = false;
        logger.warn('Redis connection closed');
        Sentry.captureMessage('REDIS_DISCONNECTED', {
          level: 'warning',
          tags: { stage: 'redis' },
        });
      });

      // Test connection with a timeout to avoid hanging
      const pingPromise = this.client.ping();
      const timeoutPromise = new Promise((_, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Redis ping timeout'));
        }, 2000);
        if (typeof (timeout as any).unref === 'function') {
          (timeout as any).unref();
        }
      });

      await Promise.race([pingPromise, timeoutPromise]);
      this.isConnected = true;
      logger.info('Redis cache initialized');
    } catch (error) {
      logger.error('Failed to connect to Redis', error);
      Sentry.captureException(error, { tags: { stage: 'redis', step: 'connect' } });
      if (this.client) {
        this.client.disconnect();
      }
      this.client = null;
      this.isConnected = false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
      logger.info('Redis cache disconnected');
      Sentry.captureMessage('REDIS_DISCONNECTED', {
        level: 'info',
        tags: { stage: 'redis' },
      });
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client || !this.isConnected) {
      return null;
    }

    try {
      const value = await this.client.get(key);
      if (!value) {
        return null;
      }
      return JSON.parse(value) as T;
    } catch (error) {
      logger.error('Redis get failed', { key, error });
      Sentry.captureException(error, { tags: { stage: 'redis', op: 'get' } });
      return null;
    }
  }

  async set<T>(key: string, value: T, ttl: number): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }

    try {
      const serialized = JSON.stringify(value);
      await this.client.setex(key, ttl, serialized);
    } catch (error) {
      logger.error('Redis set failed', { key, ttl, error });
      Sentry.captureException(error, { tags: { stage: 'redis', op: 'set' } });
    }
  }

  async invalidate(pattern: string): Promise<number> {
    if (!this.client || !this.isConnected) {
      return 0;
    }

    try {
      const keys = await this.client.keys(pattern);
      if (keys.length === 0) {
        return 0;
      }
      const deleted = await this.client.del(...keys);
      logger.info('Cache invalidated', { pattern, keysDeleted: deleted });
      return deleted;
    } catch (error) {
      logger.error('Redis invalidate failed', { pattern, error });
      Sentry.captureException(error, { tags: { stage: 'redis', op: 'invalidate' } });
      return 0;
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.client || !this.isConnected) {
      return false;
    }

    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Redis exists failed', { key, error });
      Sentry.captureException(error, { tags: { stage: 'redis', op: 'exists' } });
      return false;
    }
  }

  async getTTL(key: string): Promise<number> {
    if (!this.client || !this.isConnected) {
      return -1;
    }

    try {
      return await this.client.ttl(key);
    } catch (error) {
      logger.error('Redis getTTL failed', { key, error });
      Sentry.captureException(error, { tags: { stage: 'redis', op: 'ttl' } });
      return -1;
    }
  }

  buildKey(type: string, params: Record<string, any>): string {
    const paramStr = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(':');
    return `${type}:${paramStr}`;
  }

  async getCached<T>(key: string): Promise<CachedResult<T>> {
    const data = await this.get<T>(key);
    
    if (data === null) {
      return { data: null, hit: false };
    }

    const ttl = await this.getTTL(key);
    
    return {
      data,
      hit: true,
      ttl_remaining: ttl > 0 ? ttl : undefined,
    };
  }

  async setCached<T>(key: string, value: T, ttl: number): Promise<void> {
    await this.set(key, value, ttl);
  }

  getTTLForType(type: 'gex' | 'analytics' | 'performance'): number {
    return this.config.ttl[type];
  }

  isAvailable(): boolean {
    return this.isConnected && this.client !== null;
  }
}

// Singleton instance
export const redisCache = new RedisCacheService();
