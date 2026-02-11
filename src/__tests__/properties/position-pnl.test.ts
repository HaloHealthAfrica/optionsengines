/**
 * Property-Based Tests: Position refresher P&L calculations
 * Property 16: P&L calculation invariant
 * Property 17: P&L percentage calculation
 * Validates: Requirements 6.3, 6.5
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

import { PositionRefresherWorker } from '../../workers/position-refresher.js';
import { db } from '../../services/database.service.js';
import { marketData } from '../../services/market-data.js';

describe('Property 16: P&L calculation invariant', () => {
  const priceArb = fc.double({ min: 0.1, max: 50, noNaN: true });
  const qtyArb = fc.integer({ min: 1, max: 100 });

  test('Property: unrealized_pnl = (current - entry) * qty * 100', async () => {
    await fc.assert(
      fc.asyncProperty(priceArb, priceArb, qtyArb, async (entry, current, qty) => {
        let capturedUnrealized: number | null = null;

        (marketData.getOptionPrice as jest.Mock).mockResolvedValue(current);

        (db.query as jest.Mock).mockImplementation(async (text: string, params?: any[]) => {
          if (text.includes('FROM refactored_positions')) {
            return {
              rows: [
                {
                  position_id: 'pos-1',
                  symbol: 'SPY',
                  option_symbol: 'SPY-20250101-C-500.00',
                  strike: 500,
                  expiration: new Date('2025-01-01'),
                  type: 'call',
                  quantity: qty,
                  entry_price: entry,
                },
              ],
            };
          }

          if (text.includes('UPDATE refactored_positions')) {
            capturedUnrealized = params?.[1] ?? null;
            return { rows: [] };
          }

          return { rows: [] };
        });

        const worker = new PositionRefresherWorker();
        await worker.run();

        const expected = (current - entry) * qty * 100;
        expect(capturedUnrealized).toBeCloseTo(expected, 8);

        (db.query as jest.Mock).mockClear();
        (marketData.getOptionPrice as jest.Mock).mockClear();
      }),
      { numRuns: 30 }
    );
  });
});

describe('Property 17: P&L percentage calculation', () => {
  const priceArb = fc.double({ min: 0.1, max: 50, noNaN: true });
  const qtyArb = fc.integer({ min: 1, max: 100 });

  test('Property: position_pnl_percent = (unrealized / cost_basis) * 100', async () => {
    await fc.assert(
      fc.asyncProperty(priceArb, priceArb, qtyArb, async (entry, current, qty) => {
        let capturedPercent: number | null = null;

        (marketData.getOptionPrice as jest.Mock).mockResolvedValue(current);

        (db.query as jest.Mock).mockImplementation(async (text: string, params?: any[]) => {
          if (text.includes('FROM refactored_positions')) {
            return {
              rows: [
                {
                  position_id: 'pos-1',
                  symbol: 'SPY',
                  option_symbol: 'SPY-20250101-C-500.00',
                  strike: 500,
                  expiration: new Date('2025-01-01'),
                  type: 'call',
                  quantity: qty,
                  entry_price: entry,
                },
              ],
            };
          }

          if (text.includes('UPDATE refactored_positions')) {
            capturedPercent = params?.[2] ?? null;
            return { rows: [] };
          }

          return { rows: [] };
        });

        const worker = new PositionRefresherWorker();
        await worker.run();

        const unrealized = (current - entry) * qty * 100;
        const costBasis = entry * qty * 100;
        const expected = costBasis > 0 ? (unrealized / costBasis) * 100 : 0;

        expect(capturedPercent).toBeCloseTo(expected, 8);

        (db.query as jest.Mock).mockClear();
        (marketData.getOptionPrice as jest.Mock).mockClear();
      }),
      { numRuns: 30 }
    );
  });
});
