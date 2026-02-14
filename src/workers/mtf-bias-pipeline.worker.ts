/**
 * MTF Bias Pipeline Worker
 * Polls Redis streams: mtf_bias_stream -> state aggregator -> conflict resolver -> setup validator
 */

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { mtfBiasStreamService } from '../services/mtf-bias-stream.service.js';
import { pollAndProcessMTFBiasStream } from '../services/mtf-bias/state-aggregator.service.js';
import { pollAndProcessMarketStateStream } from '../services/mtf-bias/conflict-resolver.service.js';
import { pollAndProcessSetupValidationStream } from '../services/mtf-bias/setup-validator.service.js';
import { updateWorkerStatus } from '../services/trade-engine-health.service.js';
import { registerWorkerErrorHandlers } from '../services/worker-observability.service.js';
import * as Sentry from '@sentry/node';

const POLL_INTERVAL_MS = 2000;

export class MTFBiasPipelineWorker {
  private timerId: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private isShuttingDown = false;

  start(): void {
    if (!config.enableMTFBiasPipeline) {
      logger.info('MTF bias pipeline disabled');
      return;
    }

    registerWorkerErrorHandlers('MTFBiasPipelineWorker');

    if (this.isRunning || this.isShuttingDown) {
      return;
    }

    if (!config.redisUrl) {
      logger.warn('MTF bias pipeline disabled (REDIS_URL missing)');
      return;
    }

    this.isRunning = true;
    mtfBiasStreamService.connect().catch((err) => {
      logger.error('MTF bias stream connect failed', err);
      Sentry.captureException(err, { tags: { worker: 'MTFBiasPipelineWorker' } });
    });

    this.timerId = setInterval(() => {
      this.tick().catch((err) => {
        logger.error('MTF bias pipeline tick failed', err);
        Sentry.captureException(err, { tags: { worker: 'MTFBiasPipelineWorker' } });
      });
    }, POLL_INTERVAL_MS);

    updateWorkerStatus('MTFBiasPipelineWorker', { running: true });
    logger.info('MTF bias pipeline worker started');
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    await mtfBiasStreamService.disconnect();
    this.isRunning = false;
    updateWorkerStatus('MTFBiasPipelineWorker', { running: false });
    logger.info('MTF bias pipeline worker stopped');
  }

  async stopAndDrain(timeoutMs: number): Promise<void> {
    const timer = setTimeout(() => {
      logger.warn('MTF bias pipeline stop timed out');
    }, timeoutMs);
    await this.stop();
    clearTimeout(timer);
  }

  private async tick(): Promise<void> {
    if (this.isShuttingDown) return;

    updateWorkerStatus('MTFBiasPipelineWorker', { lastRunAt: new Date() });

    const [aggregated, resolved, validated] = await Promise.all([
      pollAndProcessMTFBiasStream(),
      pollAndProcessMarketStateStream(),
      pollAndProcessSetupValidationStream(),
    ]);

    if (aggregated > 0 || resolved > 0 || validated > 0) {
      logger.debug('MTF bias pipeline tick', { aggregated, resolved, validated });
    }
  }
}
