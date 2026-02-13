/**
 * UW Flow Poller Worker - Phase 10: Flow-first signals from Unusual Whales
 * Polls UW flow-alerts and triggers the market webhook pipeline when notable flow is detected.
 */
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { UnusualWhalesOptionsClient } from '../services/providers/unusual-whales-options-client.js';
import { webhookIngestionService } from '../services/webhook-ingestion.service.js';
import { registerWorkerErrorHandlers } from '../services/worker-observability.service.js';
import { updateWorkerStatus } from '../services/trade-engine-health.service.js';
import * as Sentry from '@sentry/node';

const PREMIUM_THRESHOLD = 75000;

export class UwFlowPollerWorker {
  private client = new UnusualWhalesOptionsClient();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastPollTs = 0;

  start(): void {
    registerWorkerErrorHandlers('UwFlowPollerWorker');
    if (!config.enableUwFlowPoller || !config.unusualWhalesApiKey) {
      logger.info('UW flow poller disabled (ENABLE_UW_FLOW_POLLER or UNUSUAL_WHALES_API_KEY)');
      return;
    }
    if (!config.redisUrl) {
      logger.warn('UW flow poller disabled (REDIS_URL required for pipeline trigger)');
      return;
    }

    this.lastPollTs = Date.now() - config.uwFlowPollerIntervalMs;
    this.tick().catch((err) => {
      logger.error('UW flow poller initial tick failed', err);
      Sentry.captureException(err, { tags: { worker: 'UwFlowPollerWorker' } });
    });

    this.intervalId = setInterval(() => {
      this.tick().catch((err) => {
        logger.error('UW flow poller tick failed', err);
        Sentry.captureException(err, { tags: { worker: 'UwFlowPollerWorker' } });
      });
    }, config.uwFlowPollerIntervalMs);

    updateWorkerStatus('UwFlowPollerWorker', { running: true });
    logger.info('UW flow poller started', { intervalMs: config.uwFlowPollerIntervalMs });
  }

  async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    updateWorkerStatus('UwFlowPollerWorker', { running: false });
    logger.info('UW flow poller stopped');
  }

  async stopAndDrain(_timeoutMs: number): Promise<void> {
    await this.stop();
  }

  private async tick(): Promise<void> {
    updateWorkerStatus('UwFlowPollerWorker', { lastRunAt: new Date() });
    const alerts = await this.client.getFlowAlerts(this.lastPollTs);
    this.lastPollTs = Date.now();

    if (!alerts.length) return;

    await webhookIngestionService.connect();

    let triggered = 0;
    for (const a of alerts) {
      if (!a.ticker) continue;
      const symbol = a.ticker.toUpperCase();
      const meetsThreshold = a.unusual || a.premium >= PREMIUM_THRESHOLD;
      if (!meetsThreshold) continue;

      const flowRecord = {
        symbol,
        timestamp: a.timestamp,
        type: a.type,
        strike: a.strike,
        expiry: a.expiry,
        premium: a.premium,
        size: a.size,
        sentiment: a.sentiment,
        unusual: a.unusual,
        source: 'webhook' as const,
        receivedAt: Date.now(),
      };

      try {
        await webhookIngestionService.storeFlow(flowRecord);
        await webhookIngestionService.publishPipelineTrigger({
          reason: 'uw_flow_alert',
          symbol,
          timestamp: a.timestamp,
        });
        triggered++;
        logger.info('UW flow trigger published', { symbol, premium: a.premium, unusual: a.unusual });
      } catch (err) {
        logger.warn('UW flow store/publish failed', { symbol, error: err });
      }
    }

    if (triggered > 0) {
      logger.info('UW flow poller processed alerts', { total: alerts.length, triggered });
    }
  }
}
