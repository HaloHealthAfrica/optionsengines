/**
 * Unusual Whales Gamma Provider - Gamma exposure data for GammaDealerStrategy
 * Caches in Redis (TTL 60s), retries on failure, fails gracefully.
 */

import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { redisCache } from '../redis-cache.service.js';
import { rateLimiter } from '../rate-limiter.service.js';

const BASE_URL = 'https://api.unusualwhales.com/api';
const CACHE_TTL = 60;
const MAX_RETRIES = 2;

export interface GammaContext {
  symbol: string;
  net_gamma: number;
  gamma_flip: number | null;
  call_gamma: number | null;
  put_gamma: number | null;
  gamma_by_strike: Array<{ strike: number; netGamma: number }>;
  zero_dte_gamma: number | null;
  total_call_oi: number | null;
  total_put_oi: number | null;
  dealer_bias: 'long' | 'short' | 'neutral';
  top_gamma_strikes: Array<{ strike: number; netGamma: number }>;
  timestamp: Date;
}

function toNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        logger.warn('Gamma fetch retry', { attempt: attempt + 1, retries, error: lastError.message });
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

export class UnusualWhalesGammaProvider {
  private get apiKey(): string {
    return config.unusualWhalesApiKey;
  }

  private buildGammaUrl(symbol: string): string {
    const template = config.unusualWhalesGammaUrl;
    if (template && template.includes('{symbol}')) {
      let url = template.replace(/\{symbol\}/gi, encodeURIComponent(symbol));
      if (!url.includes('/api/')) {
        url = url.replace('api.unusualwhales.com/', 'api.unusualwhales.com/api/');
      }
      return url;
    }
    return `${BASE_URL}/stock/${encodeURIComponent(symbol)}/greek-exposure/strike`;
  }

  async getGammaContext(symbol: string): Promise<GammaContext | null> {
    if (!this.apiKey) {
      logger.warn('Unusual Whales API key not configured, gamma strategy disabled');
      return null;
    }

    const cacheKey = redisCache.buildKey('gamma:strategy', { symbol });
    const cached = await redisCache.getCached<GammaContext>(cacheKey);
    if (cached.hit && cached.data) {
      return cached.data;
    }

    const minuteOk = await rateLimiter.tryAcquire('unusualwhales-minute');
    const dayOk = await rateLimiter.tryAcquire('unusualwhales-day');
    if (!minuteOk || !dayOk) {
      logger.warn('Unusual Whales rate limit exceeded for gamma', { symbol });
      return null;
    }

    try {
      const context = await fetchWithRetry(() => this.fetchGamma(symbol));
      if (context) {
        await redisCache.setCached(cacheKey, context, CACHE_TTL);
      }
      return context;
    } catch (error) {
      logger.error('Failed to fetch gamma context', { error, symbol });
      return null;
    }
  }

  private async fetchGamma(symbol: string): Promise<GammaContext | null> {
    const url = this.buildGammaUrl(symbol);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Gamma API ${response.status}: ${await response.text()}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const data = (payload?.data ?? payload?.result ?? payload) as Record<string, unknown>;

    const netGamma = toNum(data?.net_gamma ?? data?.netGamma ?? data?.net_gex ?? data?.netGex ?? 0) ?? 0;
    const gammaFlip = toNum(data?.gamma_flip ?? data?.zeroGammaLevel ?? data?.zero_gamma_level ?? data?.zero_gamma);
    const callGamma = toNum(data?.call_gamma ?? data?.callGamma ?? data?.total_call_gex ?? data?.totalCallGex);
    const putGamma = toNum(data?.put_gamma ?? data?.putGamma ?? data?.total_put_gex ?? data?.totalPutGex);
    const zeroDteGamma = toNum(data?.zero_dte_gamma ?? data?.zeroDteGamma);
    const totalCallOi = toNum(data?.total_call_oi ?? data?.totalCallOi);
    const totalPutOi = toNum(data?.total_put_oi ?? data?.totalPutOi);

    const rawStrikes = data?.gamma_by_strike ?? data?.gammaByStrike ?? data?.by_strike ?? data?.strikes ?? data?.levels ?? [];
    const gammaByStrike = Array.isArray(rawStrikes)
      ? rawStrikes
          .map((r: Record<string, unknown>) => ({
            strike: toNum(r.strike ?? r.k ?? r.price) ?? 0,
            netGamma: toNum(r.netGamma ?? r.net_gamma ?? r.net_gex ?? r.gamma ?? r.gex ?? r.value) ?? 0,
          }))
          .filter((r) => Number.isFinite(r.strike) && Number.isFinite(r.netGamma))
      : [];

    const topGammaStrikes = [...gammaByStrike]
      .sort((a, b) => Math.abs(b.netGamma) - Math.abs(a.netGamma))
      .slice(0, 5);

    const dealerBias: 'long' | 'short' | 'neutral' =
      netGamma > config.gammaNeutralThreshold ? 'long' : netGamma < -config.gammaNeutralThreshold ? 'short' : 'neutral';

    const context: GammaContext = {
      symbol,
      net_gamma: netGamma,
      gamma_flip: gammaFlip,
      call_gamma: callGamma,
      put_gamma: putGamma,
      gamma_by_strike: gammaByStrike,
      zero_dte_gamma: zeroDteGamma,
      total_call_oi: totalCallOi,
      total_put_oi: totalPutOi,
      dealer_bias: dealerBias,
      top_gamma_strikes: topGammaStrikes,
      timestamp: new Date(),
    };

    return context;
  }
}

export const unusualWhalesGammaProvider = new UnusualWhalesGammaProvider();
