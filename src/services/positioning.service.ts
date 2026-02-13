import { db } from './database.service.js';
import { marketData } from './market-data.js';
import { logger } from '../utils/logger.js';
import { GexData, OptionsFlowSummary } from '../types/index.js';
import { redisCache } from './redis-cache.service.js';

/** In-flight GEX fetches by symbol for promise coalescing */
const gexInFlight = new Map<string, Promise<GexData>>();

type MaxPainResult = {
  symbol: string;
  maxPainStrike: number | null;
  distancePercent: number | null;
  magnetStrength: number | null;
  updatedAt: Date;
};

type SignalCorrelationResult = {
  symbol: string;
  correlationScore: number;
  sampleSize: number;
  bias: 'bullish' | 'bearish' | 'neutral';
  notes?: string;
  updatedAt: Date;
};

export class PositioningService {
  async getGexSnapshot(symbol: string): Promise<GexData & { cached?: boolean; cache_age_seconds?: number; ttl_remaining?: number; stale?: boolean }> {
    // Check cache first
    const cacheKey = redisCache.buildKey('gex', { symbol, date: new Date().toISOString().split('T')[0] });
    const cached = await redisCache.getCached<GexData>(cacheKey);
    
    if (cached.hit && cached.data) {
      logger.debug('GEX cache hit', { symbol, cacheKey });
      return {
        ...cached.data,
        cached: true,
        ttl_remaining: cached.ttl_remaining,
      };
    }

    // Cache miss - fetch from external API with fallback (coalesce concurrent requests)
    logger.debug('GEX cache miss', { symbol, cacheKey });
    
    let promise = gexInFlight.get(symbol);
    if (!promise) {
      promise = this.fetchGexFromExternalAPI(symbol).finally(() => {
        gexInFlight.delete(symbol);
      });
      gexInFlight.set(symbol, promise);
    }
    
    try {
      const gex = await promise;

      // Store in cache with 5-minute TTL
      const ttl = redisCache.getTTLForType('gex');
      await redisCache.setCached(cacheKey, gex, ttl);

      return {
        ...gex,
        cached: false,
      };
    } catch (error) {
      logger.error('External GEX API failed', { symbol, error });
      
      // Try to get stale cached data (even if expired)
      const staleData = await redisCache.get<GexData>(cacheKey);
      if (staleData) {
        logger.warn('Returning stale GEX data due to API failure', { symbol });
        return {
          ...staleData,
          cached: true,
          stale: true,
        };
      }
      
      // No stale data available, re-throw error
      throw error;
    }
  }

  private async fetchGexFromExternalAPI(symbol: string): Promise<GexData> {
    const gex = await marketData.getGex(symbol);

    try {
      await db.query(
        `INSERT INTO gex_snapshots (
          symbol,
          net_gex,
          total_call_gex,
          total_put_gex,
          zero_gamma_level,
          dealer_position,
          volatility_expectation,
          levels,
          source
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          gex.symbol,
          gex.netGex,
          gex.totalCallGex,
          gex.totalPutGex,
          gex.zeroGammaLevel ?? null,
          gex.dealerPosition,
          gex.volatilityExpectation,
          JSON.stringify(gex.levels || []),
          'marketdata',
        ]
      );
    } catch (error) {
      logger.warn('Failed to persist GEX snapshot', { error, symbol });
    }

    return gex;
  }

  async getOptionsFlowSnapshot(symbol: string, limit: number = 50): Promise<OptionsFlowSummary> {
    let flow: OptionsFlowSummary;
    try {
      flow = await marketData.getOptionsFlow(symbol, limit);
    } catch (error) {
      logger.warn('Options flow unavailable, returning empty summary', { error, symbol });
      return {
        symbol,
        entries: [],
        updatedAt: new Date(),
      };
    }

    try {
      const totalCallVolume = flow.entries
        .filter((entry) => entry.side === 'call')
        .reduce((sum, entry) => sum + entry.volume, 0);
      const totalPutVolume = flow.entries
        .filter((entry) => entry.side === 'put')
        .reduce((sum, entry) => sum + entry.volume, 0);
      const callPremium = flow.entries
        .filter((entry) => entry.side === 'call')
        .reduce((sum, entry) => sum + Number(entry.premium ?? 0), 0);
      const putPremium = flow.entries
        .filter((entry) => entry.side === 'put')
        .reduce((sum, entry) => sum + Number(entry.premium ?? 0), 0);
      const netflow = callPremium - putPremium;
      const flowSource = flow.source ?? 'marketdata';

      await db.query(
        `INSERT INTO options_flow_snapshots (
          symbol,
          total_call_volume,
          total_put_volume,
          call_premium,
          put_premium,
          netflow,
          entries,
          source
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          flow.symbol,
          totalCallVolume,
          totalPutVolume,
          callPremium,
          putPremium,
          netflow,
          JSON.stringify(flow.entries || []),
          flowSource,
        ]
      );
    } catch (error) {
      logger.warn('Failed to persist options flow snapshot', { error, symbol });
    }

    return flow;
  }

  /**
   * Compute netflow z-score from last N days of snapshots.
   * Returns { zScore, mean, stdDev, sampleSize, isUnusual }.
   */
  async getNetflowZScore(symbol: string, lookbackDays: number = 20): Promise<{
    zScore: number | null;
    mean: number;
    stdDev: number;
    sampleSize: number;
    isUnusual: boolean;
  }> {
    try {
      const result = await db.query(
        `SELECT netflow FROM options_flow_snapshots
         WHERE symbol = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2
         ORDER BY created_at DESC
         LIMIT 500`,
        [symbol, lookbackDays]
      );
      const netflows = (result.rows as { netflow: string | number }[])
        .map((r) => Number(r?.netflow ?? 0))
        .filter(Number.isFinite);
      if (netflows.length < 5) {
        return { zScore: null, mean: 0, stdDev: 0, sampleSize: netflows.length, isUnusual: false };
      }
      const mean = netflows.reduce((a, b) => a + b, 0) / netflows.length;
      const variance = netflows.reduce((s, v) => s + (v - mean) ** 2, 0) / netflows.length;
      const stdDev = Math.sqrt(variance) || 1e-10;
      const latest = netflows[0];
      const zScore = (latest - mean) / stdDev;
      return {
        zScore,
        mean,
        stdDev,
        sampleSize: netflows.length,
        isUnusual: Math.abs(zScore) >= 2,
      };
    } catch (error) {
      logger.warn('Failed to compute netflow z-score', { error, symbol });
      return { zScore: null, mean: 0, stdDev: 0, sampleSize: 0, isUnusual: false };
    }
  }

  async getMaxPain(symbol: string): Promise<MaxPainResult> {
    const chainRows = await marketData.getOptionsChain(symbol);
    if (!chainRows.length) {
      return {
        symbol,
        maxPainStrike: null,
        distancePercent: null,
        magnetStrength: null,
        updatedAt: new Date(),
      };
    }

    const strikes = chainRows.map((row) => row.strike);
    const strikeSet = Array.from(new Set(strikes)).sort((a, b) => a - b);

    const payouts = strikeSet.map((settleStrike) => {
      let total = 0;
      for (const row of chainRows) {
        const oi = Number(row.openInterest ?? 0);
        if (!Number.isFinite(oi) || oi === 0) continue;
        if (row.optionType === 'call' && row.strike < settleStrike) {
          total += (settleStrike - row.strike) * oi * 100;
        }
        if (row.optionType === 'put' && row.strike > settleStrike) {
          total += (row.strike - settleStrike) * oi * 100;
        }
      }
      return { settleStrike, total };
    });

    const lowest = payouts.reduce((min, item) => (item.total < min.total ? item : min), payouts[0]);
    const currentPrice = await marketData.getStockPrice(symbol);
    const distancePercent = currentPrice
      ? Math.round(((currentPrice - lowest.settleStrike) / currentPrice) * 10000) / 100
      : null;

    return {
      symbol,
      maxPainStrike: lowest.settleStrike,
      distancePercent,
      magnetStrength: null,
      updatedAt: new Date(),
    };
  }

  async getSignalCorrelation(symbol: string): Promise<SignalCorrelationResult> {
    const gex = await marketData.getGex(symbol);
    const bias: SignalCorrelationResult['bias'] =
      gex.netGex > 0 ? 'bullish' : gex.netGex < 0 ? 'bearish' : 'neutral';

    const signals = await db.query(
      `SELECT direction FROM signals
       WHERE symbol = $1 AND created_at >= NOW() - INTERVAL '7 days'
       ORDER BY created_at DESC
       LIMIT 200`,
      [symbol]
    );

    const rows = signals.rows as { direction: 'long' | 'short' }[];
    if (!rows.length || bias === 'neutral') {
      return {
        symbol,
        correlationScore: 0,
        sampleSize: rows.length,
        bias,
        notes: 'insufficient_data',
        updatedAt: new Date(),
      };
    }

    const matches = rows.filter((row) =>
      bias === 'bullish' ? row.direction === 'long' : row.direction === 'short'
    ).length;

    const correlationScore = Math.round((matches / rows.length) * 1000) / 1000;

    return {
      symbol,
      correlationScore,
      sampleSize: rows.length,
      bias,
      updatedAt: new Date(),
    };
  }
}

export const positioningService = new PositioningService();
