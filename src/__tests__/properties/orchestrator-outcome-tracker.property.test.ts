/**
 * Property-Based Tests: Outcome Tracker
 * Properties 17-20
 */

import fc from 'fast-check';
import pg from 'pg';
import crypto from 'crypto';
import { config } from '../../config/index.js';
import { OutcomeTracker } from '../../orchestrator/outcome-tracker.js';
import { TradeOutcome } from '../../orchestrator/types.js';

const { Pool } = pg;

describe('OutcomeTracker - Property Tests', () => {
  jest.setTimeout(60000);
  let pool: pg.Pool;
  let tracker: OutcomeTracker;

  beforeAll(() => {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 5,
    });
    tracker = new OutcomeTracker(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  const outcomeArb = fc.record({
    engine: fc.constantFrom<'A' | 'B'>('A', 'B'),
    trade_id: fc.uuid(),
    entry_price: fc.float({ min: 1, max: 1000, noNaN: true }),
    exit_price: fc.float({ min: 1, max: 1000, noNaN: true }),
    pnl: fc.float({ min: -500, max: 500, noNaN: true }),
    exit_reason: fc.constantFrom('stop_loss', 'take_profit', 'manual', 'expiration'),
    entry_time: fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }),
    exit_time: fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }),
    is_shadow: fc.boolean(),
  });

  test('Property 17: Trade outcome record completeness', async () => {
    await fc.assert(
      fc.asyncProperty(outcomeArb, async (data) => {
        const signalId = await createSignal(pool);
        const experimentId = await createExperiment(pool, signalId);

        try {
          const outcome: TradeOutcome = {
            ...data,
            experiment_id: experimentId,
          };

          const stored = await tracker.recordOutcome(outcome);
          expect(stored.experiment_id).toBe(experimentId);
          expect(stored.engine).toBe(data.engine);
          expect(stored.trade_id).toBe(data.trade_id);
        } finally {
          await cleanup(pool, experimentId, signalId);
        }
      }),
      { numRuns: 10 }
    );
  });

  test('Property 18: Performance aggregation by engine', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(outcomeArb, { minLength: 3, maxLength: 6 }),
        async (outcomes) => {
          const signalId = await createSignal(pool);
          const experimentId = await createExperiment(pool, signalId);

          try {
            for (const outcome of outcomes) {
              await tracker.recordOutcome({ ...outcome, experiment_id: experimentId });
            }

            const metricsA = await tracker.getPerformanceMetrics('A');
            const metricsB = await tracker.getPerformanceMetrics('B');

            const countA = outcomes.filter((o) => o.engine === 'A').length;
            const countB = outcomes.filter((o) => o.engine === 'B').length;

            expect(metricsA.total_trades).toBeGreaterThanOrEqual(countA);
            expect(metricsB.total_trades).toBeGreaterThanOrEqual(countB);
          } finally {
            await cleanup(pool, experimentId, signalId);
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  test('Property 19: Performance metrics calculation correctness', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(outcomeArb, { minLength: 2, maxLength: 5 }),
        async (outcomes) => {
          const signalId = await createSignal(pool);
          const experimentId = await createExperiment(pool, signalId);

          try {
            for (const outcome of outcomes) {
              await tracker.recordOutcome({ ...outcome, experiment_id: experimentId, engine: 'A' });
            }

            const metrics = await tracker.getPerformanceMetrics('A');
            const totalTrades = outcomes.length;
            const normalizedPnL = outcomes.map((o) => Math.round(o.pnl * 100) / 100);
            const winning = normalizedPnL.filter((pnl) => pnl > 0).length;
            const totalPnL = normalizedPnL.reduce((sum, pnl) => sum + pnl, 0);

            expect(metrics.total_trades).toBeGreaterThanOrEqual(totalTrades);
            expect(metrics.winning_trades).toBeGreaterThanOrEqual(winning);
            expect(metrics.total_pnl).toBeCloseTo(totalPnL, 5);
          } finally {
            await cleanup(pool, experimentId, signalId);
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  test('Property 20: Experiment traceability', async () => {
    await fc.assert(
      fc.asyncProperty(outcomeArb, async (data) => {
        const signalId = await createSignal(pool);
        const experimentId = await createExperiment(pool, signalId);

        try {
          await tracker.recordOutcome({ ...data, experiment_id: experimentId });
          const result = await pool.query(
            `SELECT experiment_id FROM trade_outcomes WHERE experiment_id = $1`,
            [experimentId]
          );
          expect(result.rows.length).toBeGreaterThan(0);
          expect(result.rows[0].experiment_id).toBe(experimentId);
        } finally {
          await cleanup(pool, experimentId, signalId);
        }
      }),
      { numRuns: 10 }
    );
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
  await pool.query(`DELETE FROM trade_outcomes WHERE experiment_id = $1`, [experimentId]);
  await pool.query(`DELETE FROM experiments WHERE experiment_id = $1`, [experimentId]);
  await pool.query(`DELETE FROM signals WHERE signal_id = $1`, [signalId]);
}
