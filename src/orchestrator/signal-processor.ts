/**
 * Signal Processor - Retrieves and processes signals from the database
 * 
 * Responsibilities:
 * - Retrieve unprocessed signals with SELECT FOR UPDATE SKIP LOCKED
 * - Create Market Context snapshots
 * - Mark signals as processed
 */

import pg from 'pg';
import crypto from 'crypto';
import { Signal, MarketContext } from './types.js';
import { Candle } from '../types/index.js';
import { SignalSchema, MarketContextSchema } from './schemas.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { marketData } from '../services/market-data.js';
import { indicators as indicatorService } from '../services/indicators.js';
import { marketIntelService } from '../services/market-intel/market-intel.service.js';
import { stratPlanLifecycleService } from '../services/strat-plan/index.js';
import * as Sentry from '@sentry/node';

export class SignalProcessor {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  /**
   * Retrieves unprocessed signals with SELECT FOR UPDATE SKIP LOCKED
   * to prevent race conditions in concurrent processing
   */
  async getUnprocessedSignals(limit: number = 10, signalIds?: string[]): Promise<Signal[]> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Phase 3b: Recover stale locks from crashed instances (any status)
      if (config.lockStalenessMinutes > 0) {
        const recovered = await client.query(
          `UPDATE signals
           SET processing_lock = FALSE, locked_by = NULL, locked_at = NULL
           WHERE processing_lock = TRUE
             AND locked_at < NOW() - ($1 || ' minutes')::interval
           RETURNING signal_id, status`,
          [String(config.lockStalenessMinutes)]
        );
        if (recovered.rowCount && recovered.rowCount > 0) {
          logger.warn('Recovered stale signal locks', {
            count: recovered.rowCount,
            instanceId: config.instanceId,
            stalenessMinutes: config.lockStalenessMinutes,
          });
        }

        // Bulk-reject stale pending signals so they don't clog the queue
        const staleRejected = await client.query(
          `UPDATE signals
           SET status = 'rejected', rejection_reason = 'signal_stale',
               processing_lock = FALSE, locked_by = NULL, locked_at = NULL
           WHERE (status IS NULL OR status = 'pending')
             AND processed = FALSE
             AND processing_lock = FALSE
             AND timestamp < NOW() - INTERVAL '${config.signalMaxAgeMinutes} minutes'`
        );
        if (staleRejected.rowCount && staleRejected.rowCount > 0) {
          logger.warn('Bulk-rejected stale pending signals', {
            count: staleRejected.rowCount,
            maxAgeMinutes: config.signalMaxAgeMinutes,
          });
        }
      }

      const params: Array<number | string | string[]> = [limit, config.instanceId];
      const signalFilter =
        signalIds && signalIds.length > 0 ? 'AND signal_id = ANY($3::uuid[])' : '';
      if (signalIds && signalIds.length > 0) {
        params.push(signalIds);
      }
      const result = await client.query(
        `UPDATE signals
         SET processing_lock = TRUE, locked_by = $2, locked_at = NOW()
         WHERE signal_id IN (
           SELECT signal_id
           FROM signals
           WHERE processed = FALSE AND processing_lock = FALSE
             AND (status IS NULL OR status = 'pending')
             AND (queued_until IS NULL OR queued_until <= NOW())
             AND (next_retry_at IS NULL OR next_retry_at <= NOW())
             AND timestamp >= NOW() - INTERVAL '${config.signalMaxAgeMinutes} minutes'
           ${signalFilter}
           ORDER BY timestamp DESC
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING signal_id, symbol, direction, timeframe, timestamp,
                   signal_hash, raw_payload, processed, experiment_id, status, created_at,
                   queued_until, queue_reason, processing_attempts, next_retry_at`,
        params
      );

      const signals: Signal[] = [];
      for (const row of result.rows) {
        const signal = {
          ...row,
          experiment_id: row.experiment_id ?? undefined,
        };
        const parsed = SignalSchema.safeParse(signal);
        if (parsed.success) {
          signals.push(parsed.data);
        } else {
          logger.warn('Skipping invalid signal during fetch', {
            signal_id: row.signal_id,
            errors: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
          });
          await client.query(
            `UPDATE signals SET status = 'rejected', rejection_reason = $1 WHERE signal_id = $2`,
            [`Schema validation failed: ${parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')}`, row.signal_id],
          );
        }
      }

      const orderedSignals = [...signals].sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
      );

      logger.info('Retrieved unprocessed signals', {
        count: signals.length,
        signal_ids: orderedSignals.map(s => s.signal_id),
      });

      await client.query('COMMIT');
      return orderedSignals;
    } catch (error) {
      await client.query('ROLLBACK');
      Sentry.captureException(error, {
        tags: { orchestrator: 'signal-processor', op: 'getUnprocessedSignals' },
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Creates a snapshot of market state at signal timestamp
   * Includes prices, indicators, and metadata for deterministic replay
   */
  async createMarketContext(signal: Signal): Promise<MarketContext> {
    let candles: Candle[] = [];
    let currentPrice = 0;
    let lastVolume = 0;
    let latestIndicators: Record<string, number> = {};
    let marketIntel: MarketContext['marketIntel'];

    try {
      currentPrice = await marketData.getStockPrice(signal.symbol);
    } catch (error) {
      logger.warn('Market context price unavailable', { error, symbol: signal.symbol });
    }

    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      const payloadPrice = this.extractPriceFromPayload(signal.raw_payload, signal.symbol);
      if (payloadPrice) {
        currentPrice = payloadPrice;
      }
    }

    try {
      candles = await marketData.getCandles(signal.symbol, signal.timeframe, 200);
      lastVolume = candles.length > 0 ? candles[candles.length - 1].volume : 0;
    } catch (error) {
      logger.warn('Market context candles unavailable', { error, symbol: signal.symbol });
    }

    try {
      const indicatorSeries = await marketData.getIndicators(signal.symbol, signal.timeframe);
      const latest = indicatorService.getLatestValues(indicatorSeries);
      latestIndicators = {
        ema8: latest.ema8,
        ema13: latest.ema13,
        ema21: latest.ema21,
        ema48: latest.ema48,
        ema200: latest.ema200,
        atr: latest.atr,
        bbUpper: latest.bbUpper,
        bbMiddle: latest.bbMiddle,
        bbLower: latest.bbLower,
        kcUpper: latest.kcUpper,
        kcMiddle: latest.kcMiddle,
        kcLower: latest.kcLower,
        ttmState: latest.ttmState === 'on' ? 1 : 0,
        ttmMomentum: latest.ttmMomentum,
      };
    } catch (error) {
      logger.warn('Market context indicators unavailable', { error, symbol: signal.symbol });
      latestIndicators = {
        ema8: currentPrice,
        ema13: currentPrice,
        ema21: currentPrice,
        ema48: currentPrice,
        ema200: currentPrice,
        atr: 0,
        bbUpper: currentPrice,
        bbMiddle: currentPrice,
        bbLower: currentPrice,
        kcUpper: currentPrice,
        kcMiddle: currentPrice,
        kcLower: currentPrice,
        ttmState: 0,
        ttmMomentum: 0,
      };
    }

    try {
      const atr = Number.isFinite(latestIndicators.atr) ? latestIndicators.atr : undefined;
      const price = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : undefined;
      marketIntel =
        (await marketIntelService.getMarketIntelContext(signal.symbol, {
          currentPrice: price,
          atr,
        })) ?? undefined;
    } catch (error) {
      logger.warn('Market intel unavailable for context', { error, symbol: signal.symbol });
    }

    const context: MarketContext = {
      signal_id: signal.signal_id,
      timestamp: signal.timestamp,
      symbol: signal.symbol,
      current_price: currentPrice,
      bid: currentPrice,
      ask: currentPrice,
      volume: lastVolume,
      indicators: latestIndicators,
      marketIntel,
      context_hash: '', // Will be computed below
    };

    // Compute context hash for verification
    context.context_hash = this.computeContextHash(context);

    // Validate with schema
    const validatedContext = MarketContextSchema.parse(context);

    // Store context in database
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO market_contexts 
         (signal_id, timestamp, symbol, current_price, bid, ask, volume, indicators, context_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING context_id, created_at`,
        [
          validatedContext.signal_id,
          validatedContext.timestamp,
          validatedContext.symbol,
          validatedContext.current_price,
          validatedContext.bid,
          validatedContext.ask,
          validatedContext.volume,
          validatedContext.indicators,
          validatedContext.context_hash,
        ]
      );

      const contextWithId = {
        ...validatedContext,
        context_id: result.rows[0].context_id,
        created_at: result.rows[0].created_at,
      };

      Sentry.addBreadcrumb({
        category: 'orchestrator',
        message: `Market context created for ${signal.symbol}`,
        level: 'info',
        data: { signal_id: signal.signal_id, context_id: contextWithId.context_id },
      });
      logger.info('Created market context', {
        signal_id: signal.signal_id,
        context_id: contextWithId.context_id,
        context_hash: contextWithId.context_hash,
      });

      return contextWithId;
    } finally {
      client.release();
    }
  }

  /**
   * Marks a signal as processed and links it to an experiment
   */
  async markProcessed(signal_id: string, experiment_id: string): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query(
        `UPDATE signals
         SET processed = TRUE,
             experiment_id = $1,
             processing_lock = FALSE,
             locked_by = NULL,
             locked_at = NULL,
             next_retry_at = NULL,
             processing_attempts = 0
         WHERE signal_id = $2`,
        [experiment_id, signal_id]
      );

      logger.info('Marked signal as processed', {
        signal_id,
        experiment_id,
      });
    } finally {
      client.release();
    }
  }

  /**
   * Clear processing lock on failure
   */
  async markFailed(signal_id: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `UPDATE signals SET processing_lock = FALSE, locked_by = NULL, locked_at = NULL WHERE signal_id = $1`,
        [signal_id]
      );
    } finally {
      client.release();
    }
  }

  async updateStatus(
    signal_id: string,
    status: 'approved' | 'rejected',
    rejectionReason?: string | null
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `UPDATE signals
         SET status = $1,
             rejection_reason = $3,
             processing_lock = FALSE,
             locked_by = NULL,
             locked_at = NULL,
             next_retry_at = NULL
         WHERE signal_id = $2`,
        [status, signal_id, rejectionReason ?? null]
      );
      if (status === 'rejected' && config.enableStratPlanLifecycle) {
        stratPlanLifecycleService
          .markRejectedBySignal(signal_id, rejectionReason ?? 'rejected')
          .catch((err) => logger.warn('Strat plan rejection sync failed', { signal_id, error: err }));
      }
    } finally {
      client.release();
    }
  }

  async queueSignal(signal_id: string, queuedUntil: Date, reason: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `UPDATE signals
         SET queued_until = $1,
             queued_at = NOW(),
             queue_reason = $2,
             processing_lock = FALSE,
             locked_by = NULL,
             locked_at = NULL
         WHERE signal_id = $3`,
        [queuedUntil, reason, signal_id]
      );
    } finally {
      client.release();
    }
  }

  async scheduleRetry(
    signal_id: string,
    attempts: number,
    nextRetryAt: Date,
    reason: string
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `UPDATE signals
         SET processing_attempts = $1,
             next_retry_at = $2,
             rejection_reason = $3,
             processing_lock = FALSE,
             locked_by = NULL,
             locked_at = NULL
         WHERE signal_id = $4`,
        [attempts, nextRetryAt, reason, signal_id]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Computes SHA-256 hash of market context for audit and verification
   */
  private computeContextHash(context: Omit<MarketContext, 'context_hash' | 'context_id' | 'created_at'>): string {
    const data = JSON.stringify({
      signal_id: context.signal_id,
      timestamp: context.timestamp.toISOString(),
      symbol: context.symbol,
      current_price: context.current_price,
      bid: context.bid,
      ask: context.ask,
      volume: context.volume,
      indicators: context.indicators,
    });

    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private extractPriceFromPayload(payload: Record<string, any>, symbol: string): number | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const candidates: Array<number | null> = [
      this.toNumber(payload.current_price),
      this.toNumber(payload.price),
      this.toNumber(payload.entry?.price),
      this.toNumber(payload.instrument?.current_price),
      this.toNumber(payload.market?.spy_price),
      this.toNumber(payload.market?.qqq_price),
    ];

    for (const candidate of candidates) {
      if (candidate !== null && Number.isFinite(candidate) && candidate > 0) {
        return candidate;
      }
    }

    const symbolKey = String(symbol || '').toLowerCase();
    const marketKey = payload.market?.[`${symbolKey}_price`];
    const marketPrice = this.toNumber(marketKey);
    if (marketPrice !== null && Number.isFinite(marketPrice) && marketPrice > 0) {
      return marketPrice;
    }

    return null;
  }

  private toNumber(value: unknown): number | null {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  /**
   * Retrieves market context for a signal (for replay/audit)
   */
  async getMarketContext(signal_id: string): Promise<MarketContext | null> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(
        `SELECT context_id, signal_id, timestamp, symbol, current_price, 
                bid, ask, volume, indicators, context_hash, created_at
         FROM market_contexts
         WHERE signal_id = $1`,
        [signal_id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const context = {
        ...row,
        current_price: Number(row.current_price),
        bid: Number(row.bid),
        ask: Number(row.ask),
      };

      return MarketContextSchema.parse(context);
    } finally {
      client.release();
    }
  }
}
