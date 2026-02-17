/**
 * Cron API routes for serverless (Vercel) processing
 *
 * Used when workers don't run (e.g. Vercel serverless). A cron job calls these
 * endpoints periodically to process the queue. DB locking (processing_lock,
 * FOR UPDATE SKIP LOCKED) prevents duplicate processing across concurrent runs.
 */

import { Router, Request, Response } from 'express';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { createOrchestratorService } from '../orchestrator/container.js';
import { createEngineAInvoker, createEngineBInvoker } from '../orchestrator/engine-invokers.js';
import { OrderCreatorWorker } from '../workers/order-creator.js';
import { PaperExecutorWorker } from '../workers/paper-executor.js';
import { PositionRefresherWorker } from '../workers/position-refresher.js';
import { ExitMonitorWorker } from '../workers/exit-monitor.js';
import { stratScannerService } from '../services/strat-scanner/index.js';
import {
  tuneWeights,
  generateInsights,
  saveInsights,
} from '../services/strat-analytics/index.js';
import { AlertOutcomeTrackerWorker } from '../workers/alert-outcome-tracker.worker.js';

const router = Router();

function requireCronSecret(req: Request, res: Response, next: () => void): void {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization;
  const headerSecret = req.headers['x-cron-secret'] as string | undefined;

  if (!secret) {
    logger.warn('CRON_SECRET not set, rejecting cron request');
    res.status(503).json({ error: 'Cron processing not configured' });
    return;
  }

  const provided =
    (auth?.startsWith('Bearer ') && auth.slice(7) === secret) ||
    headerSecret === secret;

  if (!provided) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

/**
 * POST /api/cron/process-queue
 *
 * Runs the full pipeline: orchestrator → order creator → paper executor →
 * position refresher → exit monitor. Uses DB locking to avoid duplicate work.
 * Call every 2–3 minutes.
 */
router.post('/process-queue', requireCronSecret, async (_req: Request, res: Response) => {
  // Skip when workers run (e.g. Fly.io) - set ENABLE_CRON_PROCESSING=false to disable
  if (process.env.ENABLE_CRON_PROCESSING === 'false') {
    res.status(200).json({
      ok: true,
      skip: true,
      reason: 'Cron disabled (ENABLE_CRON_PROCESSING=false, workers likely running)',
    });
    return;
  }

  const startTime = Date.now();

  try {
    const batchSize = Math.min(
      config.orchestratorBatchSize ?? 10,
      parseInt(String(process.env.CRON_BATCH_SIZE || '10'), 10) || 10
    );

    const orchestrator = createOrchestratorService({
      engineA: createEngineAInvoker(),
      engineB: createEngineBInvoker(),
    });

    const orderCreator = new OrderCreatorWorker();
    const paperExecutor = new PaperExecutorWorker();
    const positionRefresher = new PositionRefresherWorker();
    const exitMonitor = new ExitMonitorWorker();

    const results = {
      orchestrator: 0,
      orderCreator: 0,
      paperExecutor: 0,
      positionRefresher: 0,
      exitMonitor: 0,
      errors: [] as string[],
    };

    // 1. Orchestrator – process pending signals (DB locking via processing_lock)
    try {
      const orchestratorResults = await orchestrator.processSignals(batchSize, undefined, {
        concurrency: config.orchestratorConcurrency ?? 1,
        timeoutMs: config.orchestratorSignalTimeoutMs ?? 30000,
        retryDelayMs: config.orchestratorRetryDelayMs ?? 60000,
      });
      results.orchestrator = orchestratorResults.length;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.errors.push(`orchestrator: ${msg}`);
      logger.error('Cron orchestrator failed', err);
    }

    // 2. Order creator – create orders for approved signals
    try {
      await orderCreator.run();
      results.orderCreator = 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.errors.push(`orderCreator: ${msg}`);
      logger.error('Cron order creator failed', err);
    }

    // 3. Paper executor – fill pending orders
    try {
      await paperExecutor.run();
      results.paperExecutor = 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.errors.push(`paperExecutor: ${msg}`);
      logger.error('Cron paper executor failed', err);
    }

    // 4. Position refresher – update P&L
    try {
      await positionRefresher.run();
      results.positionRefresher = 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.errors.push(`positionRefresher: ${msg}`);
      logger.error('Cron position refresher failed', err);
    }

    // 5. Exit monitor – check exit rules
    try {
      await exitMonitor.run();
      results.exitMonitor = 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.errors.push(`exitMonitor: ${msg}`);
      logger.error('Cron exit monitor failed', err);
    }

    const durationMs = Date.now() - startTime;
    logger.info('Cron process-queue completed', { ...results, durationMs });

    res.json({
      ok: true,
      durationMs,
      results,
    });
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    logger.error('Cron process-queue failed', err);
    res.status(500).json({
      ok: false,
      durationMs,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * POST /api/cron/strat-scan
 *
 * Runs the Strat scanner across watchlist tickers. Call every 4 hours for 4H,
 * at market close for Daily, Friday close for Weekly, month-end for Monthly.
 * Or on-demand when user adds ticker / clicks Refresh.
 */
router.post('/strat-scan', requireCronSecret, async (_req: Request, res: Response) => {
  if (!config.enableStratPlanLifecycle) {
    return res.status(200).json({
      ok: true,
      skip: true,
      reason: 'Strat Plan Lifecycle disabled',
    });
  }

  const startTime = Date.now();
  try {
    const alerts = await stratScannerService.run();
    const durationMs = Date.now() - startTime;
    return res.json({
      ok: true,
      durationMs,
      alertsCount: alerts.length,
      scannedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    logger.error('Cron strat-scan failed', err);
    return res.status(500).json({
      ok: false,
      durationMs,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * POST /api/cron/strat-feedback
 *
 * Runs Strat Feedback Loop: outcome tracker + scoring tuner + insights generation.
 * Call weekly (e.g. Sunday evening) or on-demand.
 */
router.post('/strat-feedback', requireCronSecret, async (_req: Request, res: Response) => {
  if (!config.enableStratPlanLifecycle) {
    return res.status(200).json({
      ok: true,
      skip: true,
      reason: 'Strat Plan Lifecycle disabled',
    });
  }

  const startTime = Date.now();
  const results: Record<string, unknown> = {};

  try {
    // 1. Run outcome tracker (one pass)
    const outcomeWorker = new AlertOutcomeTrackerWorker(60_000);
    await outcomeWorker.run();
    results.outcomeTracker = 'ok';

    // 2. Tune scoring weights
    const tuneResult = await tuneWeights();
    results.tune = tuneResult;

    // 3. Generate and save insights
    const insights = await generateInsights();
    await saveInsights(insights);
    results.insightsCount = insights.length;

    const durationMs = Date.now() - startTime;
    return res.json({
      ok: true,
      durationMs,
      results,
    });
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    logger.error('Cron strat-feedback failed', err);
    return res.status(500).json({
      ok: false,
      durationMs,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
