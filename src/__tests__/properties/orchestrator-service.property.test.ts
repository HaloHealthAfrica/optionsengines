/**
 * Property-Based Tests: Orchestrator Service Core Flow
 * Properties 14, 16, 24, 25
 */

import fc from 'fast-check';
import pg from 'pg';
import { config } from '../../config/index.js';
import { EngineCoordinator } from '../../orchestrator/engine-coordinator.js';
import { ExperimentManager } from '../../orchestrator/experiment-manager.js';
import { OrchestratorService } from '../../orchestrator/orchestrator-service.js';
import { PolicyEngine } from '../../orchestrator/policy-engine.js';
import { SignalProcessor } from '../../orchestrator/signal-processor.js';
import { TradeRecommendation } from '../../orchestrator/types.js';

const { Pool } = pg;

describe('OrchestratorService - Property Tests', () => {
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
    signal_id: fc.uuid(),
    signal_hash: fc.hexaString({ minLength: 64, maxLength: 64 }),
  });

  test('Property 14: Shadow trade creation requirement', async () => {
    if (config.appMode !== 'PAPER') {
      return;
    }

    await fc.assert(
      fc.asyncProperty(signalArb, async ({ signal_id, signal_hash }) => {
        const signalId = await createSignal(pool, signal_id, signal_hash);
        await pool.query(`UPDATE signals SET processing_lock = FALSE WHERE signal_id = $1`, [
          signalId,
        ]);
        const service = buildService(pool, async () => ({ engineA: true, engineB: true }));

        try {
          const result = await service.processSignals(1, [signalId]);
          expect(result.length).toBe(1);
          const res = result[0];
          expect(res.policy.execution_mode).toBe('ENGINE_A_PRIMARY');
          expect(res.engine_b_recommendation?.is_shadow).toBe(true);
        } finally {
          await cleanup(pool, signalId);
        }
      }),
      { numRuns: 2 }
    );
  });

  test('Property 16: Shadow trade attribution uses experiment_id', async () => {
    await fc.assert(
      fc.asyncProperty(signalArb, async ({ signal_id, signal_hash }) => {
        const signalId = await createSignal(pool, signal_id, signal_hash);
        await pool.query(`UPDATE signals SET processing_lock = FALSE WHERE signal_id = $1`, [
          signalId,
        ]);
        const service = buildService(pool, async () => ({ engineA: false, engineB: true }));

        try {
          const result = await service.processSignals(1, [signalId]);
          expect(result.length).toBe(1);
          const res = result[0];
          if (res.engine_b_recommendation) {
            expect(res.engine_b_recommendation.experiment_id).toBe(res.experiment.experiment_id);
          }
        } finally {
          await cleanup(pool, signalId);
        }
      }),
      { numRuns: 2 }
    );
  });

  test('Property 24: Single signal record per webhook', async () => {
    const signalId = await createSignal(
      pool,
      '00000000-0000-0000-0000-000000000011',
      'b'.repeat(64)
    );
    await pool.query(`UPDATE signals SET processing_lock = FALSE WHERE signal_id = $1`, [signalId]);
    const service = buildService(pool, async () => ({ engineA: false, engineB: true }));

    try {
      const before = await countSignals(pool);
      await service.processSignals(1, [signalId]);
      const after = await countSignals(pool);
      expect(after).toBe(before);
    } finally {
      await cleanup(pool, signalId);
    }
  });

  test('Property 25: Signal processing status update', async () => {
    await fc.assert(
      fc.asyncProperty(signalArb, async ({ signal_id, signal_hash }) => {
        const signalId = await createSignal(pool, signal_id, signal_hash);
        await pool.query(`UPDATE signals SET processing_lock = FALSE WHERE signal_id = $1`, [
          signalId,
        ]);
        const service = buildService(pool, async () => ({ engineA: false, engineB: true }));

        try {
          await service.processSignals(1, [signalId]);
          const result = await pool.query(`SELECT processed FROM signals WHERE signal_id = $1`, [
            signalId,
          ]);
          expect(result.rows[0].processed).toBe(true);
        } finally {
          await cleanup(pool, signalId);
        }
      }),
      { numRuns: 2 }
    );
  });
});

function buildService(pool: pg.Pool, availabilityProvider: () => Promise<{ engineA: boolean; engineB: boolean }>) {
  const signalProcessor = new SignalProcessor(pool);
  const experimentManager = new ExperimentManager(pool);
  const policyEngine = new PolicyEngine(pool, availabilityProvider);
  const engineCoordinator = new EngineCoordinator(mockInvoker('A'), mockInvoker('B'));
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

async function createSignal(pool: pg.Pool, signalId: string, signalHash: string) {
  await pool.query(`UPDATE signals SET processing_lock = TRUE WHERE processed = FALSE`);
  await pool.query(
    `INSERT INTO signals (signal_id, symbol, direction, timeframe, timestamp, status, raw_payload, signal_hash, processed, processing_lock)
     VALUES ($1, 'SPY', 'long', '5m', NOW(), 'pending', '{}', $2, FALSE, FALSE)
     ON CONFLICT (signal_id) DO NOTHING`,
    [signalId, signalHash]
  );
  const result = await pool.query(`SELECT signal_id FROM signals WHERE signal_id = $1`, [signalId]);
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

async function countSignals(pool: pg.Pool): Promise<number> {
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM signals`);
  return result.rows[0]?.count ?? 0;
}
