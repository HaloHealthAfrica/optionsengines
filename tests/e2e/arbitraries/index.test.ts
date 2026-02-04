/**
 * Tests for Fast-check Arbitraries
 * 
 * Validates that arbitraries generate valid data and respect constraints
 */

import * as fc from 'fast-check';
import {
  webhookScenarioArbitrary,
  webhookPayloadArbitrary,
  gexRegimeArbitrary,
  gexDataArbitrary,
  snapshotArbitrary,
  marketDataArbitrary,
  technicalIndicatorsArbitrary,
  agentNameArbitrary,
  tradingActionArbitrary,
  confidenceArbitrary,
  variantArbitrary
} from './index';

describe('Fast-check Arbitraries', () => {
  describe('webhookScenarioArbitrary', () => {
    it('should generate valid webhook scenarios', () => {
      fc.assert(
        fc.property(webhookScenarioArbitrary(), (scenario) => {
          // Validate symbol
          expect(['SPY', 'QQQ', 'SPX']).toContain(scenario.symbol);

          // Validate timeframe
          expect(['1m', '5m', '15m']).toContain(scenario.timeframe);

          // Validate session
          expect(['RTH_OPEN', 'MID_DAY', 'POWER_HOUR']).toContain(scenario.session);

          // Validate pattern
          expect([
            'ORB_BREAKOUT',
            'ORB_FAKEOUT',
            'TREND_CONTINUATION',
            'CHOP',
            'VOL_COMPRESSION',
            'VOL_EXPANSION'
          ]).toContain(scenario.pattern);

          // Validate price
          expect(scenario.price).toBeGreaterThanOrEqual(100);
          expect(scenario.price).toBeLessThanOrEqual(5000);
          expect(isNaN(scenario.price)).toBe(false);

          // Validate volume
          expect(scenario.volume).toBeGreaterThanOrEqual(100000);
          expect(scenario.volume).toBeLessThanOrEqual(100000000);

          // Validate timestamp
          expect(scenario.timestamp).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('webhookPayloadArbitrary', () => {
    it('should generate valid webhook payloads', () => {
      fc.assert(
        fc.property(webhookPayloadArbitrary(), (payload) => {
          // Validate symbol
          expect(['SPY', 'QQQ', 'SPX']).toContain(payload.symbol);

          // Validate timeframe
          expect(['1m', '5m', '15m']).toContain(payload.timeframe);

          // Validate OHLC relationships
          expect(payload.high).toBeGreaterThanOrEqual(payload.low);
          expect(payload.high).toBeGreaterThanOrEqual(payload.open);
          expect(payload.high).toBeGreaterThanOrEqual(payload.close);
          expect(payload.low).toBeLessThanOrEqual(payload.open);
          expect(payload.low).toBeLessThanOrEqual(payload.close);

          // Validate prices are positive
          expect(payload.open).toBeGreaterThan(0);
          expect(payload.high).toBeGreaterThan(0);
          expect(payload.low).toBeGreaterThan(0);
          expect(payload.close).toBeGreaterThan(0);

          // Validate volume
          expect(payload.volume).toBeGreaterThanOrEqual(100000);
          expect(payload.volume).toBeLessThanOrEqual(100000000);

          // Validate timestamp
          expect(payload.timestamp).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('gexRegimeArbitrary', () => {
    it('should generate valid GEX regimes', () => {
      fc.assert(
        fc.property(gexRegimeArbitrary(), (regime) => {
          expect(['POSITIVE', 'NEGATIVE', 'GAMMA_FLIP_NEAR', 'NEUTRAL']).toContain(regime);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('gexDataArbitrary', () => {
    it('should generate valid GEX data with mathematical consistency', () => {
      fc.assert(
        fc.property(gexDataArbitrary(), (gexData) => {
          // Validate symbol
          expect(['SPY', 'QQQ', 'SPX']).toContain(gexData.symbol);

          // Validate spot price
          expect(gexData.spotPrice).toBeGreaterThanOrEqual(100);
          expect(gexData.spotPrice).toBeLessThanOrEqual(5000);

          // Validate mathematical consistency: call_gex + put_gex = total_gex
          const calculatedTotal = gexData.call_gex + gexData.put_gex;
          expect(Math.abs(calculatedTotal - gexData.total_gex)).toBeLessThan(0.01);

          // Validate mathematical consistency: net_gex = call_gex - put_gex
          const calculatedNet = gexData.call_gex - gexData.put_gex;
          expect(Math.abs(calculatedNet - gexData.net_gex)).toBeLessThan(0.01);

          // Validate regime-specific constraints
          switch (gexData.regime) {
            case 'POSITIVE':
              expect(gexData.total_gex).toBeGreaterThan(0);
              expect(gexData.gamma_flip_level).toBeNull();
              break;

            case 'NEGATIVE':
              expect(gexData.total_gex).toBeLessThan(0);
              expect(gexData.gamma_flip_level).toBeNull();
              break;

            case 'GAMMA_FLIP_NEAR':
              expect(gexData.gamma_flip_level).not.toBeNull();
              if (gexData.gamma_flip_level !== null) {
                // Flip level should be within 1% of spot price
                const percentDiff = Math.abs(gexData.gamma_flip_level - gexData.spotPrice) / gexData.spotPrice;
                expect(percentDiff).toBeLessThanOrEqual(0.01);
              }
              break;

            case 'NEUTRAL':
              expect(Math.abs(gexData.total_gex)).toBeLessThan(1000000);
              break;
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('snapshotArbitrary', () => {
    it('should generate valid enriched snapshots', () => {
      fc.assert(
        fc.property(snapshotArbitrary(), (snapshot) => {
          // Validate webhook
          expect(snapshot.webhook).toBeDefined();
          expect(['SPY', 'QQQ', 'SPX']).toContain(snapshot.webhook.symbol);

          // Validate market data
          expect(snapshot.marketData).toBeDefined();
          expect(snapshot.marketData.currentPrice).toBeGreaterThan(0);
          expect(snapshot.marketData.bid).toBeLessThan(snapshot.marketData.ask);
          expect(snapshot.marketData.spread).toBeGreaterThan(0);
          expect(snapshot.marketData.dayHigh).toBeGreaterThanOrEqual(snapshot.marketData.currentPrice);
          expect(snapshot.marketData.dayLow).toBeLessThanOrEqual(snapshot.marketData.currentPrice);
          expect(snapshot.marketData.dayVolume).toBeGreaterThan(0);

          // Validate GEX data
          expect(snapshot.gexData).toBeDefined();
          expect(['POSITIVE', 'NEGATIVE', 'GAMMA_FLIP_NEAR', 'NEUTRAL']).toContain(snapshot.gexData.regime);

          // Validate technical indicators
          expect(snapshot.technicalIndicators).toBeDefined();

          // Validate enrichedAt timestamp
          expect(snapshot.enrichedAt).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('marketDataArbitrary', () => {
    it('should generate valid market data', () => {
      fc.assert(
        fc.property(marketDataArbitrary(), (marketData) => {
          // Validate current price
          expect(marketData.currentPrice).toBeGreaterThanOrEqual(100);
          expect(marketData.currentPrice).toBeLessThanOrEqual(5000);

          // Validate bid/ask spread
          expect(marketData.bid).toBeLessThan(marketData.ask);
          expect(marketData.spread).toBeGreaterThan(0);
          expect(Math.abs((marketData.ask - marketData.bid) - marketData.spread)).toBeLessThan(0.01);

          // Validate day range
          expect(marketData.dayHigh).toBeGreaterThanOrEqual(marketData.currentPrice);
          expect(marketData.dayLow).toBeLessThanOrEqual(marketData.currentPrice);

          // Validate volume
          expect(marketData.dayVolume).toBeGreaterThanOrEqual(10000000);
          expect(marketData.dayVolume).toBeLessThanOrEqual(100000000);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('technicalIndicatorsArbitrary', () => {
    it('should generate valid technical indicators', () => {
      fc.assert(
        fc.property(technicalIndicatorsArbitrary(), (indicators) => {
          // Validate ORB levels if present
          if (indicators.orbHigh !== undefined && indicators.orbLow !== undefined) {
            expect(indicators.orbHigh).toBeGreaterThan(indicators.orbLow);
          }

          // Validate TTM squeeze if present
          if (indicators.ttmSqueeze !== undefined) {
            expect(typeof indicators.ttmSqueeze).toBe('boolean');
          }

          // Validate trend direction if present
          if (indicators.trendDirection !== undefined) {
            expect(['UP', 'DOWN', 'SIDEWAYS']).toContain(indicators.trendDirection);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('agentNameArbitrary', () => {
    it('should generate valid agent names', () => {
      fc.assert(
        fc.property(agentNameArbitrary(), (agentName) => {
          expect(['ORB', 'STRAT', 'TTM', 'SATYLAND', 'RISK', 'META_DECISION']).toContain(agentName);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('tradingActionArbitrary', () => {
    it('should generate valid trading actions', () => {
      fc.assert(
        fc.property(tradingActionArbitrary(), (action) => {
          expect(['BUY', 'SELL', 'HOLD', 'CLOSE']).toContain(action);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('confidenceArbitrary', () => {
    it('should generate valid confidence levels', () => {
      fc.assert(
        fc.property(confidenceArbitrary(), (confidence) => {
          expect(confidence).toBeGreaterThanOrEqual(0);
          expect(confidence).toBeLessThanOrEqual(1);
          expect(isNaN(confidence)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('variantArbitrary', () => {
    it('should generate valid variants', () => {
      fc.assert(
        fc.property(variantArbitrary(), (variant) => {
          expect(['A', 'B']).toContain(variant);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Coverage Tests', () => {
    it('should provide good coverage for webhook scenarios', () => {
      const samples = fc.sample(webhookScenarioArbitrary(), 1000);
      
      const symbols = new Set(samples.map(s => s.symbol));
      const timeframes = new Set(samples.map(s => s.timeframe));
      const sessions = new Set(samples.map(s => s.session));
      const patterns = new Set(samples.map(s => s.pattern));

      // Should cover all symbols
      expect(symbols.size).toBe(3);
      expect(symbols.has('SPY')).toBe(true);
      expect(symbols.has('QQQ')).toBe(true);
      expect(symbols.has('SPX')).toBe(true);

      // Should cover all timeframes
      expect(timeframes.size).toBe(3);

      // Should cover all sessions
      expect(sessions.size).toBe(3);

      // Should cover all patterns
      expect(patterns.size).toBe(6);
    });

    it('should provide good coverage for GEX regimes', () => {
      const samples = fc.sample(gexDataArbitrary(), 1000);
      
      const regimes = new Set(samples.map(s => s.regime));

      // Should cover all regimes
      expect(regimes.size).toBe(4);
      expect(regimes.has('POSITIVE')).toBe(true);
      expect(regimes.has('NEGATIVE')).toBe(true);
      expect(regimes.has('GAMMA_FLIP_NEAR')).toBe(true);
      expect(regimes.has('NEUTRAL')).toBe(true);
    });
  });
});
