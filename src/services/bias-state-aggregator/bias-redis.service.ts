/**
 * Bias State Redis Service - Fast path for bias state.
 * Keys: bias:current:{symbol}, bias:lock:{symbol}, bias:history:{symbol}
 */

import Redis from 'ioredis';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import type { UnifiedBiasState } from '../../lib/mtfBias/types-v3.js';

const LOCK_TTL_SEC = 5;
const HISTORY_MAX = 50;
const LOCK_PREFIX = 'bias:lock:';
const CURRENT_PREFIX = 'bias:current:';
const HISTORY_PREFIX = 'bias:history:';

class BiasRedisService {
  private client: Redis | null = null;
  private isConnected = false;

  async connect(): Promise<void> {
    if (this.client || !config.redisUrl) return;

    this.client = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      tls: config.redisUrl.includes('upstash.io') ? {} : undefined,
    });

    this.client.on('error', (err) => {
      this.isConnected = false;
      logger.error('Bias Redis error', err);
    });

    try {
      await this.client.ping();
      this.isConnected = true;
      logger.info('Bias Redis connected');
    } catch (err) {
      this.isConnected = false;
      logger.warn('Bias Redis ping failed', { error: err });
    }
  }

  private async getClient(): Promise<Redis | null> {
    if (!config.redisUrl) return null;
    if (!this.client) await this.connect();
    if (!this.client || !this.isConnected) return null;
    return this.client;
  }

  /** Acquire per-symbol lock. Returns true if acquired. */
  async acquireLock(symbol: string): Promise<boolean> {
    const client = await this.getClient();
    if (!client) return false;
    const key = `${LOCK_PREFIX}${symbol.toUpperCase()}`;
    try {
      const result = await client.set(key, '1', 'EX', LOCK_TTL_SEC, 'NX');
      return result === 'OK';
    } catch (err) {
      logger.error('Bias lock acquire failed', { symbol, error: err });
      return false;
    }
  }

  /** Release lock (best-effort) */
  async releaseLock(symbol: string): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    const key = `${LOCK_PREFIX}${symbol.toUpperCase()}`;
    try {
      await client.del(key);
    } catch {
      /* ignore */
    }
  }

  /** Get current state from Redis */
  async getCurrent(symbol: string): Promise<UnifiedBiasState | null> {
    const client = await this.getClient();
    if (!client) return null;
    const key = `${CURRENT_PREFIX}${symbol.toUpperCase()}`;
    try {
      const raw = await client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as UnifiedBiasState;
    } catch (err) {
      logger.warn('Bias Redis get failed', { symbol, error: err });
      return null;
    }
  }

  /** Set current state in Redis (no TTL) */
  async setCurrent(symbol: string, state: UnifiedBiasState): Promise<boolean> {
    const client = await this.getClient();
    if (!client) return false;
    const key = `${CURRENT_PREFIX}${symbol.toUpperCase()}`;
    try {
      await client.set(key, JSON.stringify(state));
      return true;
    } catch (err) {
      logger.error('Bias Redis set failed', { symbol, error: err });
      return false;
    }
  }

  /** Push to history list, trim to last N */
  async pushHistory(symbol: string, state: UnifiedBiasState): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    const key = `${HISTORY_PREFIX}${symbol.toUpperCase()}`;
    try {
      await client.lpush(key, JSON.stringify(state));
      await client.ltrim(key, 0, HISTORY_MAX - 1);
    } catch (err) {
      logger.warn('Bias Redis history push failed', { symbol, error: err });
    }
  }

  /** Get history (last N) */
  async getHistory(symbol: string, limit: number = 50): Promise<UnifiedBiasState[]> {
    const client = await this.getClient();
    if (!client) return [];
    const key = `${HISTORY_PREFIX}${symbol.toUpperCase()}`;
    try {
      const raw = await client.lrange(key, 0, limit - 1);
      return raw.map((r) => JSON.parse(r) as UnifiedBiasState);
    } catch (err) {
      logger.warn('Bias Redis history get failed', { symbol, error: err });
      return [];
    }
  }

  /** Check idempotency: SET NX. Returns true if newly set (not duplicate). */
  async setIdempotency(eventIdHash: string, ttlSec: number): Promise<boolean> {
    const client = await this.getClient();
    if (!client) return true;
    const key = `bias:idem:${eventIdHash}`;
    try {
      const result = await client.set(key, '1', 'EX', ttlSec, 'NX');
      return result === 'OK';
    } catch {
      return true;
    }
  }

  /** Mark event as seen (for idempotency after processing) */
  async markIdempotency(eventIdHash: string, ttlSec: number): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    const key = `bias:idem:${eventIdHash}`;
    try {
      await client.set(key, '1', 'EX', ttlSec);
    } catch {
      /* ignore */
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
    }
  }
}

export const biasRedisService = new BiasRedisService();
