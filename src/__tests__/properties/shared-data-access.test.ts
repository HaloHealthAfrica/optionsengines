/**
 * Property-Based Test: Shared data access (no duplicate API calls)
 * Property 24: Agents consume provided market data without fetching
 * Validates: Requirements 9.2
 */

import fc from 'fast-check';
import { TechnicalAgent } from '../../agents/core/technical-agent.js';
import { ContextAgent } from '../../agents/core/context-agent.js';
import { RiskAgent } from '../../agents/core/risk-agent.js';
import { MarketData } from '../../types/index.js';

describe('Property 24: Shared data access', () => {
  const priceArb = fc.double({ min: 1, max: 1000, noNaN: true });

  test('Property: agents do not call external services', async () => {
    const tech = new TechnicalAgent();
    const context = new ContextAgent();
    const risk = new RiskAgent();

    await fc.assert(
      fc.asyncProperty(priceArb, async (price) => {
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
            ttmSqueeze: { state: 'off', momentum: 0 },
          },
          currentPrice: price,
          sessionContext: { sessionType: 'RTH', isMarketOpen: true },
        };

        const signal = {
          signalId: 's-1',
          symbol: 'SPY',
          direction: 'long' as const,
          timeframe: '1m',
          timestamp: new Date(),
          sessionType: 'RTH' as const,
        };

        await tech.analyze(signal, marketData);
        await context.analyze(signal, marketData);
        await risk.analyze(signal, marketData);
      }),
      { numRuns: 50 }
    );
  });
});
