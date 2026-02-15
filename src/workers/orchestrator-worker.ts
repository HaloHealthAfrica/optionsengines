/**
 * Orchestrator Worker - polls unprocessed signals and runs orchestrator
 */

import { OrchestratorService } from '../orchestrator/orchestrator-service.js';
import { logger } from '../utils/logger.js';
import { db } from '../services/database.service.js';
import { config } from '../config/index.js';
import * as Sentry from '@sentry/node';
import { registerWorkerErrorHandlers } from '../services/worker-observability.service.js';
import { setLastSignalProcessed, updateWorkerStatus } from '../services/trade-engine-health.service.js';

export class OrchestratorWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isShuttingDown = false;
  private backoffMs = 0;
  private avgProcessingMs: number | null = null;
  private queueDepthHighSince: number | null = null;

  constructor(private orchestrator: OrchestratorService, private intervalMs: number) {}

  start(): void {
    registerWorkerErrorHandlers('OrchestratorWorker');
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.run().catch((error) => {
        logger.error('Orchestrator worker failed', error);
      });
    }, this.intervalMs);

    this.run().catch((error) => {
      logger.error('Orchestrator worker failed on startup', error);
      Sentry.captureException(error, { tags: { worker: 'OrchestratorWorker' } });
    });

    logger.info('Orchestrator worker started', { intervalMs: this.intervalMs });
    updateWorkerStatus('OrchestratorWorker', { running: true });
  }

  stop(): void {
    this.isShuttingDown = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Orchestrator worker stopped');
      updateWorkerStatus('OrchestratorWorker', { running: false });
    }
  }

  async stopAndDrain(timeoutMs: number): Promise<void> {
    this.stop();
    const startedAt = Date.now();
    while (this.isRunning && Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (this.isRunning) {
      logger.warn('Orchestrator worker did not stop before timeout');
    }
  }

  async run(): Promise<void> {
    if (this.isRunning || this.isShuttingDown) {
      return;
    }

    this.isRunning = true;
    try {
      if (this.backoffMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.backoffMs));
      }
      const startedAt = Date.now();
      updateWorkerStatus('OrchestratorWorker', { lastRunAt: new Date() });
      const results = await this.orchestrator.processSignals(
        config.orchestratorBatchSize,
        undefined,
        {
          concurrency: config.orchestratorConcurrency,
          timeoutMs: config.orchestratorSignalTimeoutMs,
          retryDelayMs: config.orchestratorRetryDelayMs,
        }
      );
      if (results.length > 0) {
        setLastSignalProcessed(null, new Date());
        logger.debug('Orchestrator batch processed signals', { signals: results.length });
      }
      const durations = results
        .map((result) => result.duration_ms)
        .filter((value): value is number => typeof value === 'number');
      if (durations.length > 0) {
        const batchAvg = durations.reduce((sum, value) => sum + value, 0) / durations.length;
        this.avgProcessingMs = this.avgProcessingMs
          ? Math.round(this.avgProcessingMs * 0.8 + batchAvg * 0.2)
          : Math.round(batchAvg);
      }
      logger.info('Orchestrator batch processed', {
        signals: results.length,
        durationMs: Date.now() - startedAt,
        avgSignalMs: this.avgProcessingMs,
      });
      updateWorkerStatus('OrchestratorWorker', {
        lastDurationMs: Date.now() - startedAt,
        backoffMs: this.backoffMs,
      });
      await this.monitorQueueDepth();
      this.backoffMs = 0;
    } catch (error) {
      this.backoffMs = Math.min(this.backoffMs * 2 || 500, 10_000);
      logger.error('Orchestrator worker error', error, { backoffMs: this.backoffMs });
      updateWorkerStatus('OrchestratorWorker', {
        lastErrorAt: new Date(),
        backoffMs: this.backoffMs,
      });
      Sentry.captureException(error, {
        tags: { worker: 'OrchestratorWorker' },
        extra: { backoffMs: this.backoffMs },
      });
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  private queueAlertSentAt: number | null = null;

  private async monitorQueueDepth(): Promise<void> {
    try {
      const result = await db.query(
        `SELECT COUNT(*)::int AS count
         FROM signals
         WHERE processed = FALSE
           AND processing_lock = FALSE
           AND (status IS NULL OR status = 'pending')
           AND (queued_until IS NULL OR queued_until <= NOW())
           AND (next_retry_at IS NULL OR next_retry_at <= NOW())`
      );
      const depth = result.rows[0]?.count ?? 0;
      if (depth > config.processingQueueDepthAlert) {
        if (!this.queueDepthHighSince) {
          this.queueDepthHighSince = Date.now();
        }
        const elapsedSec = (Date.now() - this.queueDepthHighSince) / 1000;
        if (elapsedSec >= config.processingQueueDepthDurationSec) {
          logger.warn('Processing queue depth high', {
            depth,
            durationSec: Math.round(elapsedSec),
            threshold: config.processingQueueDepthAlert,
          });

          // Send Sentry alert and Discord notification (Gap 18 fix)
          // Only alert once per 15 minutes to avoid noise
          const alertCooldownMs = 15 * 60 * 1000;
          if (!this.queueAlertSentAt || Date.now() - this.queueAlertSentAt > alertCooldownMs) {
            Sentry.captureMessage(`Queue depth critically high: ${depth} signals pending for ${Math.round(elapsedSec)}s`, {
              level: 'warning',
              tags: { worker: 'OrchestratorWorker', alert: 'queue_depth' },
              extra: { depth, durationSec: Math.round(elapsedSec), threshold: config.processingQueueDepthAlert },
            });
            this.queueAlertSentAt = Date.now();
          }
        }
      } else {
        this.queueDepthHighSince = null;
        // Reset alert cooldown when queue recovers
        if (depth === 0) {
          this.queueAlertSentAt = null;
        }
      }
    } catch (error) {
      logger.warn('Failed to monitor queue depth', { error });
      Sentry.captureException(error, { tags: { worker: 'OrchestratorWorker' } });
    }
  }
}
