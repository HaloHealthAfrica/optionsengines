import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/node';
import { logger } from '../../utils/logger.js';
import { db } from '../../services/database.service.js';
import { getEngineConfig } from '../config/loader.js';
import { massiveOptionsService } from '../data/MassiveOptionsService.js';

export interface CorrelationMatrix {
  id: string;
  computedAt: Date;
  windowDays: number;
  tickers: string[];
  matrix: Record<string, Record<string, number>>;
  method: string;
  sampleCount: number;
  source: string;
  confidence: number;
}

/**
 * Nightly job: computes rolling Pearson correlation matrix
 * for the universe of traded underlyings.
 */
export class CorrelationMatrixJob {

  /**
   * Run the full correlation matrix computation.
   * Universe = core tickers + recently traded tickers.
   */
  async run(): Promise<CorrelationMatrix> {
    const cfg = getEngineConfig().correlation;
    const universe = await this.buildUniverse(cfg.coreTickers);

    if (universe.length < 2) {
      throw new Error('Correlation matrix requires at least 2 tickers');
    }

    // Fetch daily returns for each ticker
    const returnsMap = await this.fetchDailyReturns(universe, cfg.calendarDaysToFetch);

    // Filter out tickers with insufficient data
    const validTickers: string[] = [];
    const validReturns: number[][] = [];

    for (const ticker of universe) {
      const returns = returnsMap.get(ticker);
      if (!returns || returns.length < 10) {
        logger.warn('Insufficient price data for correlation', { ticker, points: returns?.length ?? 0 });
        continue;
      }
      validTickers.push(ticker);
      validReturns.push(returns);
    }

    if (validTickers.length < 2) {
      throw new Error('Insufficient valid tickers for correlation matrix after filtering');
    }

    // Align returns to common length
    const minLength = Math.min(...validReturns.map(r => r.length));
    const aligned = validReturns.map(r => r.slice(r.length - minLength));

    // Compute Pearson correlation matrix
    const matrix = this.computePearsonMatrix(validTickers, aligned);

    // Confidence based on sample count vs target window
    const confidence = Math.min(1, minLength / cfg.windowDays);

    const id = randomUUID();
    const now = new Date();

    await db.query(
      `INSERT INTO oe_correlation_matrix
        (id, computed_at, window_days, tickers, matrix, method, sample_count, source, confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id, now, cfg.windowDays, validTickers,
        JSON.stringify(matrix), cfg.method, minLength,
        'MASSIVE_AGGS', confidence,
      ]
    );

    const result: CorrelationMatrix = {
      id, computedAt: now, windowDays: cfg.windowDays,
      tickers: validTickers, matrix, method: cfg.method,
      sampleCount: minLength, source: 'MASSIVE_AGGS', confidence,
    };

    logger.info('Correlation matrix computed', {
      tickers: validTickers.length,
      sampleCount: minLength,
      confidence: confidence.toFixed(3),
    });

    return result;
  }

  /**
   * Build the universe of tickers:
   * (a) configured core tickers
   * (b) tickers traded in last 60 days
   */
  async buildUniverse(coreTickers: string[]): Promise<string[]> {
    const traded = await db.query(
      `SELECT DISTINCT underlying FROM oe_positions
       WHERE opened_at >= NOW() - INTERVAL '60 days'`
    );

    const tradedTickers = traded.rows.map((r: Record<string, unknown>) => r.underlying as string);
    const combined = new Set([...coreTickers, ...tradedTickers]);

    return Array.from(combined).sort();
  }

  /**
   * Fetch daily close prices and compute returns for each ticker.
   */
  async fetchDailyReturns(
    tickers: string[],
    calendarDays: number
  ): Promise<Map<string, number[]>> {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - calendarDays * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0];

    const returnsMap = new Map<string, number[]>();

    for (const ticker of tickers) {
      try {
        const bars = await massiveOptionsService.getDailyBars(ticker, from, to, calendarDays);

        if (bars.length < 2) {
          returnsMap.set(ticker, []);
          continue;
        }

        const returns: number[] = [];
        for (let i = 1; i < bars.length; i++) {
          const prev = bars[i - 1].close;
          if (prev === 0) continue;
          returns.push((bars[i].close - prev) / prev);
        }

        returnsMap.set(ticker, returns);
      } catch (err) {
        Sentry.captureException(err, { tags: { service: 'CorrelationMatrixJob', op: 'fetchDailyReturns' } });
        logger.warn('Failed to fetch bars for correlation', {
          ticker, error: (err as Error).message,
        });
        returnsMap.set(ticker, []);
      }
    }

    return returnsMap;
  }

  /**
   * Compute Pearson correlation for all ticker pairs.
   */
  computePearsonMatrix(
    tickers: string[],
    returns: number[][]
  ): Record<string, Record<string, number>> {
    const n = tickers.length;
    const matrix: Record<string, Record<string, number>> = {};

    for (let i = 0; i < n; i++) {
      matrix[tickers[i]] = {};
      for (let j = 0; j < n; j++) {
        if (i === j) {
          matrix[tickers[i]][tickers[j]] = 1.0;
        } else if (j < i) {
          matrix[tickers[i]][tickers[j]] = matrix[tickers[j]][tickers[i]];
        } else {
          matrix[tickers[i]][tickers[j]] = this.pearson(returns[i], returns[j]);
        }
      }
    }

    return matrix;
  }

  /**
   * Pearson correlation coefficient between two series.
   */
  pearson(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n === 0) return 0;

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += x[i];
      sumY += y[i];
      sumXY += x[i] * y[i];
      sumX2 += x[i] * x[i];
      sumY2 += y[i] * y[i];
    }

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt(
      (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
    );

    if (denominator === 0) return 0;
    return Math.max(-1, Math.min(1, numerator / denominator));
  }

  /**
   * Get the latest correlation matrix from DB.
   */
  async getLatest(): Promise<CorrelationMatrix | null> {
    const result = await db.query(
      'SELECT * FROM oe_correlation_matrix ORDER BY computed_at DESC LIMIT 1'
    );

    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  private mapRow(row: Record<string, unknown>): CorrelationMatrix {
    return {
      id: row.id as string,
      computedAt: new Date(row.computed_at as string),
      windowDays: parseInt(row.window_days as string),
      tickers: row.tickers as string[],
      matrix: row.matrix as Record<string, Record<string, number>>,
      method: row.method as string,
      sampleCount: parseInt(row.sample_count as string),
      source: row.source as string,
      confidence: parseFloat(row.confidence as string),
    };
  }
}

export const correlationMatrixJob = new CorrelationMatrixJob();
