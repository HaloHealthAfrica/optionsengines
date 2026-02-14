/**
 * Gamma Metrics Worker - Phase 3
 * Polls Unusual Whales gamma API at RTH (2min) / ETH (5-10min) intervals.
 * Publishes to gamma_context_stream for merge service consumption.
 */

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { evaluateMarketSession } from '../utils/market-session.js';
import { pollAllSymbols } from '../services/gamma-context/gamma-context.service.js';
import { mtfBiasStreamService } from '../services/mtf-bias-stream.service.js';
import { updateWorkerStatus } from '../services/trade-engine-health.service.js';
import { registerWorkerErrorHandlers } from '../services/worker-observability.service.js';
import * as Sentry from '@sentry/node';

export class GammaMetricsWorker {
  private timerId: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private isShuttingDown = false;

  start(): void {
    if (!config.enableGammaMetricsService) {
      logger.info('Gamma Metrics Service disabled');
      return;
    }

    if (!config.unusualWhalesApiKey || !config.unusualWhalesGammaUrl) {
      logger.warn('Gamma Metrics Service disabled (Unusual Whales not configured)');
      return;
    }

    if (!config.redisUrl) {
      logger.warn('Gamma Metrics Service disabled (REDIS_URL missing)');
      return;
    }

    registerWorkerErrorHandlers('GammaMetricsWorker');

    if (this.isRunning || this.isShuttingDown) {
      return;
    }

    this.isRunning = true;
    mtfBiasStreamService.connect().catch((err) => {
      logger.error('Gamma Metrics Redis connect failed', err);
      Sentry.captureException(err, { tags: { worker: 'GammaMetricsWorker' } });
    });

    this.runTickAndSchedule();
    updateWorkerStatus('GammaMetricsWorker', { running: true });
    logger.info('Gamma Metrics Worker started', {
      symbols: config.gammaMetricsSymbols,
      rthIntervalMs: config.gammaMetricsRthIntervalMs,
      ethIntervalMs: config.gammaMetricsEthIntervalMs,
    });
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    await mtfBiasStreamService.disconnect();
    this.isRunning = false;
    updateWorkerStatus('GammaMetricsWorker', { running: false });
    logger.info('Gamma Metrics Worker stopped');
  }

  private runTickAndSchedule(): void {
    if (this.isShuttingDown) return;

    this.tick().catch((err) => {
      logger.error('Gamma Metrics initial tick failed', err);
      Sentry.captureException(err, { tags: { worker: 'GammaMetricsWorker' } });
    });

    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (this.isShuttingDown) return;

    const evaluation = evaluateMarketSession({
      timestamp: new Date(),
      allowPremarket: config.allowPremarket,
      allowAfterhours: config.allowAfterhours,
      gracePeriodMinutes: config.marketCloseGraceMinutes,
    });

    const intervalMs =
      evaluation.sessionType === 'RTH'
        ? config.gammaMetricsRthIntervalMs
        : config.gammaMetricsEthIntervalMs;

    this.timerId = setInterval(() => {
      this.tick().catch((err) => {
        logger.error('Gamma Metrics tick failed', err);
        Sentry.captureException(err, { tags: { worker: 'GammaMetricsWorker' } });
      });
    }, intervalMs);
  }

  private async tick(): Promise<void> {
    if (this.isShuttingDown) return;

    updateWorkerStatus('GammaMetricsWorker', { lastRunAt: new Date() });

    const published = await pollAllSymbols();
    if (published > 0) {
      logger.debug('Gamma Metrics tick', { published, symbols: config.gammaMetricsSymbols });
    }
  }
}
