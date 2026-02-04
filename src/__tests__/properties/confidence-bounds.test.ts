/**
 * Property-Based Test: Confidence bounds enforcement
 * Property 28: Confidence within specified bounds
 * Validates: Requirements 10.4, 10.5, 10.6, 11.3
 */

import fc from 'fast-check';

jest.mock('../../services/feature-flag.service.js', () => ({
  featureFlags: {
    isEnabled: jest.fn().mockReturnValue(true),
  },
}));

import { ORBSpecialist } from '../../agents/specialists/orb-specialist.js';
import { StratSpecialist } from '../../agents/specialists/strat-specialist.js';
import { TTMSpecialist } from '../../agents/specialists/ttm-specialist.js';
import { SatylandSubAgent } from '../../agents/subagents/satyland-sub-agent.js';
import { MarketData } from '../../types/index.js';

describe('Property 28: Confidence bounds enforcement', () => {
  const priceArb = fc.double({ min: 1, max: 1000, noNaN: true });

  test('Property: specialists and sub-agent stay within bounds', async () => {
    const orb = new ORBSpecialist();
    const strat = new StratSpecialist();
    const ttm = new TTMSpecialist();
    const saty = new SatylandSubAgent();

    await fc.assert(
      fc.asyncProperty(priceArb, async (price) => {
        const signal = {
          signalId: 's-1',
          symbol: 'SPY',
          direction: 'long' as const,
          timeframe: '1m',
          timestamp: new Date(Date.UTC(2026, 0, 1, 13, 30, 0)),
          sessionType: 'RTH' as const,
        };

        const marketData: MarketData = {
          candles: [
            { timestamp: new Date(), open: price, high: price + 1, low: price - 1, close: price, volume: 1000 },
            { timestamp: new Date(), open: price, high: price + 1, low: price - 1, close: price, volume: 1000 },
            { timestamp: new Date(), open: price, high: price + 1, low: price - 1, close: price, volume: 1000 },
          ],
          indicators: {
            ema8: [price],
            ema13: [price],
            ema21: [price],
            ema48: [price],
            ema200: [price],
            atr: [1],
            bollingerBands: { upper: [price + 1], middle: [price], lower: [price - 1] },
            keltnerChannels: { upper: [price + 1], middle: [price], lower: [price - 1] },
            ttmSqueeze: { state: 'off', momentum: 1 },
          },
          currentPrice: price,
          sessionContext: { sessionType: 'RTH', isMarketOpen: true },
        };

        const orbOut = await orb.analyze(signal, marketData);
        const stratOut = await strat.analyze(signal, marketData);
        const ttmOut = await ttm.analyze(signal, marketData);
        const satyOut = await saty.analyze(signal, marketData);

        expect(orbOut.confidence).toBeGreaterThanOrEqual(0);
        expect(orbOut.confidence).toBeLessThanOrEqual(100);
        expect(stratOut.confidence).toBeGreaterThanOrEqual(15);
        expect(stratOut.confidence).toBeLessThanOrEqual(95);
        expect(ttmOut.confidence).toBeGreaterThanOrEqual(0);
        expect(ttmOut.confidence).toBeLessThanOrEqual(80);
        expect(satyOut.confidence).toBeGreaterThanOrEqual(20);
        expect(satyOut.confidence).toBeLessThanOrEqual(90);
      }),
      { numRuns: 30 }
    );
  });
});
