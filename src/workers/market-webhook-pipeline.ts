import Redis from 'ioredis';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { webhookIngestionService } from '../services/webhook-ingestion.service.js';
import { processWebhookPayload } from '../routes/webhook.js';
import { createOrchestratorService } from '../orchestrator/container.js';
import { createEngineAInvoker, createEngineBInvoker } from '../orchestrator/engine-invokers.js';
import { publishIntelUpdate } from '../services/realtime-updates.service.js';
import * as Sentry from '@sentry/node';
import { registerWorkerErrorHandlers } from '../services/worker-observability.service.js';
import { setLastSignalProcessed, updateWorkerStatus } from '../services/trade-engine-health.service.js';

type PipelineTriggerMessage = {
  reason?: string;
  symbol?: string;
  timestamp?: number;
};

type FlowWebhookRecord = {
  symbol: string;
  timestamp: number;
  type: 'call' | 'put';
  strike: number;
  expiry: string;
  premium: number;
  size: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  unusual: boolean;
  source: 'webhook';
  receivedAt: number;
};

const FLOW_THRESHOLDS = {
  premiumHigh: 250000,
  premiumMedium: 75000,
  sizeHigh: 2000,
  sizeMedium: 500,
};

export class MarketWebhookPipelineWorker {
  private subscriber: Redis | null = null;
  private isRunning = false;
  private isShuttingDown = false;
  private orchestrator = createOrchestratorService({
    engineA: createEngineAInvoker(),
    engineB: createEngineBInvoker(),
  });

  start(): void {
    registerWorkerErrorHandlers('MarketWebhookPipelineWorker');
    if (this.isRunning || this.isShuttingDown) {
      return;
    }

    if (!config.redisUrl) {
      logger.warn('Market webhook pipeline disabled (REDIS_URL missing)');
      return;
    }

    this.isRunning = true;
    this.subscriber = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      tls: config.redisUrl.includes('upstash.io') ? {} : undefined,
    });

    this.subscriber.on('error', (error: Error) => {
      logger.error('Market webhook pipeline Redis error', error);
      Sentry.captureException(error, { tags: { worker: 'MarketWebhookPipelineWorker' } });
    });

    this.subscriber.subscribe('pipeline:trigger', (error) => {
      if (error) {
        logger.error('Market webhook pipeline subscribe failed', error);
        Sentry.captureException(error, { tags: { worker: 'MarketWebhookPipelineWorker' } });
        return;
      }
      logger.info('Market webhook pipeline subscribed to triggers');
    });

    this.subscriber.on('message', (_channel, message) => {
      this.handleTrigger(message).catch((error) => {
        logger.error('Market webhook trigger handling failed', error);
        Sentry.captureException(error, { tags: { worker: 'MarketWebhookPipelineWorker' } });
      });
    });
    updateWorkerStatus('MarketWebhookPipelineWorker', { running: true });
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
    }
    this.isRunning = false;
    updateWorkerStatus('MarketWebhookPipelineWorker', { running: false });
  }

  async stopAndDrain(timeoutMs: number): Promise<void> {
    const timer = setTimeout(() => {
      logger.warn('Market webhook pipeline stop timed out');
    }, timeoutMs);
    await this.stop();
    clearTimeout(timer);
  }

  private async handleTrigger(message: string): Promise<void> {
    if (this.isShuttingDown) return;
    updateWorkerStatus('MarketWebhookPipelineWorker', { lastRunAt: new Date() });

    let payload: PipelineTriggerMessage;
    try {
      payload = JSON.parse(message);
    } catch {
      payload = {};
    }

    const symbol = payload.symbol?.toUpperCase();
    if (!symbol) {
      logger.warn('Market webhook trigger missing symbol');
      return;
    }

    await webhookIngestionService.connect();
    const latestFlow = await webhookIngestionService.getLatestFlow(symbol);
    if (!latestFlow) {
      logger.warn('No flow data available for trigger', { symbol });
      return;
    }

    const direction = this.resolveDirection(latestFlow);
    if (!direction) {
      logger.warn('Flow signal skipped (neutral/no direction)', { symbol });
      return;
    }

    const currentPrice = await webhookIngestionService.getCurrentPrice(symbol);
    const signalPayload = this.buildFlowSignalPayload(latestFlow, direction, currentPrice, payload);

    const result = await processWebhookPayload({
      payload: signalPayload,
      requestId: crypto.randomUUID(),
    });

    if (result.status !== 'ACCEPTED') {
      logger.info('Flow signal not accepted', { status: result.status, symbol });
      return;
    }

    const signalId = result.response?.signal_id as string | undefined;
    if (signalId) {
      await this.orchestrator.processSignals(1, [signalId]);
      await publishIntelUpdate(symbol);
      logger.info('Flow signal processed through orchestrator', { signalId, symbol });
      setLastSignalProcessed(signalId, new Date());
    }
  }

  private resolveDirection(flow: FlowWebhookRecord): 'long' | 'short' | null {
    if (flow.sentiment === 'bullish') return 'long';
    if (flow.sentiment === 'bearish') return 'short';

    if (flow.sentiment === 'neutral' && !this.isStrongFlow(flow)) {
      return null;
    }

    if (flow.type === 'call') return 'long';
    if (flow.type === 'put') return 'short';
    return null;
  }

  private isStrongFlow(flow: FlowWebhookRecord): boolean {
    return (
      flow.unusual ||
      flow.premium >= FLOW_THRESHOLDS.premiumHigh ||
      flow.size >= FLOW_THRESHOLDS.sizeHigh
    );
  }

  private resolveTimeframe(flow: FlowWebhookRecord): string {
    if (flow.premium >= FLOW_THRESHOLDS.premiumHigh || flow.size >= FLOW_THRESHOLDS.sizeHigh) {
      return '15m';
    }
    if (flow.premium >= FLOW_THRESHOLDS.premiumMedium || flow.size >= FLOW_THRESHOLDS.sizeMedium) {
      return '5m';
    }
    return '1m';
  }

  private resolveConfidence(flow: FlowWebhookRecord): number {
    let confidence = 50;

    if (flow.sentiment === 'bullish' || flow.sentiment === 'bearish') {
      confidence += 5;
    }
    if (flow.unusual) {
      confidence += 10;
    }
    if (flow.premium >= FLOW_THRESHOLDS.premiumHigh) {
      confidence += 20;
    } else if (flow.premium >= FLOW_THRESHOLDS.premiumMedium) {
      confidence += 10;
    }
    if (flow.size >= FLOW_THRESHOLDS.sizeHigh) {
      confidence += 15;
    } else if (flow.size >= FLOW_THRESHOLDS.sizeMedium) {
      confidence += 7;
    }

    return Math.max(35, Math.min(95, confidence));
  }

  private buildFlowSignalPayload(
    flow: FlowWebhookRecord,
    direction: 'long' | 'short',
    price: number | null,
    trigger: PipelineTriggerMessage
  ): Record<string, any> {
    const timeframe = this.resolveTimeframe(flow);
    const confidence = this.resolveConfidence(flow);
    const pattern = flow.unusual ? 'FLOW_SPIKE' : 'FLOW_SURGE';

    return {
      symbol: flow.symbol,
      direction: direction.toUpperCase(),
      timeframe,
      timestamp: flow.timestamp,
      price: price ?? undefined,
      strike: flow.strike,
      expiration: flow.expiry,
      signal: {
        type: direction.toUpperCase(),
        timeframe,
        confidence,
        pattern,
      },
      metadata: {
        source: 'flow_webhook',
        trigger_reason: trigger.reason,
        trigger_timestamp: trigger.timestamp,
        flow_strength: this.isStrongFlow(flow) ? 'strong' : 'standard',
        confidence,
        flow,
      },
    };
  }
}
