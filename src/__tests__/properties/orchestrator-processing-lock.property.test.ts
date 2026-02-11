/**
 * Property-Based Test: Processing Lock During Signal Processing
 * Property 26
 */

import fc from 'fast-check';
import pg from 'pg';
import { config } from '../../config/index.js';
import { SignalProcessor } from '../../orchestrator/signal-processor.js';

const { Pool } = pg;

describe('Signal Processing Lock - Property Test', () => {
  jest.setTimeout(30000);
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

  test('Property 26: No duplicate processing across workers', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 4, max: 8 }), async (count) => {
        const signalIds: string[] = [];
        for (let i = 0; i < count; i++) {
          const result = await pool.query(
            `INSERT INTO signals (symbol, direction, timeframe, timestamp, status, raw_payload, signal_hash, processed, processing_lock)
             VALUES ('SPY', 'long', '5m', NOW(), 'pending', '{}', $1, FALSE, FALSE)
             RETURNING signal_id`,
            [`${i}`.repeat(64)]
          );
          signalIds.push(result.rows[0].signal_id);
        }

        const processorA = new SignalProcessor(pool);
        const processorB = new SignalProcessor(pool);

        const [batchA, batchB] = await Promise.all([
          processorA.getUnprocessedSignals(Math.floor(count / 2)),
          processorB.getUnprocessedSignals(Math.floor(count / 2)),
        ]);

        const idsA = new Set(batchA.map((s) => s.signal_id));
        const overlap = batchB.filter((s) => idsA.has(s.signal_id));
        expect(overlap.length).toBe(0);
        
        await pool.query(`DELETE FROM signals WHERE signal_id = ANY($1::uuid[])`, [signalIds]);
      }),
      { numRuns: 20 }
    );
  });
});
