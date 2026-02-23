import { logger } from '../../utils/logger.js';
import { redisCache } from '../../services/redis-cache.service.js';
import { getEngineConfig } from '../config/loader.js';
import { RejectionCode } from '../types/enums.js';
import { OptionsEngineError } from '../types/errors.js';
import { volSurfaceEngine } from './VolSurfaceEngine.js';
import type { VolSurfaceSnapshot } from './VolSurfaceEngine.js';

export interface VolSurfaceQueryResult {
  snapshot: VolSurfaceSnapshot;
  freshness: 'FRESH' | 'CACHED' | 'STALE';
  source: 'REDIS' | 'DB' | 'COMPUTED';
  ageSeconds: number;
}

/**
 * Fast read layer for vol surface data.
 * Live trading reads cached/precomputed results only.
 * If both Redis and DB are empty, rejects with ANALYTICS_UNAVAILABLE.
 */
export class VolSurfaceQueryService {

  /**
   * Get the latest vol surface snapshot for an underlying.
   * Reads Redis first, then DB, never computes synchronously in trade path.
   */
  async getVolSurface(underlying: string, requireFresh: boolean = false): Promise<VolSurfaceQueryResult> {
    const cfg = getEngineConfig().volSurface;
    const cacheKey = `volsurface:${underlying}`;

    // Try Redis cache first
    const cached = await redisCache.get<VolSurfaceSnapshot>(cacheKey);
    if (cached) {
      const ageSeconds = (Date.now() - new Date(cached.computedAt).getTime()) / 1000;
      const freshness = ageSeconds < cfg.redisTTLMarketHours ? 'FRESH' as const : 'CACHED' as const;

      if (!requireFresh || freshness === 'FRESH') {
        return { snapshot: cached, freshness, source: 'REDIS', ageSeconds };
      }
    }

    // Try DB
    const dbSnapshot = await volSurfaceEngine.getLatest(underlying);
    if (dbSnapshot) {
      const ageSeconds = (Date.now() - dbSnapshot.computedAt.getTime()) / 1000;
      const ttl = this.isMarketHours() ? cfg.redisTTLMarketHours : cfg.redisTTLAfterHours;

      // Populate Redis cache from DB
      await redisCache.set(cacheKey, dbSnapshot, ttl);

      const freshness = ageSeconds < ttl ? 'FRESH' as const : 'STALE' as const;

      logger.debug('Vol surface served from DB', { underlying, ageSeconds });
      return { snapshot: dbSnapshot, freshness, source: 'DB', ageSeconds };
    }

    // Nothing available — fail-closed
    throw new OptionsEngineError(
      RejectionCode.ANALYTICS_UNAVAILABLE,
      `No vol surface data available for ${underlying}`,
      { underlying }
    );
  }

  /**
   * Get vol surface for trade decision (always fail-closed if missing).
   */
  async getForTradeDecision(underlying: string): Promise<VolSurfaceSnapshot> {
    const result = await this.getVolSurface(underlying, false);
    return result.snapshot;
  }

  /**
   * Get vol surface for analytics/dashboard (returns null if missing instead of throwing).
   */
  async getForDashboard(underlying: string): Promise<VolSurfaceQueryResult | null> {
    try {
      return await this.getVolSurface(underlying, false);
    } catch {
      return null;
    }
  }

  /**
   * Get vol surfaces for multiple underlyings.
   */
  async getBatch(underlyings: string[]): Promise<Map<string, VolSurfaceQueryResult | null>> {
    const results = new Map<string, VolSurfaceQueryResult | null>();

    for (const u of underlyings) {
      try {
        results.set(u, await this.getVolSurface(u, false));
      } catch {
        results.set(u, null);
      }
    }

    return results;
  }

  /**
   * Invalidate cached vol surface for an underlying.
   */
  async invalidateCache(underlying: string): Promise<void> {
    const cacheKey = `volsurface:${underlying}`;
    // Set with 0 TTL to effectively expire immediately
    await redisCache.set(cacheKey, null, 1);
    logger.debug('Vol surface cache invalidated', { underlying });
  }

  /**
   * Simple market hours check (ET 9:30-16:00 weekdays).
   */
  private isMarketHours(): boolean {
    const now = new Date();
    const etOptions: Intl.DateTimeFormatOptions = { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', weekday: 'short' };
    const etParts = new Intl.DateTimeFormat('en-US', etOptions).formatToParts(now);

    const hour = parseInt(etParts.find(p => p.type === 'hour')?.value ?? '0');
    const minute = parseInt(etParts.find(p => p.type === 'minute')?.value ?? '0');
    const dayOfWeek = etParts.find(p => p.type === 'weekday')?.value ?? '';

    if (['Sat', 'Sun'].includes(dayOfWeek)) return false;

    const timeMinutes = hour * 60 + minute;
    return timeMinutes >= 570 && timeMinutes < 960; // 9:30 - 16:00
  }
}

export const volSurfaceQueryService = new VolSurfaceQueryService();
