/**
 * Property-Based Test: Approved signal order creation
 * Property 11: Approved signals create paper orders with calculated strike/expiration/size
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4
 */

import fc from 'fast-check';

jest.mock('../../services/database.service.js', () => ({
  db: { query: jest.fn() },
}));

jest.mock('../../services/market-data.js', () => ({
  marketData: {
    getStockPrice: jest.fn(),
  },
}));

import { OrderCreatorWorker } from '../../workers/order-creator.js';
import { db } from '../../services/database.service.js';
import { marketData } from '../../services/market-data.js';

describe('Property 11: Approved signal order creation', () => {
  const symbolArb = fc.constantFrom('SPY', 'QQQ', 'AAPL');
  const directionArb = fc.constantFrom<'long' | 'short'>('long', 'short');
  const timeframeArb = fc.constantFrom('1m', '5m', '15m');
  const priceArb = fc.float({ min: 50, max: 500, noNaN: true });

  test('Property: Approved signals create paper orders', async () => {
    await fc.assert(
      fc.asyncProperty(symbolArb, directionArb, timeframeArb, priceArb, async (symbol, direction, timeframe, price) => {
        let inserted: any[] | null = null;

        (marketData.getStockPrice as jest.Mock).mockResolvedValue(price);

        (db.query as jest.Mock).mockImplementation(async (text: string, params?: any[]) => {
          if (text.includes('FROM signals s')) {
            return {
              rows: [
                {
                  signal_id: 'signal-1',
                  symbol,
                  direction,
                  timeframe,
                  timestamp: new Date(),
                },
              ],
            };
          }

          if (text.includes('FROM risk_limits')) {
            return { rows: [{ max_position_size: 5 }] };
          }

          if (text.includes('INSERT INTO orders')) {
            inserted = params || null;
            return { rows: [] };
          }

          return { rows: [] };
        });

        const worker = new OrderCreatorWorker();
        await worker.run();

        expect(inserted).not.toBeNull();
        expect(inserted?.[0]).toBe('signal-1');
        expect(inserted?.[1]).toBe(symbol);
        expect(inserted?.[7]).toBe('paper');
        expect(inserted?.[8]).toBe('pending_execution');

        const expectedStrike = direction === 'long' ? Math.ceil(price) : Math.floor(price);
        expect(inserted?.[3]).toBe(expectedStrike);

        (db.query as jest.Mock).mockClear();
        (marketData.getStockPrice as jest.Mock).mockClear();
      }),
      { numRuns: 30 }
    );
  });
});
