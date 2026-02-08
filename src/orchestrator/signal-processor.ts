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
import { SignalSchema, MarketContextSchema } from './schemas.js';
import { logger } from '../utils/logger.js';
import { marketData } from '../services/market-data.js';

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
      const params: Array<number | string[]> = [limit];
      const signalFilter =
        signalIds && signalIds.length > 0 ? 'AND signal_id = ANY($2::uuid[])' : '';
      if (signalIds && signalIds.length > 0) {
        params.push(signalIds);
      }
      const result = await client.query(
        `UPDATE signals
         SET processing_lock = TRUE
         WHERE signal_id IN (
           SELECT signal_id
           FROM signals
           WHERE processed = FALSE AND processing_lock = FALSE
           ${signalFilter}
           ORDER BY timestamp ASC
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING signal_id, symbol, direction, timeframe, timestamp,
                   signal_hash, raw_payload, processed, experiment_id, status, created_at`,
        params
      );

      const signals: Signal[] = result.rows.map(row => {
        const signal = {
          ...row,
          experiment_id: row.experiment_id ?? undefined,
        };
        
        // Validate with schema
        return SignalSchema.parse(signal);
      });

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
    const candles = await marketData.getCandles(signal.symbol, signal.timeframe, 200);
    const indicators = await marketData.getIndicators(signal.symbol, signal.timeframe);
    const currentPrice = await marketData.getStockPrice(signal.symbol);
    const lastVolume = candles.length > 0 ? candles[candles.length - 1].volume : 0;

    const context: MarketContext = {
      signal_id: signal.signal_id,
      timestamp: signal.timestamp,
      symbol: signal.symbol,
      current_price: currentPrice,
      bid: currentPrice,
      ask: currentPrice,
      volume: lastVolume,
      indicators: indicators as unknown as Record<string, number>,
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
         SET processed = TRUE, experiment_id = $1, processing_lock = FALSE
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
        `UPDATE signals SET processing_lock = FALSE WHERE signal_id = $1`,
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
             rejection_reason = $3
         WHERE signal_id = $2`,
        [status, signal_id, rejectionReason ?? null]
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
