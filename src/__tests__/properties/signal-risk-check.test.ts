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
    getMarketHours: jest.fn(),
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

  test('Property: Market closed queues signal for later', async () => {
    await fc.assert(
      fc.asyncProperty(symbolArb, timeframeArb, async (symbol, timeframe) => {
        const captured: { rejectionReason?: string; statusUpdate?: string; queuedUntil?: Date } = {};

        const fixedNow = new Date('2026-02-09T02:00:00.000Z');
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedNow.getTime());

        (marketData.isMarketOpen as jest.Mock).mockResolvedValue(false);
        (marketData.getMarketHours as jest.Mock).mockResolvedValue({
          isMarketOpen: false,
          nextOpen: new Date('2026-02-09T14:30:00.000Z'),
        });
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
                  timestamp: new Date(fixedNow.getTime()),
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

          if (text.includes('SET queued_until')) {
            captured.queuedUntil = params?.[0];
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

        expect(captured.statusUpdate).toBeUndefined();
        expect(captured.rejectionReason).toBeUndefined();
        expect(captured.queuedUntil).toBeInstanceOf(Date);

        (db.query as jest.Mock).mockClear();
        (marketData.isMarketOpen as jest.Mock).mockClear();
        (marketData.getMarketHours as jest.Mock).mockClear();
        (marketData.getCandles as jest.Mock).mockClear();
        (marketData.getIndicators as jest.Mock).mockClear();
        (marketData.getStockPrice as jest.Mock).mockClear();
        nowSpy.mockRestore();
      }),
      { numRuns: 30 }
    );
  });
});
