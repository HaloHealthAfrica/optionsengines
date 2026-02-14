/**
 * MTF Bias Redis Stream Service
 * Streams: mtf_bias_stream, market_state_stream, setup_validation_stream, trade_execution_stream
 */

import Redis from 'ioredis';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export const MTF_BIAS_STREAMS = {
  MTF_BIAS: 'mtf_bias_stream',
  MARKET_STATE: 'market_state_stream',
  GAMMA_CONTEXT: 'gamma_context_stream',
  SETUP_VALIDATION: 'setup_validation_stream',
  TRADE_EXECUTION: 'trade_execution_stream',
} as const;

const CONSUMER_GROUP = 'mtf_bias_consumers';
const CONSUMER_ID = `consumer-${process.pid}-${Date.now()}`;

class MTFBiasStreamService {
  private client: Redis | null = null;
  private isConnected = false;

  async connect(): Promise<void> {
    if (this.client || !config.redisUrl) {
      return;
    }

    this.client = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      tls: config.redisUrl.includes('upstash.io') ? {} : undefined,
    });

    this.client.on('error', (error: Error) => {
      this.isConnected = false;
      logger.error('MTF bias stream Redis error', error);
    });

    try {
      await this.client.ping();
      this.isConnected = true;
      logger.info('MTF bias stream Redis connected');
    } catch (error) {
      this.isConnected = false;
      logger.warn('MTF bias stream Redis ping failed', { error });
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
    }
  }

  private async getClient(): Promise<Redis | null> {
    if (!config.redisUrl) return null;
    if (!this.client) await this.connect();
    if (!this.client || !this.isConnected) return null;
    return this.client;
  }

  /** Publish event to stream. Returns message ID or null. */
  async publish(stream: string, payload: Record<string, unknown>): Promise<string | null> {
    const client = await this.getClient();
    if (!client) return null;

    try {
      const id = await client.xadd(
        stream,
        '*',
        'payload',
        JSON.stringify(payload)
      );
      return id;
    } catch (error) {
      logger.error('MTF bias stream publish failed', { stream, error });
      return null;
    }
  }

  /** Ensure consumer group exists for stream. */
  async ensureConsumerGroup(stream: string): Promise<boolean> {
    const client = await this.getClient();
    if (!client) return false;

    try {
      await client.xgroup('CREATE', stream, CONSUMER_GROUP, '0', 'MKSTREAM');
    } catch (err: unknown) {
      const msg = String((err as Error)?.message ?? err);
      if (!msg.includes('BUSYGROUP') && !msg.includes('already exists')) {
        logger.warn('MTF bias stream XGROUP CREATE', { stream, error: msg });
      }
    }
    return true;
  }

  /** Read from stream with consumer group. Blocks for blockMs. */
  async read(
    stream: string,
    blockMs: number = 5000
  ): Promise<Array<{ id: string; payload: Record<string, unknown> }>> {
    const client = await this.getClient();
    if (!client) return [];

    await this.ensureConsumerGroup(stream);

    try {
      const result = await client.xreadgroup(
        'GROUP',
        CONSUMER_GROUP,
        CONSUMER_ID,
        'BLOCK',
        blockMs,
        'STREAMS',
        stream,
        '>'
      );

      if (!result || !Array.isArray(result[0])) return [];

      const [, messages] = result[0] as [string, Array<[string, string[]]>];
      const parsed: Array<{ id: string; payload: Record<string, unknown> }> = [];

      for (const [id, fields] of messages ?? []) {
        const payloadIdx = fields?.indexOf('payload');
        if (payloadIdx >= 0 && fields[payloadIdx + 1]) {
          try {
            parsed.push({
              id,
              payload: JSON.parse(fields[payloadIdx + 1]) as Record<string, unknown>,
            });
          } catch {
            logger.warn('MTF bias stream parse failed', { stream, id });
          }
        }
      }
      return parsed;
    } catch (error) {
      logger.error('MTF bias stream read failed', { stream, error });
      return [];
    }
  }

  /** Acknowledge message processed. */
  async ack(stream: string, id: string): Promise<boolean> {
    const client = await this.getClient();
    if (!client) return false;

    try {
      await client.xack(stream, CONSUMER_GROUP, id);
      return true;
    } catch (error) {
      logger.error('MTF bias stream ack failed', { stream, id, error });
      return false;
    }
  }

  /** Publish to mtf_bias_stream (webhook ingestion). */
  async publishMTFBias(payload: Record<string, unknown>): Promise<string | null> {
    return this.publish(MTF_BIAS_STREAMS.MTF_BIAS, payload);
  }

  /** Publish to market_state_stream (state aggregator output). */
  async publishMarketState(payload: Record<string, unknown>): Promise<string | null> {
    return this.publish(MTF_BIAS_STREAMS.MARKET_STATE, payload);
  }

  /** Publish to gamma_context_stream (Gamma Metrics Service output). */
  async publishGammaContext(payload: Record<string, unknown>): Promise<string | null> {
    return this.publish(MTF_BIAS_STREAMS.GAMMA_CONTEXT, payload);
  }

  /** Publish to setup_validation_stream. */
  async publishSetupValidation(payload: Record<string, unknown>): Promise<string | null> {
    return this.publish(MTF_BIAS_STREAMS.SETUP_VALIDATION, payload);
  }

  /** Publish to trade_execution_stream. */
  async publishTradeExecution(payload: Record<string, unknown>): Promise<string | null> {
    return this.publish(MTF_BIAS_STREAMS.TRADE_EXECUTION, payload);
  }
}

export const mtfBiasStreamService = new MTFBiasStreamService();
