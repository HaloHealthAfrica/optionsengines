// Signal Processor Worker - Enriches signals and applies risk checks
import { db } from '../services/database.service.js';
import { logger } from '../utils/logger.js';
import { Signal } from '../types/index.js';
import { sleep } from '../utils/sleep.js';
import { errorTracker } from '../services/error-tracker.service.js';
import { buildSignalEnrichment } from '../services/signal-enrichment.service.js';
import * as Sentry from '@sentry/node';
import { registerWorkerErrorHandlers } from '../services/worker-observability.service.js';
import { setLastSignalProcessed, updateWorkerStatus } from '../services/trade-engine-health.service.js';

export class SignalProcessorWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  start(intervalMs: number): void {
    registerWorkerErrorHandlers('SignalProcessorWorker');
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.run().catch((error) => {
        logger.error('Signal processor worker failed', error);
      });
    }, intervalMs);

    // Run immediately on startup
    this.run().catch((error) => {
      logger.error('Signal processor worker failed on startup', error);
      Sentry.captureException(error, { tags: { worker: 'SignalProcessorWorker' } });
    });

    logger.info('Signal processor worker started', { intervalMs });
    updateWorkerStatus('SignalProcessorWorker', { running: true });
    Sentry.captureMessage('WORKER_START', {
      level: 'info',
      tags: { worker: 'SignalProcessorWorker' },
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Signal processor worker stopped');
      updateWorkerStatus('SignalProcessorWorker', { running: false });
      Sentry.captureMessage('WORKER_STOP', {
        level: 'info',
        tags: { worker: 'SignalProcessorWorker' },
      });
    }
  }

  async stopAndDrain(timeoutMs: number): Promise<void> {
    this.stop();
    const startedAt = Date.now();
    while (this.isRunning && Date.now() - startedAt < timeoutMs) {
      await sleep(50);
    }
    if (this.isRunning) {
      logger.warn('Signal processor did not stop before timeout');
    }
  }

  async run(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Signal processor already running, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    updateWorkerStatus('SignalProcessorWorker', { lastRunAt: new Date() });

    try {
      const pendingSignals = await db.query<Signal>(
        `SELECT * FROM signals 
         WHERE status = $1
           AND (queued_until IS NULL OR queued_until <= NOW())
           AND (next_retry_at IS NULL OR next_retry_at <= NOW())
         ORDER BY created_at ASC 
         LIMIT 100`,
        ['pending']
      );

      if (pendingSignals.rows.length === 0) {
        return;
      }

      let approved = 0;
      let rejected = 0;

      for (const signal of pendingSignals.rows) {
        let riskResult: Record<string, any> = {};
        let enrichedData: Record<string, any> | null = null;
        try {
          const enrichment = await buildSignalEnrichment(signal);
          enrichedData = enrichment.enrichedData;
          riskResult = enrichment.riskResult;
          const rejectionReason = enrichment.rejectionReason;
          const queueUntil = enrichment.queueUntil;
          const queueReason = enrichment.queueReason;

          if (queueUntil) {
            await db.query(
              `UPDATE signals 
               SET queued_until = $1, queued_at = NOW(), queue_reason = $2
               WHERE signal_id = $3`,
              [queueUntil, queueReason || 'market_closed', signal.signal_id]
            );
            continue;
          }

          if (rejectionReason) {
            await db.query(
              `UPDATE signals SET status = $1 WHERE signal_id = $2`,
              ['rejected', signal.signal_id]
            );

            await db.query(
              `INSERT INTO refactored_signals (signal_id, enriched_data, risk_check_result, rejection_reason)
               VALUES ($1, $2, $3, $4)`,
              [signal.signal_id, JSON.stringify(enrichedData), JSON.stringify(riskResult), rejectionReason]
            );

            rejected += 1;
          } else {
            await db.query(
              `UPDATE signals SET status = $1 WHERE signal_id = $2`,
              ['approved', signal.signal_id]
            );

            await db.query(
              `INSERT INTO refactored_signals (signal_id, enriched_data, risk_check_result)
               VALUES ($1, $2, $3)`,
              [signal.signal_id, JSON.stringify(enrichedData), JSON.stringify(riskResult)]
            );

            approved += 1;
          }
        } catch (error) {
          logger.error('Signal processing failed', error, { signalId: signal.signal_id });
          errorTracker.recordError('signal_processor');
          Sentry.captureException(error, {
            tags: { worker: 'SignalProcessorWorker', signalId: signal.signal_id },
          });
          await db.query(
            `UPDATE signals SET status = $1 WHERE signal_id = $2`,
            ['rejected', signal.signal_id]
          );
          await db.query(
            `INSERT INTO refactored_signals (signal_id, enriched_data, risk_check_result, rejection_reason)
             VALUES ($1, $2, $3, $4)`,
            [signal.signal_id, enrichedData ? JSON.stringify(enrichedData) : null, JSON.stringify(riskResult), 'processing_error']
          );
          rejected += 1;
        }
        setLastSignalProcessed(signal.signal_id, new Date());
      }

      logger.info('Signal processing completed', {
        approved,
        rejected,
        durationMs: Date.now() - startTime,
      });
    } finally {
      updateWorkerStatus('SignalProcessorWorker', {
        lastDurationMs: Date.now() - startTime,
      });
      this.isRunning = false;
    }
  }
}
