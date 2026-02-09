import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { redisCache } from '../redis-cache.service.js';
import { marketData } from '../market-data.js';
import { indicators as indicatorService } from '../indicators.js';
import { marketIntelService } from './market-intel.service.js';

export type MarketIntelSnapshot = {
  symbol: string;
  timestamp: string;
  allowTrading: boolean;
  message?: string;
  gamma?: {
    regime: 'LONG_GAMMA' | 'SHORT_GAMMA' | 'NEUTRAL';
    zeroGammaLevel?: number;
    distanceATR?: number;
    expectedBehavior: 'MEAN_REVERT' | 'EXPANSION';
    noTradeDay?: boolean;
  };
};

export class MarketIntelSnapshotService {
  async getLatest(symbol: string): Promise<MarketIntelSnapshot> {
    const cacheKey = redisCache.buildKey('intel-latest', { symbol });
    const cached = await redisCache.getCached<MarketIntelSnapshot>(cacheKey);
    if (cached.hit && cached.data) {
      return cached.data;
    }

    const snapshot = await this.buildSnapshot(symbol);
    if (snapshot) {
      await redisCache.setCached(cacheKey, snapshot, config.cacheTtlSeconds);
    }
    return snapshot;
  }

  private async buildSnapshot(symbol: string): Promise<MarketIntelSnapshot> {
    try {
      const currentPrice = await marketData.getStockPrice(symbol);
      let atr: number | undefined;

      try {
        const indicatorSeries = await marketData.getIndicators(symbol, '5m');
        const latest = indicatorService.getLatestValues(indicatorSeries);
        atr = Number.isFinite(latest.atr) ? latest.atr : undefined;
      } catch (error) {
        logger.warn('Market intel snapshot indicators unavailable', { error, symbol });
      }

      const intel = await marketIntelService.getMarketIntelContext(symbol, {
        currentPrice,
        atr,
      });

      const gamma = intel?.gamma;
      const expectedBehavior =
        gamma?.regime === 'LONG_GAMMA' ? 'MEAN_REVERT' : 'EXPANSION';
      const noTradeDay =
        gamma?.regime === 'SHORT_GAMMA' &&
        Number.isFinite(gamma?.distanceATR) &&
        Math.abs(Number(gamma?.distanceATR)) <= 0.5;

      return {
        symbol,
        timestamp: new Date().toISOString(),
        allowTrading: !noTradeDay,
        message: noTradeDay ? 'Market structure not supportive today' : undefined,
        gamma: gamma
          ? {
              ...gamma,
              expectedBehavior,
              noTradeDay,
            }
          : undefined,
      };
    } catch (error) {
      logger.warn('Market intel snapshot unavailable', { error, symbol });
      return {
        symbol,
        timestamp: new Date().toISOString(),
        allowTrading: true,
      };
    }
  }
}

export const marketIntelSnapshotService = new MarketIntelSnapshotService();
