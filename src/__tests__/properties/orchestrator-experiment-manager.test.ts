/**
 * Property-Based Tests: Experiment Manager Determinism and Completeness
 * Properties 6-9: Deterministic assignment and experiment record integrity
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5
 */

import fc from 'fast-check';
import pg from 'pg';
import { config } from '../../config/index.js';
import { ExperimentManager } from '../../orchestrator/experiment-manager.js';
import { ExperimentSchema } from '../../orchestrator/schemas.js';

const { Pool } = pg;

describe('ExperimentManager - Determinism and Completeness', () => {
  jest.setTimeout(30000);
  let pool: pg.Pool;
  let manager: ExperimentManager;

  beforeAll(() => {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 5,
    });
    manager = new ExperimentManager(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  const signalArb = fc.record({
    signal_id: fc.uuid(),
    signal_hash: fc.hexaString({ minLength: 64, maxLength: 64 }),
  });

  const splitArb = fc.float({ min: 0, max: 1, noNaN: true });

  test('Property 7: Deterministic assignment hash generation', async () => {
    await fc.assert(
      fc.asyncProperty(signalArb, async ({ signal_id, signal_hash }) => {
        const hash1 = manager.computeAssignmentHash(signal_id, signal_hash);
        const hash2 = manager.computeAssignmentHash(signal_id, signal_hash);
        expect(hash1).toBe(hash2);
        expect(hash1).toHaveLength(64);
      }),
      { numRuns: 100 }
    );
  });

  test('Property 8: Deterministic variant assignment (replay)', async () => {
    await fc.assert(
      fc.asyncProperty(signalArb, splitArb, async ({ signal_id, signal_hash }, split) => {
        const assignmentHash = manager.computeAssignmentHash(signal_id, signal_hash);
        const variant1 = manager.getVariantAssignment(assignmentHash, split);
        const variant2 = manager.getVariantAssignment(assignmentHash, split);
        expect(variant1).toBe(variant2);
      }),
      { numRuns: 100 }
    );
  });

  test('Property 6: Experiment creation idempotency', async () => {
    await fc.assert(
      fc.asyncProperty(signalArb, splitArb, async ({ signal_id, signal_hash }, split) => {
        const signal = await createSignal(pool, signal_id, signal_hash);
        try {
          const first = await manager.createExperiment(signal, split, 'v1.0');
          const second = await manager.createExperiment(signal, split, 'v1.0');

          expect(first.experiment_id).toBe(second.experiment_id);
          expect(first.variant).toBe(second.variant);
          expect(first.assignment_hash).toBe(second.assignment_hash);

          const count = await countExperiments(pool, signal.signal_id);
          expect(count).toBe(1);
        } finally {
          await deleteExperimentBySignal(pool, signal.signal_id);
          await deleteSignal(pool, signal.signal_id);
        }
      }),
      { numRuns: 10 }
    );
  });

  test('Property 9: Experiment record completeness', async () => {
    await fc.assert(
      fc.asyncProperty(signalArb, splitArb, async ({ signal_id, signal_hash }, split) => {
        const signal = await createSignal(pool, signal_id, signal_hash);
        try {
          const experiment = await manager.createExperiment(signal, split, 'v1.0');
          const parsed = ExperimentSchema.parse(experiment);

          expect(parsed.signal_id).toBe(signal.signal_id);
          expect(parsed.assignment_hash).toHaveLength(64);
          expect(['A', 'B']).toContain(parsed.variant);
          expect(parsed.created_at).toBeDefined();
        } finally {
          await deleteExperimentBySignal(pool, signal.signal_id);
          await deleteSignal(pool, signal.signal_id);
        }
      }),
      { numRuns: 10 }
    );
  });
});

async function createSignal(pool: pg.Pool, signalId: string, signalHash: string) {
  await pool.query(
    `INSERT INTO signals (signal_id, symbol, direction, timeframe, timestamp, status, raw_payload, signal_hash, processed, processing_lock)
     VALUES ($1, 'SPY', 'long', '5m', NOW(), 'pending', '{}', $2, FALSE, FALSE)
     ON CONFLICT (signal_id) DO NOTHING`,
    [signalId, signalHash]
  );

  const result = await pool.query(
    `SELECT signal_id, timestamp FROM signals WHERE signal_id = $1`,
    [signalId]
  );

  return {
    signal_id: result.rows[0].signal_id,
    symbol: 'SPY',
    direction: 'long' as const,
    timeframe: '5m',
    timestamp: result.rows[0].timestamp,
    signal_hash: signalHash,
    raw_payload: {},
    processed: false,
  };
}

async function deleteExperimentBySignal(pool: pg.Pool, signalId: string) {
  await pool.query(`DELETE FROM experiments WHERE signal_id = $1`, [signalId]);
}

async function deleteSignal(pool: pg.Pool, signalId: string) {
  await pool.query(`DELETE FROM signals WHERE signal_id = $1`, [signalId]);
}

async function countExperiments(pool: pg.Pool, signalId: string): Promise<number> {
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM experiments WHERE signal_id = $1`, [
    signalId,
  ]);
  return result.rows[0]?.count ?? 0;
}
