/**
 * Integration Test: Orchestrator signal processing flow
 */

import pg from 'pg';
import crypto from 'crypto';
import { config } from '../../config/index.js';
import { EngineCoordinator } from '../../orchestrator/engine-coordinator.js';
import { ExperimentManager } from '../../orchestrator/experiment-manager.js';
import { OrchestratorService } from '../../orchestrator/orchestrator-service.js';
import { PolicyEngine } from '../../orchestrator/policy-engine.js';
import { SignalProcessor } from '../../orchestrator/signal-processor.js';
import { TradeRecommendation } from '../../orchestrator/types.js';

const { Pool } = pg;

describe('Orchestrator - End-to-End Flow', () => {
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

  test('processSignals creates experiment, policy, and market context', async () => {
    await lockExistingSignals(pool);
    const signalId = await createSignal(pool);
    await lockExistingSignals(pool, [signalId]);
    const service = buildService(pool);
    await pool.query(`UPDATE signals SET processing_lock = FALSE WHERE signal_id = $1`, [
      signalId,
    ]);

    try {
      const results = await service.processSignals(1, [signalId]);
      expect(results.length).toBe(1);
      const result = results[0];
      expect(result.success).toBe(true);

      const expResult = await pool.query(
        `SELECT experiment_id FROM experiments WHERE signal_id = $1`,
        [signalId]
      );
      const policyResult = await pool.query(
        `SELECT policy_id FROM execution_policies WHERE experiment_id = $1`,
        [expResult.rows[0].experiment_id]
      );
      const contextResult = await pool.query(
        `SELECT context_id FROM market_contexts WHERE signal_id = $1`,
        [signalId]
      );

      expect(expResult.rows.length).toBe(1);
      expect(policyResult.rows.length).toBe(1);
      expect(contextResult.rows.length).toBe(1);
    } finally {
      await cleanup(pool, signalId);
    }
  });
});

function buildService(pool: pg.Pool) {
  const signalProcessor = new SignalProcessor(pool);
  const experimentManager = new ExperimentManager(pool);
  const policyEngine = new PolicyEngine(pool, async () => ({ engineA: true, engineB: true }));
  const engineCoordinator = new EngineCoordinator(mockInvoker('A'), mockInvoker('B'));
  return new OrchestratorService(signalProcessor, experimentManager, policyEngine, engineCoordinator);
}

function mockInvoker(engine: 'A' | 'B') {
  return async (): Promise<TradeRecommendation> => ({
    experiment_id: '00000000-0000-0000-0000-000000000000',
    engine,
    symbol: 'SPY',
    direction: 'long',
    strike: 100,
    expiration: new Date(),
    quantity: 1,
    entry_price: 1,
    is_shadow: false,
  });
}

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

async function cleanup(pool: pg.Pool, signalId: string) {
  await pool.query(`DELETE FROM execution_policies WHERE experiment_id IN (SELECT experiment_id FROM experiments WHERE signal_id = $1)`, [
    signalId,
  ]);
  await pool.query(`DELETE FROM market_contexts WHERE signal_id = $1`, [signalId]);
  await pool.query(`DELETE FROM experiments WHERE signal_id = $1`, [signalId]);
  await pool.query(`DELETE FROM signals WHERE signal_id = $1`, [signalId]);
}

async function lockExistingSignals(pool: pg.Pool, signalIds: string[] = []) {
  if (signalIds.length === 0) {
    await pool.query(`UPDATE signals SET processing_lock = TRUE WHERE processed = FALSE`);
    return;
  }
  await pool.query(
    `UPDATE signals
     SET processing_lock = TRUE
     WHERE processed = FALSE AND signal_id != ALL($1::uuid[])`,
    [signalIds]
  );
}
