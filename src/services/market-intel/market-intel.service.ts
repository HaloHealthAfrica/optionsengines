import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { redisCache } from '../redis-cache.service.js';
import { MarketIntelContext, UnusualWhalesGammaSnapshot } from '../../types/index.js';
import { UnusualWhalesGammaProvider } from './providers/unusual-whales-gamma.js';
import { GammaRegimeService } from './gamma-regime.service.js';

type MarketIntelOptions = {
  currentPrice?: number;
  atr?: number;
  timeoutMs?: number;
};

export class MarketIntelService {
  private readonly provider = new UnusualWhalesGammaProvider();
  private readonly gammaRegime = new GammaRegimeService();

  async getMarketIntelContext(
    symbol: string,
    options: MarketIntelOptions = {}
  ): Promise<MarketIntelContext | null> {
    try {
      const snapshot = await this.getGammaSnapshot(symbol, options.timeoutMs);
      if (!snapshot) {
        return null;
      }

      const regime = this.gammaRegime.classify(snapshot, {
        currentPrice: options.currentPrice,
        atr: options.atr,
      });

      return {
        gamma: {
          regime: regime.regime,
          zeroGammaLevel: regime.zeroGammaLevel,
          distanceATR: regime.distanceToZeroGammaATR,
        },
      };
    } catch (error) {
      logger.warn('Market intel unavailable', { error, symbol });
      return null;
    }
  }

  private async getGammaSnapshot(
    symbol: string,
    timeoutMs: number = config.slowRequestMs
  ): Promise<UnusualWhalesGammaSnapshot | null> {
    const cacheKey = redisCache.buildKey('uw-gamma', {
      symbol,
      date: new Date().toISOString().split('T')[0],
    });

    const cached = await redisCache.getCached<UnusualWhalesGammaSnapshot>(cacheKey);
    if (cached.hit && cached.data) {
      return cached.data;
    }

    const snapshot = await this.withTimeout(
      this.provider.fetchGammaSnapshot(symbol),
      Math.max(250, timeoutMs)
    );

    if (!snapshot) {
      return null;
    }

    const ttl = redisCache.getTTLForType('gex');
    await redisCache.setCached(cacheKey, snapshot, ttl);
    return snapshot;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutId: NodeJS.Timeout | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Market intel timeout')), timeoutMs);
      if (timeoutId && typeof timeoutId.unref === 'function') {
        timeoutId.unref();
      }
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}

export const marketIntelService = new MarketIntelService();
