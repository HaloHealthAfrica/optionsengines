/**
 * Property-Based Test: Signal Retrieval Completeness
 * Property 1: Signal records include all required fields on retrieval
 * Validates: Requirements 1.1
 */

import fc from 'fast-check';
import pg from 'pg';
import { config } from '../../config/index.js';
import { SignalSchema } from '../../orchestrator/schemas.js';

const { Pool } = pg;

describe('Property 1: Signal Retrieval Completeness', () => {
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
    raw_payload: fc.dictionary(
      fc.string({ minLength: 1, maxLength: 12 }),
      fc.oneof(
        fc.string({ maxLength: 20 }),
        fc.integer({ min: -1000, max: 1000 }),
        fc.boolean()
      )
    ),
  });

  test('Property: Retrieved signals contain required fields', async () => {
    await fc.assert(
      fc.asyncProperty(signalArb, async (signalData) => {
        let signalId: string | undefined;
        try {
          const insertResult = await pool.query(
            `INSERT INTO signals (symbol, direction, timeframe, timestamp, status, raw_payload, signal_hash, processed, processing_lock)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE)
             RETURNING signal_id`,
            [
              signalData.symbol,
              signalData.direction,
              signalData.timeframe,
              signalData.timestamp,
              'pending',
              signalData.raw_payload,
              signalData.signal_hash,
              false,
            ]
          );

          signalId = insertResult.rows[0].signal_id;

          const result = await pool.query(
            `SELECT signal_id, symbol, direction, timeframe, timestamp, signal_hash, raw_payload, processed, status, experiment_id, created_at
             FROM signals
             WHERE signal_id = $1`,
            [signalId]
          );

          const row = result.rows[0];

          const parsed = SignalSchema.parse({
            ...row,
            experiment_id: row.experiment_id ?? undefined,
          });

          expect(parsed.signal_id).toBe(signalId);
          expect(parsed.symbol).toBe(signalData.symbol);
          expect(parsed.direction).toBe(signalData.direction);
          expect(parsed.timeframe).toBe(signalData.timeframe);
          expect(parsed.signal_hash).toBe(signalData.signal_hash);
          expect(parsed.raw_payload).toEqual(signalData.raw_payload);
          expect(parsed.processed).toBe(false);
        } finally {
          if (signalId) {
            await pool.query(`DELETE FROM signals WHERE signal_id = $1`, [signalId]);
          }
        }
      }),
      { numRuns: 10 }
    );
  });
});
