/**
 * Property-Based Test: Specialist agent conditional activation
 * Property 27: Specialists activate only when flags and conditions met
 * Validates: Requirements 10.1, 10.2, 10.3
 */

import fc from 'fast-check';

jest.mock('../../services/feature-flag.service.js', () => ({
  featureFlags: {
    isEnabled: jest.fn(),
  },
}));

import { ORBSpecialist } from '../../agents/specialists/orb-specialist.js';
import { StratSpecialist } from '../../agents/specialists/strat-specialist.js';
import { TTMSpecialist } from '../../agents/specialists/ttm-specialist.js';
import { featureFlags } from '../../services/feature-flag.service.js';
import { MarketData } from '../../types/index.js';

describe('Property 27: Specialist agent conditional activation', () => {
  const priceArb = fc.double({ min: 1, max: 1000, noNaN: true });

  test('Property: flags gate activation', async () => {
    const orb = new ORBSpecialist();
    const strat = new StratSpecialist();
    const ttm = new TTMSpecialist();

    await fc.assert(
      fc.asyncProperty(priceArb, async (price) => {
        (featureFlags.isEnabled as jest.Mock).mockReturnValue(false);

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

        expect(orb.shouldActivate(signal, marketData)).toBe(false);
        expect(strat.shouldActivate(signal, marketData)).toBe(false);
        expect(ttm.shouldActivate(signal, marketData)).toBe(false);
      }),
      { numRuns: 30 }
    );
  });
});
