/**
 * Fast-check Arbitraries for E2E Testing
 * 
 * Provides custom arbitraries for generating synthetic test data:
 * - Webhook scenarios and payloads
 * - GEX regimes and data
 * - Enriched snapshots
 * - Market data
 * - Technical indicators
 * 
 * These arbitraries ensure generated data respects all constraints
 * and provides good coverage for property-based testing.
 */

import * as fc from 'fast-check';
import { WebhookScenario, WebhookPayload } from '../generators/webhook-generator';
import { GEXRegime } from '../generators/gex-generator';

type GEXRegimeType = GEXRegime['type'];

/**
 * Arbitrary for webhook scenarios
 * 
 * Generates valid webhook scenarios with all required fields
 */
export const webhookScenarioArbitrary = (): fc.Arbitrary<WebhookScenario> => {
  return fc.record({
    symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
    timeframe: fc.constantFrom('1m', '5m', '15m'),
    session: fc.constantFrom('RTH_OPEN', 'MID_DAY', 'POWER_HOUR'),
    pattern: fc.constantFrom(
      'ORB_BREAKOUT',
      'ORB_FAKEOUT',
      'TREND_CONTINUATION',
      'CHOP',
      'VOL_COMPRESSION',
      'VOL_EXPANSION'
    ),
    price: fc.double({ min: 100, max: 5000, noNaN: true }),
    volume: fc.integer({ min: 100000, max: 100000000 }),
    timestamp: fc.integer({ min: Date.now() - 86400000, max: Date.now() })
  }) as fc.Arbitrary<WebhookScenario>;
};

/**
 * Arbitrary for webhook payloads
 * 
 * Generates valid webhook payloads matching production format
 */
export const webhookPayloadArbitrary = (): fc.Arbitrary<WebhookPayload> => {
  return fc.record({
    symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
    timeframe: fc.constantFrom('1m', '5m', '15m'),
    timestamp: fc.integer({ min: Date.now() - 86400000, max: Date.now() }),
    open: fc.double({ min: 100, max: 5000, noNaN: true }),
    high: fc.double({ min: 100, max: 5000, noNaN: true }),
    low: fc.double({ min: 100, max: 5000, noNaN: true }),
    close: fc.double({ min: 100, max: 5000, noNaN: true }),
    volume: fc.integer({ min: 100000, max: 100000000 }),
    signal: fc.option(fc.constantFrom('ORB_BREAK', 'TREND_CONT', 'VOL_EXP'), { nil: undefined }),
    strategy: fc.option(fc.string({ minLength: 5, maxLength: 30 }), { nil: undefined })
  }).map(payload => {
    // Ensure OHLC relationships are valid
    const prices = [payload.open, payload.high, payload.low, payload.close];
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    
    return {
      ...payload,
      high: max,
      low: min
    };
  });
};

/**
 * Arbitrary for GEX regimes
 * 
 * Generates valid GEX regime types
 */
export const gexRegimeArbitrary = (): fc.Arbitrary<GEXRegimeType> => {
  return fc.constantFrom('POSITIVE', 'NEGATIVE', 'GAMMA_FLIP_NEAR', 'NEUTRAL') as fc.Arbitrary<GEXRegimeType>;
};

/**
 * Arbitrary for GEX data
 * 
 * Generates valid GEX data with mathematical consistency
 */
export const gexDataArbitrary = (): fc.Arbitrary<{
  symbol: string;
  spotPrice: number;
  total_gex: number;
  call_gex: number;
  put_gex: number;
  net_gex: number;
  gamma_flip_level: number | null;
  regime: GEXRegimeType;
}> => {
  return fc.record({
    symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
    spotPrice: fc.double({ min: 100, max: 5000, noNaN: true }),
    regime: gexRegimeArbitrary()
  }).chain(base => {
    // Generate GEX values based on regime
    let total_gex: number;
    let gamma_flip_level: number | null;

    switch (base.regime) {
      case 'POSITIVE':
        total_gex = fc.sample(fc.double({ min: 1000000, max: 10000000, noNaN: true }), 1)[0];
        gamma_flip_level = null;
        break;
      case 'NEGATIVE':
        total_gex = fc.sample(fc.double({ min: -10000000, max: -1000000, noNaN: true }), 1)[0];
        gamma_flip_level = null;
        break;
      case 'GAMMA_FLIP_NEAR':
        total_gex = fc.sample(fc.double({ min: -1000000, max: 1000000, noNaN: true }), 1)[0];
        gamma_flip_level = base.spotPrice * (1 + fc.sample(fc.double({ min: -0.009, max: 0.009, noNaN: true }), 1)[0]);
        break;
      case 'NEUTRAL':
      default:
        total_gex = fc.sample(fc.double({ min: -500000, max: 500000, noNaN: true }), 1)[0];
        gamma_flip_level = null;
        break;
    }

    const splitRatio = fc.sample(fc.double({ min: 0.2, max: 0.8, noNaN: true }), 1)[0];
    const call_gex = total_gex * splitRatio;
    const put_gex = total_gex - call_gex;
    const net_gex = call_gex - put_gex;

    return fc.constant({
      symbol: base.symbol,
      spotPrice: base.spotPrice,
      total_gex,
      call_gex,
      put_gex,
      net_gex,
      gamma_flip_level,
      regime: base.regime
    });
  });
};

/**
 * Arbitrary for enriched snapshots
 * 
 * Generates valid enriched snapshots with all required fields
 */
export const snapshotArbitrary = (): fc.Arbitrary<{
  webhook: WebhookPayload;
  marketData: {
    currentPrice: number;
    bid: number;
    ask: number;
    spread: number;
    dayHigh: number;
    dayLow: number;
    dayVolume: number;
  };
  gexData: {
    total_gex: number;
    call_gex: number;
    put_gex: number;
    net_gex: number;
    gamma_flip_level: number | null;
    regime: 'POSITIVE' | 'NEGATIVE' | 'GAMMA_FLIP_NEAR' | 'NEUTRAL';
  };
  technicalIndicators: {
    orbHigh?: number;
    orbLow?: number;
    ttmSqueeze?: boolean;
    trendDirection?: 'UP' | 'DOWN' | 'SIDEWAYS';
  };
  enrichedAt: number;
}> => {
  return fc.record({
    webhook: webhookPayloadArbitrary(),
    currentPrice: fc.double({ min: 100, max: 5000, noNaN: true }),
    gexData: gexDataArbitrary(),
    enrichedAt: fc.integer({ min: Date.now() - 86400000, max: Date.now() })
  }).map(data => {
    const spread = data.currentPrice * 0.0001; // 1 basis point spread
    
    return {
      webhook: data.webhook,
      marketData: {
        currentPrice: data.currentPrice,
        bid: data.currentPrice - spread / 2,
        ask: data.currentPrice + spread / 2,
        spread,
        dayHigh: data.currentPrice * 1.02,
        dayLow: data.currentPrice * 0.98,
        dayVolume: fc.sample(fc.integer({ min: 10000000, max: 100000000 }), 1)[0]
      },
      gexData: {
        total_gex: data.gexData.total_gex,
        call_gex: data.gexData.call_gex,
        put_gex: data.gexData.put_gex,
        net_gex: data.gexData.net_gex,
        gamma_flip_level: data.gexData.gamma_flip_level,
        regime: data.gexData.regime
      },
      technicalIndicators: {
        orbHigh: data.currentPrice * 1.005,
        orbLow: data.currentPrice * 0.995,
        ttmSqueeze: fc.sample(fc.boolean(), 1)[0],
        trendDirection: fc.sample(fc.constantFrom('UP', 'DOWN', 'SIDEWAYS'), 1)[0] as 'UP' | 'DOWN' | 'SIDEWAYS'
      },
      enrichedAt: data.enrichedAt
    };
  });
};

/**
 * Arbitrary for market data
 * 
 * Generates valid market data with realistic values
 */
export const marketDataArbitrary = (): fc.Arbitrary<{
  currentPrice: number;
  bid: number;
  ask: number;
  spread: number;
  dayHigh: number;
  dayLow: number;
  dayVolume: number;
}> => {
  return fc.double({ min: 100, max: 5000, noNaN: true }).map(currentPrice => {
    const spread = currentPrice * fc.sample(fc.double({ min: 0.00005, max: 0.0002, noNaN: true }), 1)[0];
    const dayRange = currentPrice * fc.sample(fc.double({ min: 0.01, max: 0.05, noNaN: true }), 1)[0];
    
    return {
      currentPrice,
      bid: currentPrice - spread / 2,
      ask: currentPrice + spread / 2,
      spread,
      dayHigh: currentPrice + dayRange / 2,
      dayLow: currentPrice - dayRange / 2,
      dayVolume: fc.sample(fc.integer({ min: 10000000, max: 100000000 }), 1)[0]
    };
  });
};

/**
 * Arbitrary for technical indicators
 * 
 * Generates valid technical indicator data
 */
export const technicalIndicatorsArbitrary = (): fc.Arbitrary<{
  orbHigh?: number;
  orbLow?: number;
  ttmSqueeze?: boolean;
  trendDirection?: 'UP' | 'DOWN' | 'SIDEWAYS';
}> => {
  return fc.record({
    basePrice: fc.double({ min: 100, max: 5000, noNaN: true }),
    includeORB: fc.boolean(),
    includeTTM: fc.boolean(),
    includeTrend: fc.boolean()
  }).map(data => {
    const indicators: {
      orbHigh?: number;
      orbLow?: number;
      ttmSqueeze?: boolean;
      trendDirection?: 'UP' | 'DOWN' | 'SIDEWAYS';
    } = {};

    if (data.includeORB) {
      indicators.orbHigh = data.basePrice * 1.005;
      indicators.orbLow = data.basePrice * 0.995;
    }

    if (data.includeTTM) {
      indicators.ttmSqueeze = fc.sample(fc.boolean(), 1)[0];
    }

    if (data.includeTrend) {
      indicators.trendDirection = fc.sample(
        fc.constantFrom('UP', 'DOWN', 'SIDEWAYS'),
        1
      )[0] as 'UP' | 'DOWN' | 'SIDEWAYS';
    }

    return indicators;
  });
};

/**
 * Arbitrary for agent names
 */
export const agentNameArbitrary = (): fc.Arbitrary<'ORB' | 'STRAT' | 'TTM' | 'SATYLAND' | 'RISK' | 'META_DECISION'> => {
  return fc.constantFrom('ORB', 'STRAT', 'TTM', 'SATYLAND', 'RISK', 'META_DECISION');
};

/**
 * Arbitrary for trading actions
 */
export const tradingActionArbitrary = (): fc.Arbitrary<'BUY' | 'SELL' | 'HOLD' | 'CLOSE'> => {
  return fc.constantFrom('BUY', 'SELL', 'HOLD', 'CLOSE');
};

/**
 * Arbitrary for confidence levels
 */
export const confidenceArbitrary = (): fc.Arbitrary<number> => {
  return fc.double({ min: 0, max: 1, noNaN: true });
};

/**
 * Arbitrary for variant assignments
 */
export const variantArbitrary = (): fc.Arbitrary<'A' | 'B'> => {
  return fc.constantFrom('A', 'B');
};
