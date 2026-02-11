/**
 * Property-Based Test: Sub-agent no veto power
 * Property 29: Sub-agent block is always false
 * Validates: Requirements 11.4
 */

import fc from 'fast-check';

jest.mock('../../services/feature-flag.service.js', () => ({
  featureFlags: {
    isEnabled: jest.fn().mockReturnValue(true),
  },
}));

import { SatylandSubAgent } from '../../agents/subagents/satyland-sub-agent.js';
import { MarketData } from '../../types/index.js';

describe('Property 29: Sub-agent no veto power', () => {
  const priceArb = fc.double({ min: 1, max: 1000, noNaN: true });

  test('Property: sub-agent never blocks', async () => {
    const agent = new SatylandSubAgent();

    await fc.assert(
      fc.asyncProperty(priceArb, async (price) => {
        const signal = {
          signalId: 's-1',
          symbol: 'SPY',
          direction: 'long' as const,
          timeframe: '1m',
          timestamp: new Date(),
          sessionType: 'RTH' as const,
        };

        const marketData: MarketData = {
          candles: [],
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

        const output = await agent.analyze(signal, marketData);
        expect(output.block).toBe(false);
      }),
      { numRuns: 30 }
    );
  });
});
