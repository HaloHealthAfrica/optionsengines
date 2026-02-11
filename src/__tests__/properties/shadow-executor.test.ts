/**
 * Property-Based Tests: Shadow executor
 * Property 31: No live orders from Engine 2
 * Property 33: Shadow trade uses real pricing
 * Property 34: Shadow position P&L parity
 */

import fc from 'fast-check';

jest.mock('../../services/database.service.js', () => ({
  db: { query: jest.fn() },
}));

jest.mock('../../services/market-data.js', () => ({
  marketData: {
    getStockPrice: jest.fn(),
    getOptionPrice: jest.fn(),
  },
}));

import { shadowExecutor } from '../../services/shadow-executor.service.js';
import { db } from '../../services/database.service.js';
import { marketData } from '../../services/market-data.js';

describe('Shadow Executor properties', () => {
  const priceArb = fc.double({ min: 1, max: 1000, noNaN: true });

  beforeEach(() => {
    (db.query as jest.Mock).mockReset();
    (marketData.getStockPrice as jest.Mock).mockReset();
    (marketData.getOptionPrice as jest.Mock).mockReset();
  });

  test('Property 31: no live orders created', async () => {
    await fc.assert(
      fc.asyncProperty(priceArb, async (price) => {
        const queries: string[] = [];
        (db.query as jest.Mock).mockImplementation(async (text: string) => {
          queries.push(text);
          return { rows: [{ shadow_trade_id: 't-1' }] };
        });
        (marketData.getStockPrice as jest.Mock).mockResolvedValue(price);
        (marketData.getOptionPrice as jest.Mock).mockResolvedValue(price);

        await shadowExecutor.simulateExecution(
          {
            decision: 'approve',
            finalBias: 'bullish',
            finalConfidence: 60,
            contributingAgents: ['a'],
            consensusStrength: 60,
            reasons: [],
          },
          {
            signalId: 's-1',
            symbol: 'SPY',
            direction: 'long',
            timeframe: '1m',
            timestamp: new Date(),
            sessionType: 'RTH',
          },
          'exp-1'
        );

        expect(queries.some((q) => q.includes('INSERT INTO orders'))).toBe(false);
      }),
      { numRuns: 20 }
    );
  });

  test('Property 33: shadow trade uses real price', async () => {
    await fc.assert(
      fc.asyncProperty(priceArb, async (price) => {
        let entryPrice: number | null = null;
        (db.query as jest.Mock).mockImplementation(async (text: string, params?: any[]) => {
          if (text.includes('INSERT INTO shadow_trades')) {
            entryPrice = params?.[8] ?? null;
            return { rows: [{ shadow_trade_id: 't-1' }] };
          }
          return { rows: [] };
        });
        (marketData.getStockPrice as jest.Mock).mockResolvedValue(price);
        (marketData.getOptionPrice as jest.Mock).mockResolvedValue(price);

        await shadowExecutor.simulateExecution(
          {
            decision: 'approve',
            finalBias: 'bullish',
            finalConfidence: 60,
            contributingAgents: ['a'],
            consensusStrength: 60,
            reasons: [],
          },
          {
            signalId: 's-1',
            symbol: 'SPY',
            direction: 'long',
            timeframe: '1m',
            timestamp: new Date(),
            sessionType: 'RTH',
          },
          'exp-1'
        );

        expect(entryPrice).toBe(price);
      }),
      { numRuns: 20 }
    );
  });

  test('Property 32: shadow execution strike parity', async () => {
    await fc.assert(
      fc.asyncProperty(priceArb, async (price) => {
        let strikeValue: number | null = null;
        (db.query as jest.Mock).mockImplementation(async (text: string, params?: any[]) => {
          if (text.includes('INSERT INTO shadow_trades')) {
            strikeValue = params?.[4] ?? null;
            return { rows: [{ shadow_trade_id: 't-1' }] };
          }
          return { rows: [] };
        });
        (marketData.getStockPrice as jest.Mock).mockResolvedValue(price);
        (marketData.getOptionPrice as jest.Mock).mockResolvedValue(price);

        await shadowExecutor.simulateExecution(
          {
            decision: 'approve',
            finalBias: 'bullish',
            finalConfidence: 60,
            contributingAgents: ['a'],
            consensusStrength: 60,
            reasons: [],
          },
          {
            signalId: 's-1',
            symbol: 'SPY',
            direction: 'long',
            timeframe: '1m',
            timestamp: new Date(),
            sessionType: 'RTH',
          },
          'exp-1'
        );

        expect(strikeValue).toBe(Math.ceil(price));
      }),
      { numRuns: 20 }
    );
  });

  test('Property 34: shadow position P&L parity', async () => {
    await fc.assert(
      fc.asyncProperty(priceArb, priceArb, async (entry, current) => {
        let updatedPnl: number | null = null;
        (db.query as jest.Mock).mockImplementation(async (text: string, params?: any[]) => {
          if (text.includes('SELECT * FROM shadow_positions')) {
            return {
              rows: [
                {
                  shadow_position_id: 'p-1',
                  symbol: 'SPY',
                  strike: 100,
                  expiration: new Date('2026-01-01'),
                  type: 'call',
                  quantity: 1,
                  entry_price: entry,
                },
              ],
            };
          }
          if (text.includes('UPDATE shadow_positions')) {
            updatedPnl = params?.[1] ?? null;
          }
          return { rows: [] };
        });
        (marketData.getOptionPrice as jest.Mock).mockResolvedValue(current);

        await shadowExecutor.refreshShadowPositions();
        const expected = (current - entry) * 1 * 100;
        expect(updatedPnl).toBeCloseTo(expected, 8);
      }),
      { numRuns: 20 }
    );
  });
});
