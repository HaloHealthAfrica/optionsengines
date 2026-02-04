/**
 * Property-Based Test: Graceful degradation
 * Property 39: Graceful degradation
 * Validates: Requirements 18.2
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
import { errorTracker } from '../../services/error-tracker.service.js';

describe('Property 39: graceful degradation', () => {
  afterEach(() => {
    (db.query as jest.Mock).mockReset();
    (marketData.isMarketOpen as jest.Mock).mockReset();
    (marketData.getCandles as jest.Mock).mockReset();
    (marketData.getIndicators as jest.Mock).mockReset();
    (marketData.getStockPrice as jest.Mock).mockReset();
    errorTracker.reset();
  });

  test('continues processing after a failure', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (failFirst) => {
        (db.query as jest.Mock).mockClear();
        (marketData.isMarketOpen as jest.Mock).mockClear();
        (marketData.getCandles as jest.Mock).mockClear();
        (marketData.getIndicators as jest.Mock).mockClear();
        (marketData.getStockPrice as jest.Mock).mockClear();
        errorTracker.reset();

        const signals = [
          {
            signal_id: 's-1',
            symbol: 'SPY',
            timeframe: '1m',
            direction: 'long',
            created_at: new Date(),
          },
          {
            signal_id: 's-2',
            symbol: 'QQQ',
            timeframe: '1m',
            direction: 'short',
            created_at: new Date(),
          },
        ];

        (db.query as jest.Mock).mockImplementation(async (text: string) => {
          if (text.includes('SELECT * FROM signals')) {
            return { rows: signals };
          }
          if (text.includes('SELECT * FROM risk_limits')) {
            return { rows: [{}] };
          }
          if (text.includes('COUNT(*)::int')) {
            return { rows: [{ count: 0 }] };
          }
          return { rows: [] };
        });

        (marketData.isMarketOpen as jest.Mock).mockResolvedValue(true);
        (marketData.getIndicators as jest.Mock).mockResolvedValue({} as any);
        (marketData.getStockPrice as jest.Mock).mockResolvedValue(100);
        let call = 0;
        (marketData.getCandles as jest.Mock).mockImplementation(async () => {
          call += 1;
          if (failFirst && call === 1) {
            throw new Error('candles failure');
          }
          return [];
        });

        const worker = new SignalProcessorWorker();
        await worker.run();

        expect((marketData.getCandles as jest.Mock).mock.calls.length).toBe(2);
        if (failFirst) {
          expect(errorTracker.getStats().total).toBeGreaterThan(0);
        }
      }),
      { numRuns: 20 }
    );
  });
});
