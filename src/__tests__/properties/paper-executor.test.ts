/**
 * Property-Based Tests: Paper Executor worker
 * Property 13: Paper execution uses real prices (fill_price == current price)
 * Property 14: Trades create/update positions
 * Property 15: Retry logic marks orders failed after retries
 * Validates: Requirements 5.3, 5.5, 5.6
 */

import fc from 'fast-check';

jest.mock('../../services/database.service.js', () => ({
  db: { query: jest.fn() },
}));

jest.mock('../../services/market-data.js', () => ({
  marketData: {
    getOptionPrice: jest.fn(),
  },
}));

import { PaperExecutorWorker } from '../../workers/paper-executor.js';
import { db } from '../../services/database.service.js';
import { marketData } from '../../services/market-data.js';

describe('Property 13: Paper execution uses real prices', () => {
  const priceArb = fc.double({ min: 0.1, max: 50, noNaN: true });

  test('Property: fill_price equals current option price', async () => {
    await fc.assert(
      fc.asyncProperty(priceArb, async (price) => {
        let capturedFillPrice: number | null = null;
        let statusUpdate: string | null = null;

        (marketData.getOptionPrice as jest.Mock).mockResolvedValue(price);

        (db.query as jest.Mock).mockImplementation(async (text: string, params?: any[]) => {
          if (text.includes('FROM orders')) {
            return {
              rows: [
                {
                  order_id: 'order-1',
                  signal_id: 'signal-1',
                  symbol: 'SPY',
                  option_symbol: 'SPY-20250101-C-500.00',
                  strike: 500,
                  expiration: new Date('2025-01-01'),
                  type: 'call',
                  quantity: 1,
                },
              ],
            };
          }

          if (text.includes('INSERT INTO trades')) {
            capturedFillPrice = params?.[1] ?? null;
            return { rows: [] };
          }

          if (text.includes('UPDATE orders SET status')) {
            statusUpdate = params?.[0] ?? null;
            return { rows: [] };
          }

          if (text.includes('FROM refactored_positions')) {
            return { rows: [] };
          }

          return { rows: [] };
        });

        const worker = new PaperExecutorWorker();
        await worker.run();

        expect(capturedFillPrice).toBe(price);
        expect(statusUpdate).toBe('filled');

        (db.query as jest.Mock).mockClear();
        (marketData.getOptionPrice as jest.Mock).mockClear();
      }),
      { numRuns: 30 }
    );
  });
});

describe('Property 14: Trade-to-position propagation', () => {
  const priceArb = fc.double({ min: 0.1, max: 50, noNaN: true });

  test('Property: Filled trade creates a position', async () => {
    await fc.assert(
      fc.asyncProperty(priceArb, async (price) => {
        let positionInsert: any[] | null = null;

        (marketData.getOptionPrice as jest.Mock).mockResolvedValue(price);

        (db.query as jest.Mock).mockImplementation(async (text: string, params?: any[]) => {
          if (text.includes('FROM orders')) {
            return {
              rows: [
                {
                  order_id: 'order-1',
                  signal_id: 'signal-1',
                  symbol: 'SPY',
                  option_symbol: 'SPY-20250101-C-500.00',
                  strike: 500,
                  expiration: new Date('2025-01-01'),
                  type: 'call',
                  quantity: 2,
                },
              ],
            };
          }

          if (text.includes('FROM refactored_positions')) {
            return { rows: [] };
          }

          if (text.includes('INSERT INTO refactored_positions')) {
            positionInsert = params || null;
            return { rows: [] };
          }

          return { rows: [] };
        });

        const worker = new PaperExecutorWorker();
        await worker.run();

        expect(positionInsert).not.toBeNull();
        expect(positionInsert?.[0]).toBe('SPY');
        expect(positionInsert?.[6]).toBe(price);
        expect(positionInsert?.[7]).toBe('open');

        (db.query as jest.Mock).mockClear();
        (marketData.getOptionPrice as jest.Mock).mockClear();
      }),
      { numRuns: 30 }
    );
  });
});

describe('Property 15: Execution retry logic', () => {
  const priceArb = fc.double({ min: 0.1, max: 50, noNaN: true });

  test('Property: Failed pricing marks order as failed', async () => {
    await fc.assert(
      fc.asyncProperty(priceArb, async () => {
        let statusUpdate: string | null = null;
        const timeoutSpy = jest
          .spyOn(global, 'setTimeout')
          .mockImplementation(((fn: (...args: any[]) => void) => {
            fn();
            return 0 as any;
          }) as any);

        (marketData.getOptionPrice as jest.Mock).mockRejectedValue(new Error('No price'));

        (db.query as jest.Mock).mockImplementation(async (text: string, params?: any[]) => {
          if (text.includes('FROM orders')) {
            return {
              rows: [
                {
                  order_id: 'order-1',
                  signal_id: 'signal-1',
                  symbol: 'SPY',
                  option_symbol: 'SPY-20250101-C-500.00',
                  strike: 500,
                  expiration: new Date('2025-01-01'),
                  type: 'call',
                  quantity: 1,
                },
              ],
            };
          }

          if (text.includes('UPDATE orders SET status')) {
            statusUpdate = params?.[0] ?? null;
            return { rows: [] };
          }

          return { rows: [] };
        });

        const worker = new PaperExecutorWorker();
        await worker.run();

        expect(statusUpdate).toBe('failed');

        timeoutSpy.mockRestore();
        (db.query as jest.Mock).mockClear();
        (marketData.getOptionPrice as jest.Mock).mockClear();
      }),
      { numRuns: 10 }
    );
  });
});
