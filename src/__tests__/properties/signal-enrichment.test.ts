/**
 * Property-Based Test: Signal enrichment completeness
 * Property 9: Pending signals are enriched with market context and stored
 * Validates: Requirements 3.2, 3.5
 */

import fc from 'fast-check';

jest.mock('../../services/database.service.js', () => ({
  db: { query: jest.fn() },
}));

jest.mock('../../services/market-data.js', () => ({
  marketData: {
    isMarketOpen: jest.fn(),
    getCandles: jest.fn(),
    getIndicators: jest.fn(),
    getStockPrice: jest.fn(),
  },
}));

import { SignalProcessorWorker } from '../../workers/signal-processor.js';
import { db } from '../../services/database.service.js';
import { marketData } from '../../services/market-data.js';

describe('Property 9: Signal enrichment completeness', () => {
  const symbolArb = fc.constantFrom('SPY', 'QQQ', 'AAPL', 'TSLA');
  const timeframeArb = fc.constantFrom('1m', '5m', '15m');
  const priceArb = fc.float({ min: 50, max: 500, noNaN: true });

  test('Property: Approved signals store enriched data', async () => {
    await fc.assert(
      fc.asyncProperty(symbolArb, timeframeArb, priceArb, async (symbol, timeframe, price) => {
        const captured: { enriched?: any } = {};

        (marketData.isMarketOpen as jest.Mock).mockResolvedValue(true);
        (marketData.getCandles as jest.Mock).mockResolvedValue(
          Array.from({ length: 200 }, (_, idx) => ({
            timestamp: new Date(Date.now() - idx * 60000),
            open: price,
            high: price + 1,
            low: price - 1,
            close: price,
            volume: 1000,
          }))
        );
        (marketData.getIndicators as jest.Mock).mockResolvedValue({
          ema8: [price],
          ema13: [price],
          ema21: [price],
          ema48: [price],
          ema200: [price],
          atr: [1],
          bollingerBands: { upper: [price + 1], middle: [price], lower: [price - 1] },
          keltnerChannels: { upper: [price + 1], middle: [price], lower: [price - 1] },
          ttmSqueeze: { state: 'off', momentum: 0 },
        });
        (marketData.getStockPrice as jest.Mock).mockResolvedValue(price);

        (db.query as jest.Mock).mockImplementation(async (text: string, params?: any[]) => {
          if (text.includes('FROM signals WHERE status')) {
            return {
              rows: [
                {
                  signal_id: 'signal-1',
                  symbol,
                  direction: 'long',
                  timeframe,
                  timestamp: new Date(),
                },
              ],
            };
          }

          if (text.includes('FROM risk_limits')) {
            return { rows: [{ max_positions_per_symbol: 5 }] };
          }

          if (text.includes('FROM refactored_positions') && text.includes('COUNT')) {
            return { rows: [{ count: 0 }] };
          }

          if (text.includes('INSERT INTO refactored_signals')) {
            captured.enriched = params?.[1] ? JSON.parse(params[1]) : null;
            return { rows: [] };
          }

          return { rows: [] };
        });

        const worker = new SignalProcessorWorker();
        await worker.run();

        expect(captured.enriched).toEqual(
          expect.objectContaining({
            symbol,
            timeframe,
            currentPrice: price,
            candlesCount: 200,
          })
        );

        (db.query as jest.Mock).mockClear();
        (marketData.isMarketOpen as jest.Mock).mockClear();
        (marketData.getCandles as jest.Mock).mockClear();
        (marketData.getIndicators as jest.Mock).mockClear();
        (marketData.getStockPrice as jest.Mock).mockClear();
      }),
      { numRuns: 30 }
    );
  });
});
