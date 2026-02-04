/**
 * Property-Based Tests: Exit monitor behavior
 * Property 18: Exit condition triggering
 * Property 19: Position status transitions
 * Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
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

import { ExitMonitorWorker } from '../../workers/exit-monitor.js';
import { PaperExecutorWorker } from '../../workers/paper-executor.js';
import { db } from '../../services/database.service.js';
import { marketData } from '../../services/market-data.js';

describe('Property 18: Exit condition triggering', () => {
  const entryArb = fc.double({ min: 0.5, max: 50, noNaN: true });
  const qtyArb = fc.integer({ min: 1, max: 10 });
  const targetArb = fc.double({ min: 5, max: 50, noNaN: true });

  test('Property: Profit target triggers exit order and closing status', async () => {
    await fc.assert(
      fc.asyncProperty(entryArb, qtyArb, targetArb, async (entry, qty, target) => {
        let statusUpdate: string | null = null;
        let exitReason: string | null = null;
        let insertOrder = false;

        const current = entry * (1 + target / 100) + 0.01;
        (marketData.getOptionPrice as jest.Mock).mockResolvedValue(current);

        (db.query as jest.Mock).mockImplementation(async (text: string, params?: any[]) => {
          if (text.includes('FROM exit_rules')) {
            return {
              rows: [
                {
                  profit_target_percent: target,
                  stop_loss_percent: 50,
                  max_hold_time_hours: 120,
                  min_dte_exit: 1,
                },
              ],
            };
          }

          if (text.includes('FROM refactored_positions')) {
            return {
              rows: [
                {
                  position_id: 'pos-1',
                  symbol: 'SPY',
                  option_symbol: 'SPY-20250101-C-500.00',
                  strike: 500,
                  expiration: new Date(Date.now() + 7 * 86400000),
                  type: 'call',
                  quantity: qty,
                  entry_price: entry,
                  entry_timestamp: new Date(Date.now() - 3600000),
                  status: 'open',
                },
              ],
            };
          }

          if (text.includes('UPDATE refactored_positions')) {
            statusUpdate = params?.[0] ?? null;
            exitReason = params?.[1] ?? null;
            return { rows: [] };
          }

          if (text.includes('INSERT INTO orders')) {
            insertOrder = true;
            return { rows: [] };
          }

          return { rows: [] };
        });

        const worker = new ExitMonitorWorker();
        await worker.run();

        expect(statusUpdate).toBe('closing');
        expect(exitReason).toBe('profit_target');
        expect(insertOrder).toBe(true);

        (db.query as jest.Mock).mockClear();
        (marketData.getOptionPrice as jest.Mock).mockClear();
      }),
      { numRuns: 20 }
    );
  });
});

describe('Property 19: Position status transitions', () => {
  const priceArb = fc.double({ min: 0.5, max: 50, noNaN: true });

  test('Property: Closing position is marked closed on fill', async () => {
    await fc.assert(
      fc.asyncProperty(priceArb, async (price) => {
        let statusUpdate: string | null = null;

        (marketData.getOptionPrice as jest.Mock).mockResolvedValue(price);

        (db.query as jest.Mock).mockImplementation(async (text: string, params?: any[]) => {
          if (text.includes('FROM orders')) {
            return {
              rows: [
                {
                  order_id: 'order-1',
                  signal_id: null,
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

          if (text.includes('FROM refactored_positions')) {
            return {
              rows: [
                {
                  position_id: 'pos-1',
                  option_symbol: 'SPY-20250101-C-500.00',
                  entry_price: 1,
                  quantity: 1,
                  status: 'closing',
                },
              ],
            };
          }

          if (text.includes('UPDATE refactored_positions')) {
            statusUpdate = params?.[0] ?? null;
            return { rows: [] };
          }

          return { rows: [] };
        });

        const worker = new PaperExecutorWorker();
        await worker.run();

        expect(statusUpdate).toBe('closed');

        (db.query as jest.Mock).mockClear();
        (marketData.getOptionPrice as jest.Mock).mockClear();
      }),
      { numRuns: 20 }
    );
  });
});
