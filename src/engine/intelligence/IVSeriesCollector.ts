import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';
import { db } from '../../services/database.service.js';
import { massiveOptionsService } from '../data/MassiveOptionsService.js';
import type { OptionQuote } from '../data/MassiveOptionsService.js';

export interface IVSeriesRow {
  id: string;
  underlying: string;
  date: string;
  atmDte: number;
  callTicker: string;
  putTicker: string;
  callIv: number;
  putIv: number;
  atmIv: number;
  source: string;
  recordedAt: Date;
}

export interface CollectionResult {
  underlying: string;
  success: boolean;
  row: IVSeriesRow | null;
  failureReason: string | null;
}

const TARGET_DTE = 21;
const DTE_TOLERANCE = 7;
const MIN_IV = 0;
const MAX_IV = 5;
const MAX_QUOTE_AGE_SERIES_MS = 30 * 60 * 1000; // 30 min for daily series job (post-close)

/**
 * Daily ATM IV Series Collector.
 * Runs once per trading day (post-close) to record ATM call/put IV.
 * ATM = closest to |delta| = 0.50 within target DTE range.
 */
export class IVSeriesCollector {

  /**
   * Collect ATM IV for a single underlying.
   */
  async collect(underlying: string, date?: Date): Promise<CollectionResult> {
    const today = date ?? new Date();
    const dateStr = today.toISOString().split('T')[0];

    try {
      // Check if already collected today
      const existing = await db.query(
        'SELECT id FROM oe_iv_daily_series WHERE underlying = $1 AND date = $2',
        [underlying, dateStr]
      );
      if (existing.rows.length > 0) {
        return { underlying, success: true, row: null, failureReason: 'Already collected for today' };
      }

      // Fetch option snapshots via MassiveOptionsService
      const snapshot = await massiveOptionsService.getOptionsSnapshot(underlying);
      const quotes = snapshot.quotes;

      // Filter to ATM DTE range with valid data
      const candidates = quotes.filter(q => {
        const dte = this.computeDTE(q.expirationDate);
        return dte >= TARGET_DTE - DTE_TOLERANCE && dte <= TARGET_DTE + DTE_TOLERANCE;
      });

      if (candidates.length === 0) {
        return this.recordFailure(underlying, dateStr, 'NO_ATM_CANDIDATES',
          { message: `No options in DTE range ${TARGET_DTE - DTE_TOLERANCE}-${TARGET_DTE + DTE_TOLERANCE}` });
      }

      // Find best ATM call and put
      const calls = candidates.filter(q => q.contractType === 'call');
      const puts = candidates.filter(q => q.contractType === 'put');

      const atmCall = this.findClosestATM(calls);
      const atmPut = this.findClosestATM(puts);

      if (!atmCall || !atmPut) {
        return this.recordFailure(underlying, dateStr, 'MISSING_ATM_LEG',
          { hasCall: !!atmCall, hasPut: !!atmPut });
      }

      // Sanity checks
      const callFailure = this.validateQuote(atmCall, 'call');
      if (callFailure) {
        return this.recordFailure(underlying, dateStr, callFailure.reason, callFailure.details);
      }

      const putFailure = this.validateQuote(atmPut, 'put');
      if (putFailure) {
        return this.recordFailure(underlying, dateStr, putFailure.reason, putFailure.details);
      }

      const callIv = atmCall.iv!;
      const putIv = atmPut.iv!;
      const atmIv = (callIv + putIv) / 2;
      const dte = this.computeDTE(atmCall.expirationDate);

      const id = randomUUID();
      await db.query(
        `INSERT INTO oe_iv_daily_series
          (id, underlying, date, atm_dte, call_ticker, put_ticker, call_iv, put_iv, atm_iv, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, underlying, dateStr, dte, atmCall.optionTicker, atmPut.optionTicker,
         callIv, putIv, atmIv, 'MASSIVE_SNAPSHOT']
      );

      const row: IVSeriesRow = {
        id, underlying, date: dateStr, atmDte: dte,
        callTicker: atmCall.optionTicker, putTicker: atmPut.optionTicker,
        callIv, putIv, atmIv, source: 'MASSIVE_SNAPSHOT', recordedAt: new Date(),
      };

      logger.info('IV series collected', { underlying, date: dateStr, atmIv, dte });
      return { underlying, success: true, row, failureReason: null };

    } catch (err) {
      return this.recordFailure(underlying, dateStr, 'COLLECTION_ERROR',
        { message: (err as Error).message });
    }
  }

  /**
   * Collect for multiple underlyings.
   */
  async collectAll(underlyings: string[], date?: Date): Promise<CollectionResult[]> {
    const results: CollectionResult[] = [];
    for (const u of underlyings) {
      const result = await this.collect(u, date);
      results.push(result);
    }

    const succeeded = results.filter(r => r.success && r.row).length;
    const failed = results.filter(r => !r.success).length;
    logger.info('IV series collection batch complete', { total: underlyings.length, succeeded, failed });

    return results;
  }

  /**
   * Fetch historical IV series for an underlying.
   */
  async getSeries(underlying: string, limitDays: number = 252): Promise<IVSeriesRow[]> {
    const result = await db.query(
      `SELECT * FROM oe_iv_daily_series
       WHERE underlying = $1
       ORDER BY date DESC LIMIT $2`,
      [underlying, limitDays]
    );

    return result.rows.map(this.mapRow);
  }

  /**
   * Find the option closest to |delta| = 0.50 (ATM).
   */
  private findClosestATM(quotes: OptionQuote[]): OptionQuote | null {
    let best: OptionQuote | null = null;
    let bestDistance = Infinity;

    for (const q of quotes) {
      if (q.delta === null || q.iv === null) continue;
      if (q.bid <= 0 || q.ask <= 0) continue;

      const distance = Math.abs(Math.abs(q.delta) - 0.50);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = q;
      }
    }

    return best;
  }

  private validateQuote(
    quote: OptionQuote,
    leg: string
  ): { reason: string; details: Record<string, unknown> } | null {
    if (quote.iv === null) {
      return { reason: `MISSING_IV_${leg.toUpperCase()}`, details: { ticker: quote.optionTicker } };
    }
    if (quote.iv < MIN_IV || quote.iv > MAX_IV) {
      return { reason: `IV_OUT_OF_RANGE_${leg.toUpperCase()}`, details: { iv: quote.iv, ticker: quote.optionTicker } };
    }
    if (quote.bid <= 0 || quote.ask <= 0) {
      return { reason: `INVALID_QUOTES_${leg.toUpperCase()}`, details: { bid: quote.bid, ask: quote.ask } };
    }

    const age = Date.now() - quote.quoteTimestamp.getTime();
    if (age > MAX_QUOTE_AGE_SERIES_MS) {
      return { reason: `STALE_QUOTE_${leg.toUpperCase()}`, details: { ageMs: age, maxAgeMs: MAX_QUOTE_AGE_SERIES_MS } };
    }

    return null;
  }

  private computeDTE(expirationDate: string): number {
    const exp = new Date(expirationDate + 'T16:00:00-05:00');
    const now = new Date();
    return Math.max(0, Math.round((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  }

  private async recordFailure(
    underlying: string,
    dateStr: string,
    reason: string,
    details: Record<string, unknown>
  ): Promise<CollectionResult> {
    await db.query(
      `INSERT INTO oe_iv_series_failures (id, underlying, date, reason, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), underlying, dateStr, reason, JSON.stringify(details)]
    );

    logger.warn('IV series collection failed', { underlying, date: dateStr, reason });
    return { underlying, success: false, row: null, failureReason: reason };
  }

  private mapRow(row: Record<string, unknown>): IVSeriesRow {
    return {
      id: row.id as string,
      underlying: row.underlying as string,
      date: (row.date as string),
      atmDte: parseInt(row.atm_dte as string),
      callTicker: row.call_ticker as string,
      putTicker: row.put_ticker as string,
      callIv: parseFloat(row.call_iv as string),
      putIv: parseFloat(row.put_iv as string),
      atmIv: parseFloat(row.atm_iv as string),
      source: row.source as string,
      recordedAt: new Date(row.recorded_at as string),
    };
  }
}

export const ivSeriesCollector = new IVSeriesCollector();
