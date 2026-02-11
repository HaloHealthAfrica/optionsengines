/**
 * Unit Tests: Orchestrator Worker Concurrency Scenarios
 */

import pg from 'pg';
import { config } from '../../config/index.js';
import { EngineCoordinator } from '../../orchestrator/engine-coordinator.js';
import { ExperimentManager } from '../../orchestrator/experiment-manager.js';
import { OrchestratorService } from '../../orchestrator/orchestrator-service.js';
import { PolicyEngine } from '../../orchestrator/policy-engine.js';
import { SignalProcessor } from '../../orchestrator/signal-processor.js';
import { TradeRecommendation } from '../../orchestrator/types.js';

const { Pool } = pg;

describe('Orchestrator Worker - Concurrency Scenarios', () => {
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

  test('Multiple workers process different signals', async () => {
    await lockExistingSignals(pool);
    const signalIds = await createSignals(pool, 4);
    await lockExistingSignals(pool, signalIds);
    await pool.query(
      `UPDATE signals SET processing_lock = FALSE WHERE signal_id = ANY($1::uuid[])`,
      [signalIds]
    );
    const serviceA = buildService(pool);
    const serviceB = buildService(pool);

    await Promise.all([
      serviceA.processSignals(2, signalIds),
      serviceB.processSignals(2, signalIds),
    ]);

    const processed = await pool.query(
      `SELECT COUNT(*)::int AS count FROM signals WHERE processed = TRUE AND signal_id = ANY($1::uuid[])`,
      [signalIds]
    );
    const experiments = await pool.query(
      `SELECT COUNT(*)::int AS count FROM experiments WHERE signal_id = ANY($1::uuid[])`,
      [signalIds]
    );

    expect(processed.rows[0].count).toBe(4);
    expect(experiments.rows[0].count).toBe(4);

    await cleanup(pool, signalIds);
  });

  test('Duplicate experiment prevention under concurrency', async () => {
    await lockExistingSignals(pool);
    const signalIds = await createSignals(pool, 1);
    await lockExistingSignals(pool, signalIds);
    await pool.query(
      `UPDATE signals SET processing_lock = FALSE WHERE signal_id = ANY($1::uuid[])`,
      [signalIds]
    );
    const serviceA = buildService(pool);
    const serviceB = buildService(pool);

    await Promise.all([
      serviceA.processSignals(1, signalIds),
      serviceB.processSignals(1, signalIds),
    ]);

    const experiments = await pool.query(
      `SELECT COUNT(*)::int AS count FROM experiments WHERE signal_id = $1`,
      [signalIds[0]]
    );
    expect(experiments.rows[0].count).toBe(1);

    await cleanup(pool, signalIds);
  });

  test('Processing lock cleared on failure', async () => {
    await lockExistingSignals(pool);
    const signalIds = await createSignals(pool, 1);
    await lockExistingSignals(pool, signalIds);
    await pool.query(
      `UPDATE signals SET processing_lock = FALSE WHERE signal_id = ANY($1::uuid[])`,
      [signalIds]
    );
    const failingCoordinator = new EngineCoordinator(
      async () => {
        throw new Error('Engine A failure');
      },
      async () => null
    );
    const service = buildService(pool, failingCoordinator);

    await service.processSignals(1, signalIds);

    const result = await pool.query(
      `SELECT processing_lock FROM signals WHERE signal_id = $1`,
      [signalIds[0]]
    );
    expect(result.rows[0].processing_lock).toBe(false);

    await cleanup(pool, signalIds);
  });
});

function buildService(pool: pg.Pool, coordinator?: EngineCoordinator) {
  const signalProcessor = new SignalProcessor(pool);
  const experimentManager = new ExperimentManager(pool);
  const policyEngine = new PolicyEngine(pool, async () => ({ engineA: true, engineB: true }));
  const engineCoordinator = coordinator ?? new EngineCoordinator(mockInvoker('A'), mockInvoker('B'));
  return new OrchestratorService(
    signalProcessor,
    experimentManager,
    policyEngine,
    engineCoordinator
  );
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

async function createSignals(pool: pg.Pool, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const result = await pool.query(
      `INSERT INTO signals (symbol, direction, timeframe, timestamp, status, raw_payload, signal_hash, processed, processing_lock)
       VALUES ('SPY', 'long', '5m', NOW(), 'pending', '{}', $1, FALSE, FALSE)
       RETURNING signal_id`,
      [`${i}`.repeat(64)]
    );
    ids.push(result.rows[0].signal_id);
  }
  return ids;
}

async function cleanup(pool: pg.Pool, signalIds: string[]) {
  await pool.query(`DELETE FROM execution_policies WHERE experiment_id IN (SELECT experiment_id FROM experiments WHERE signal_id = ANY($1::uuid[]))`, [
    signalIds,
  ]);
  await pool.query(`DELETE FROM market_contexts WHERE signal_id = ANY($1::uuid[])`, [signalIds]);
  await pool.query(`DELETE FROM experiments WHERE signal_id = ANY($1::uuid[])`, [signalIds]);
  await pool.query(`DELETE FROM signals WHERE signal_id = ANY($1::uuid[])`, [signalIds]);
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
