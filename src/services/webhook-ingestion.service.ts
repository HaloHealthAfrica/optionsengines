import Redis from 'ioredis';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

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

type PriceWebhookTick = {
  symbol: string;
  price: number;
  timestamp: number;
  volume: number;
  high: number;
  low: number;
  open: number;
};

type ChainWebhookSnapshot = {
  symbol: string;
  payload: Record<string, any>;
};

type PipelineTrigger = {
  reason: string;
  symbol: string;
  timestamp: number;
};

class WebhookIngestionService {
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

    this.client.on('connect', () => {
      this.isConnected = true;
      logger.info('Webhook ingestion Redis connected');
    });

    this.client.on('error', (error: Error) => {
      this.isConnected = false;
      logger.error('Webhook ingestion Redis error', error);
    });

    this.client.on('close', () => {
      this.isConnected = false;
      logger.warn('Webhook ingestion Redis connection closed');
    });

    try {
      await this.client.ping();
      this.isConnected = true;
    } catch (error) {
      this.isConnected = false;
      logger.warn('Webhook ingestion Redis ping failed', { error });
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
    if (!config.redisUrl) {
      return null;
    }

    if (!this.client) {
      await this.connect();
    }

    if (!this.client || !this.isConnected) {
      return null;
    }

    return this.client;
  }

  async storeFlow(record: FlowWebhookRecord): Promise<void> {
    const client = await this.getClient();
    if (!client) return;

    const key = `flow:${record.symbol}`;
    const payload = JSON.stringify(record);
    await client.zadd(key, record.timestamp, payload);
    await client.zremrangebyrank(key, 0, -1001);
    await client.lpush('queue:flow', payload);
  }

  async getLatestFlow(symbol: string): Promise<FlowWebhookRecord | null> {
    const client = await this.getClient();
    if (!client) return null;

    const key = `flow:${symbol.toUpperCase()}`;
    const entries = await client.zrevrange(key, 0, 0);
    if (!entries.length) return null;
    return JSON.parse(entries[0]) as FlowWebhookRecord;
  }

  async storePriceTick(tick: PriceWebhookTick): Promise<number | null> {
    const client = await this.getClient();
    if (!client) return null;

    const key = `price:${tick.symbol}`;
    const payload = JSON.stringify(tick);
    await client.lpush(key, payload);
    await client.ltrim(key, 0, 999);
    await client.set(`price:${tick.symbol}:current`, String(tick.price));

    const atr = await this.calculateAtr(client, tick.symbol);
    if (atr !== null) {
      await client.set(`atr:${tick.symbol}`, atr.toFixed(6));
    }

    return atr;
  }

  async getCurrentPrice(symbol: string): Promise<number | null> {
    const client = await this.getClient();
    if (!client) return null;

    const value = await client.get(`price:${symbol.toUpperCase()}:current`);
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  async storeChainSnapshot(snapshot: ChainWebhookSnapshot): Promise<void> {
    const client = await this.getClient();
    if (!client) return;

    await client.set(`chain:${snapshot.symbol}:latest`, JSON.stringify(snapshot.payload), 'EX', 300);
    await client.lpush(
      'queue:gex',
      JSON.stringify({ symbol: snapshot.symbol, timestamp: Date.now() })
    );
  }

  async publishPipelineTrigger(trigger: PipelineTrigger): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    await client.publish('pipeline:trigger', JSON.stringify(trigger));
  }

  private async calculateAtr(client: Redis, symbol: string): Promise<number | null> {
    const ticks = await client.lrange(`price:${symbol}`, 0, 13);
    if (ticks.length < 14) return null;

    const data = ticks.map((tick) => JSON.parse(tick) as PriceWebhookTick);
    let atrSum = 0;

    for (let i = 1; i < data.length; i += 1) {
      const high = data[i].high;
      const low = data[i].low;
      const prevClose = data[i - 1].price;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      atrSum += tr;
    }

    return atrSum / 14;
  }
}

export const webhookIngestionService = new WebhookIngestionService();
