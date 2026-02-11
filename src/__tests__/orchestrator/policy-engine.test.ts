/**
 * Unit Tests: Policy Engine Example Scenarios
 */

import pg from 'pg';
import crypto from 'crypto';
import { config } from '../../config/index.js';
import { PolicyEngine } from '../../orchestrator/policy-engine.js';

const { Pool } = pg;

describe('PolicyEngine - Example Scenarios', () => {
  jest.setTimeout(20000);
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

  test('Example 1: Paper mode with Engine A available', async () => {
    if (config.appMode !== 'PAPER') {
      return;
    }

    const signalId = await createSignal(pool);
    const experimentId = await createExperiment(pool, signalId);
    const engine = new PolicyEngine(pool, async () => ({ engineA: true, engineB: true }));

    try {
      const policy = await engine.getExecutionPolicy(experimentId, 'v1.0');
      expect(policy.execution_mode).toBe('ENGINE_A_PRIMARY');
      expect(policy.executed_engine).toBe('A');
      expect(policy.shadow_engine).toBe('B');
    } finally {
      await cleanup(pool, experimentId, signalId);
    }
  });

  test('Example 2: Engine A unavailable', async () => {
    const signalId = await createSignal(pool);
    const experimentId = await createExperiment(pool, signalId);
    const engine = new PolicyEngine(pool, async () => ({ engineA: false, engineB: true }));

    try {
      const policy = await engine.getExecutionPolicy(experimentId, 'v1.0');
      expect(policy.execution_mode).toBe('SHADOW_ONLY');
      expect(policy.executed_engine).toBeNull();
    } finally {
      await cleanup(pool, experimentId, signalId);
    }
  });

  test('Example 3: Configuration loading uses APP_MODE', () => {
    expect(config.appMode === 'PAPER' || config.appMode === 'LIVE').toBe(true);
  });

  test('Example 4: Supported execution modes validation', () => {
    const engine = new PolicyEngine(pool, async () => ({ engineA: true, engineB: true }));
    expect(() => engine.validatePolicy('ENGINE_A_PRIMARY', 'A', 'B')).not.toThrow();
    expect(() => engine.validatePolicy('SHADOW_ONLY', null, null)).not.toThrow();
  });

  test('Example 5: Invalid configuration rejection', () => {
    const engine = new PolicyEngine(pool, async () => ({ engineA: true, engineB: true }));
    expect(() => engine.validatePolicy('ENGINE_A_PRIMARY', 'A', 'A')).toThrow();
  });
});

async function createSignal(pool: pg.Pool): Promise<string> {
  const hash = crypto.randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64);
  const result = await pool.query(
    `INSERT INTO signals (symbol, direction, timeframe, timestamp, status, raw_payload, signal_hash, processed, processing_lock)
     VALUES ('SPY', 'long', '5m', NOW(), 'pending', '{}', $1, FALSE, FALSE)
     RETURNING signal_id`,
    [hash]
  );
  return result.rows[0].signal_id;
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

async function cleanup(pool: pg.Pool, experimentId: string, signalId: string) {
  await pool.query(`DELETE FROM execution_policies WHERE experiment_id = $1`, [experimentId]);
  await pool.query(`DELETE FROM experiments WHERE experiment_id = $1`, [experimentId]);
  await pool.query(`DELETE FROM signals WHERE signal_id = $1`, [signalId]);
}
