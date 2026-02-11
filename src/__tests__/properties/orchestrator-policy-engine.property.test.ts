/**
 * Property-Based Tests: Policy Engine Enforcement
 * Properties 10-13: Execution policy enforcement and record existence
 * Validates: Requirements 3.2, 3.4, 3.5, 3.6
 */

import fc from 'fast-check';
import pg from 'pg';
import { config } from '../../config/index.js';
import { PolicyEngine } from '../../orchestrator/policy-engine.js';

const { Pool } = pg;

describe('PolicyEngine - Enforcement Properties', () => {
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

  const signalArb = fc.record({
    signal_id: fc.uuid(),
    signal_hash: fc.hexaString({ minLength: 64, maxLength: 64 }),
  });

  test('Property 10: ENGINE_A_PRIMARY enforcement in paper mode', async () => {
    if (config.appMode !== 'PAPER') {
      return;
    }

    await fc.assert(
      fc.asyncProperty(signalArb, async ({ signal_id, signal_hash }) => {
        const signal = await createSignal(pool, signal_id, signal_hash);
        const experimentId = await createExperiment(pool, signal.signal_id);
        const engine = new PolicyEngine(pool, async () => ({ engineA: true, engineB: true }));

        try {
          const policy = await engine.getExecutionPolicy(experimentId, 'v1.0');
          expect(policy.execution_mode).toBe('ENGINE_A_PRIMARY');
          expect(policy.executed_engine).toBe('A');
        } finally {
          await deletePolicy(pool, experimentId);
          await deleteExperiment(pool, experimentId);
          await deleteSignal(pool, signal.signal_id);
        }
      }),
      { numRuns: 10 }
    );
  });

  test('Property 11: Shadow-only mode safety when Engine A unavailable', async () => {
    await fc.assert(
      fc.asyncProperty(signalArb, async ({ signal_id, signal_hash }) => {
        const signal = await createSignal(pool, signal_id, signal_hash);
        const experimentId = await createExperiment(pool, signal.signal_id);
        const engine = new PolicyEngine(pool, async () => ({ engineA: false, engineB: true }));

        try {
          const policy = await engine.getExecutionPolicy(experimentId, 'v1.0');
          expect(policy.execution_mode).toBe('SHADOW_ONLY');
          expect(policy.executed_engine).toBeNull();
        } finally {
          await deletePolicy(pool, experimentId);
          await deleteExperiment(pool, experimentId);
          await deleteSignal(pool, signal.signal_id);
        }
      }),
      { numRuns: 10 }
    );
  });

  test('Property 12: Mutual exclusion of real trade execution', async () => {
    await fc.assert(
      fc.asyncProperty(signalArb, async ({ signal_id, signal_hash }) => {
        const signal = await createSignal(pool, signal_id, signal_hash);
        const experimentId = await createExperiment(pool, signal.signal_id);
        const engine = new PolicyEngine(pool, async () => ({ engineA: true, engineB: true }));

        try {
          const policy = await engine.getExecutionPolicy(experimentId, 'v1.0');
          if (policy.executed_engine && policy.shadow_engine) {
            expect(policy.executed_engine).not.toBe(policy.shadow_engine);
          }
        } finally {
          await deletePolicy(pool, experimentId);
          await deleteExperiment(pool, experimentId);
          await deleteSignal(pool, signal.signal_id);
        }
      }),
      { numRuns: 10 }
    );
  });

  test('Property 13: Execution policy record existence', async () => {
    await fc.assert(
      fc.asyncProperty(signalArb, async ({ signal_id, signal_hash }) => {
        const signal = await createSignal(pool, signal_id, signal_hash);
        const experimentId = await createExperiment(pool, signal.signal_id);
        const engine = new PolicyEngine(pool, async () => ({ engineA: true, engineB: true }));

        try {
          const policy = await engine.getExecutionPolicy(experimentId, 'v1.0');
          const result = await pool.query(
            `SELECT policy_id FROM execution_policies WHERE experiment_id = $1`,
            [experimentId]
          );
          expect(result.rows.length).toBe(1);
          expect(result.rows[0].policy_id).toBe(policy.policy_id);
        } finally {
          await deletePolicy(pool, experimentId);
          await deleteExperiment(pool, experimentId);
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

  return { signal_id: signalId };
}

async function createExperiment(pool: pg.Pool, signalId: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO experiments (signal_id, variant, assignment_hash, split_percentage, policy_version)
     VALUES ($1, 'A', $2, 0.5, 'v1.0')
     RETURNING experiment_id`,
    [signalId, 'a'.repeat(64)]
  );
  return result.rows[0].experiment_id;
}

async function deletePolicy(pool: pg.Pool, experimentId: string) {
  await pool.query(`DELETE FROM execution_policies WHERE experiment_id = $1`, [experimentId]);
}

async function deleteExperiment(pool: pg.Pool, experimentId: string) {
  await pool.query(`DELETE FROM experiments WHERE experiment_id = $1`, [experimentId]);
}

async function deleteSignal(pool: pg.Pool, signalId: string) {
  await pool.query(`DELETE FROM signals WHERE signal_id = $1`, [signalId]);
}
