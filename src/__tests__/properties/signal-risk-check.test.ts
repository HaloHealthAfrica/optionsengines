/**
 * Property-Based Test: Risk check attribution
 * Property 10: Failed risk checks should update status to rejected with reason
 * Validates: Requirements 3.4
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

describe('Property 10: Risk check attribution', () => {
  const symbolArb = fc.constantFrom('SPY', 'QQQ', 'AAPL');
  const timeframeArb = fc.constantFrom('1m', '5m', '15m');

  test('Property: Market closed causes rejection with reason', async () => {
    await fc.assert(
      fc.asyncProperty(symbolArb, timeframeArb, async (symbol, timeframe) => {
        const captured: { rejectionReason?: string; statusUpdate?: string } = {};

        (marketData.isMarketOpen as jest.Mock).mockResolvedValue(false);
        (marketData.getCandles as jest.Mock).mockResolvedValue([]);
        (marketData.getIndicators as jest.Mock).mockResolvedValue({
          ema8: [],
          ema13: [],
          ema21: [],
          ema48: [],
          ema200: [],
          atr: [],
          bollingerBands: { upper: [], middle: [], lower: [] },
          keltnerChannels: { upper: [], middle: [], lower: [] },
          ttmSqueeze: { state: 'off', momentum: 0 },
        });
        (marketData.getStockPrice as jest.Mock).mockResolvedValue(0);

        (db.query as jest.Mock).mockImplementation(async (text: string, params?: any[]) => {
          if (text.includes('FROM signals WHERE status')) {
            return {
              rows: [
                {
                  signal_id: 'signal-closed',
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

          if (text.includes('UPDATE signals SET status')) {
            captured.statusUpdate = params?.[0];
            return { rows: [] };
          }

          if (text.includes('INSERT INTO refactored_signals')) {
            captured.rejectionReason = params?.[3];
            return { rows: [] };
          }

          return { rows: [] };
        });

        const worker = new SignalProcessorWorker();
        await worker.run();

        expect(captured.statusUpdate).toBe('rejected');
        expect(captured.rejectionReason).toBe('market_closed');

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
