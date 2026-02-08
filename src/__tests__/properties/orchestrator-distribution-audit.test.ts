/**
 * Property-Based Test: Distribution Audit Trail
 * Property 5: Market context records exist for distributed signals
 * Validates: Requirements 1.5
 */

import fc from 'fast-check';
import pg from 'pg';
import { config } from '../../config/index.js';
import { SignalProcessor } from '../../orchestrator/signal-processor.js';

const { Pool } = pg;

describe('Property 5: Distribution Audit Trail', () => {
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

  test('Property: Market context record exists after signal distribution', async () => {
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

          // Create signal object
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

          // Distribute signal (creates market context)
          const marketContext = await processor.createMarketContext(signal);

          // Verify audit trail exists
          const auditResult = await pool.query(
            `SELECT context_id, signal_id, timestamp, context_hash, created_at
             FROM market_contexts
             WHERE signal_id = $1`,
            [signalId]
          );

          expect(auditResult.rows.length).toBe(1);
          
          const auditRecord = auditResult.rows[0];
          expect(auditRecord.signal_id).toBe(signalId);
          expect(auditRecord.context_hash).toBe(marketContext.context_hash);
          expect(auditRecord.context_hash).toHaveLength(64); // SHA-256 hash
          expect(auditRecord.created_at).toBeDefined();

          // Verify context can be retrieved
          const retrievedContext = await processor.getMarketContext(signalId);
          expect(retrievedContext).not.toBeNull();
          expect(retrievedContext?.signal_id).toBe(signalId);
          expect(retrievedContext?.context_hash).toBe(marketContext.context_hash);

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
