/**
 * Property-Based Test: Market Context Creation
 * Property 2: Market contexts store complete snapshot data for replay
 * Validates: Requirements 1.2
 */

import fc from 'fast-check';
import pg from 'pg';
import { config } from '../../config/index.js';
import { MarketContextSchema } from '../../orchestrator/schemas.js';

const { Pool } = pg;

describe('Property 2: Market Context Creation', () => {
  jest.setTimeout(60000);
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 5,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  const signalArb = fc.record({
    symbol: fc.constantFrom('SPY', 'QQQ', 'AAPL', 'TSLA', 'MSFT'),
    direction: fc.constantFrom('long', 'short'),
    timeframe: fc.constantFrom('1m', '5m', '15m', '1h', '1d'),
    timestamp: fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }),
    signal_hash: fc.hexaString({ minLength: 64, maxLength: 64 }),
  });

  const contextArb = fc.record({
    timestamp: fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }),
    symbol: fc.constantFrom('SPY', 'QQQ', 'AAPL', 'TSLA', 'MSFT'),
    current_price: fc.float({ min: 1, max: 1000, noNaN: true }),
    bid: fc.float({ min: 1, max: 1000, noNaN: true }),
    ask: fc.float({ min: 1, max: 1000, noNaN: true }),
    volume: fc.integer({ min: 0, max: 1_000_000 }),
    indicators: fc.dictionary(
      fc.string({ minLength: 1, maxLength: 12 }),
      fc.float({ min: -1000, max: 1000, noNaN: true })
    ),
    context_hash: fc.hexaString({ minLength: 64, maxLength: 64 }),
  });

  test('Property: Market contexts persist required snapshot fields', async () => {
    await fc.assert(
      fc.asyncProperty(signalArb, contextArb, async (signalData, contextData) => {
        let signalId: string | undefined;
        let contextId: string | undefined;
        try {
          const signalResult = await pool.query(
            `INSERT INTO signals (symbol, direction, timeframe, timestamp, status, raw_payload, signal_hash, processed, processing_lock)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE)
             RETURNING signal_id`,
            [
              signalData.symbol,
              signalData.direction,
              signalData.timeframe,
              signalData.timestamp,
              'pending',
              {},
              signalData.signal_hash,
              false,
            ]
          );

          signalId = signalResult.rows[0].signal_id;

          const contextResult = await pool.query(
            `INSERT INTO market_contexts
             (signal_id, timestamp, symbol, current_price, bid, ask, volume, indicators, context_hash)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING context_id`,
            [
              signalId,
              contextData.timestamp,
              contextData.symbol,
              contextData.current_price,
              contextData.bid,
              contextData.ask,
              contextData.volume,
              contextData.indicators,
              contextData.context_hash,
            ]
          );

          contextId = contextResult.rows[0].context_id;

          const result = await pool.query(
            `SELECT context_id, signal_id, timestamp, symbol, current_price, bid, ask, volume, indicators, context_hash, created_at
             FROM market_contexts
             WHERE context_id = $1`,
            [contextId]
          );

          const row = result.rows[0];

          const normalized = {
            ...row,
            current_price: Number(row.current_price),
            bid: Number(row.bid),
            ask: Number(row.ask),
          };

          const parsed = MarketContextSchema.parse(normalized);

          expect(parsed.signal_id).toBe(signalId);
          expect(parsed.symbol).toBe(contextData.symbol);
          expect(parsed.context_hash).toBe(contextData.context_hash);
          expect(parsed.volume).toBe(contextData.volume);
          expect(parsed.current_price).toBeCloseTo(contextData.current_price, 2);
          expect(parsed.bid).toBeCloseTo(contextData.bid, 2);
          expect(parsed.ask).toBeCloseTo(contextData.ask, 2);
          expect(parsed.indicators).toEqual(contextData.indicators);

        } finally {
          if (contextId) {
            await pool.query(`DELETE FROM market_contexts WHERE context_id = $1`, [contextId]);
          }
          if (signalId) {
            await pool.query(`DELETE FROM signals WHERE signal_id = $1`, [signalId]);
          }
        }
      }),
      { numRuns: 10 }
    );
  });
});
