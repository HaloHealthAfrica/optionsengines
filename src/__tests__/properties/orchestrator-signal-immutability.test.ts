/**
 * Property-Based Test: Signal Immutability During Distribution
 * Property 4: Signal hash remains unchanged during processing
 * Validates: Requirements 1.4, 7.5
 */

import fc from 'fast-check';
import pg from 'pg';
import { config } from '../../config/index.js';
import { SignalProcessor } from '../../orchestrator/signal-processor.js';

const { Pool } = pg;

describe('Property 4: Signal Immutability During Distribution', () => {
  jest.setTimeout(20000);
  let pool: pg.Pool;
  let processor: SignalProcessor;

  beforeAll(() => {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 5,
    });
    processor = new SignalProcessor(pool);
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

  test('Property: Signal hash unchanged before and after distribution', async () => {
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
          if (!signalId) {
            throw new Error('Signal ID not set');
          }

          // Get signal hash before processing
          const beforeResult = await pool.query(
            `SELECT signal_hash FROM signals WHERE signal_id = $1`,
            [signalId]
          );
          const hashBefore = beforeResult.rows[0].signal_hash;

          // Simulate distribution by creating market context
          const signal = {
            signal_id: signalId,
            symbol: signalData.symbol,
            direction: signalData.direction as 'long' | 'short',
            timeframe: signalData.timeframe,
            timestamp: signalData.timestamp,
            signal_hash: signalData.signal_hash,
            raw_payload: signalData.raw_payload,
            processed: false,
          };

          await processor.createMarketContext(signal);

          // Get signal hash after processing
          const afterResult = await pool.query(
            `SELECT signal_hash FROM signals WHERE signal_id = $1`,
            [signalId]
          );
          const hashAfter = afterResult.rows[0].signal_hash;

          // Verify immutability
          expect(hashBefore).toBe(signalData.signal_hash);
          expect(hashAfter).toBe(signalData.signal_hash);
          expect(hashBefore).toBe(hashAfter);

        } finally {
          if (signalId) {
            await pool.query(`DELETE FROM market_contexts WHERE signal_id = $1`, [signalId]);
            await pool.query(`DELETE FROM signals WHERE signal_id = $1`, [signalId]);
          }
        }
      }),
      { numRuns: 30 }
    );
  });
});
