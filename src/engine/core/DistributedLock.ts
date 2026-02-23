import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';
import { redisCache } from '../../services/redis-cache.service.js';
import { LedgerLockTimeoutError } from '../types/errors.js';
import { getEngineConfig } from '../config/loader.js';

export interface LockHandle {
  key: string;
  token: string;
  acquiredAt: number;
  release: () => Promise<boolean>;
}

export class DistributedLock {
  private readonly prefix = 'lock:account:';

  async acquire(accountId: string): Promise<LockHandle> {
    const config = getEngineConfig();
    const ttlSeconds = config.timeouts.lockTTLSeconds;
    const timeoutMs = config.timeouts.lockAcquisitionMs;

    const key = `${this.prefix}${accountId}`;
    const token = randomUUID();
    const startMs = Date.now();

    while (Date.now() - startMs < timeoutMs) {
      const acquired = await this.tryAcquire(key, token, ttlSeconds);
      if (acquired) {
        logger.debug('Distributed lock acquired', { accountId, key, token });
        return {
          key,
          token,
          acquiredAt: Date.now(),
          release: () => this.release(key, token),
        };
      }
      await sleep(25);
    }

    logger.warn('Distributed lock acquisition timeout', { accountId, key, timeoutMs });
    throw new LedgerLockTimeoutError(accountId, timeoutMs);
  }

  private async tryAcquire(key: string, token: string, ttlSeconds: number): Promise<boolean> {
    if (!redisCache.isAvailable()) {
      logger.warn('Redis not available for distributed lock, allowing fallback');
      return true;
    }

    try {
      // SET key token NX EX ttl — atomic acquire
      const client = (redisCache as any).client;
      if (!client) return true;

      const result = await client.set(key, token, 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (error) {
      logger.error('Distributed lock acquire error', error as Error, { key });
      return false;
    }
  }

  async release(key: string, token: string): Promise<boolean> {
    if (!redisCache.isAvailable()) {
      return true;
    }

    try {
      const client = (redisCache as any).client;
      if (!client) return true;

      // Lua script: only delete if value matches our token (safe release)
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      const result = await client.eval(script, 1, key, token);
      const released = result === 1;

      if (released) {
        logger.debug('Distributed lock released', { key, token });
      } else {
        logger.warn('Distributed lock release failed — token mismatch or expired', { key, token });
      }

      return released;
    } catch (error) {
      logger.error('Distributed lock release error', error as Error, { key });
      return false;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const distributedLock = new DistributedLock();
