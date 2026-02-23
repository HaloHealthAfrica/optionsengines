import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/node';
import { logger } from '../../utils/logger.js';
import { db } from '../../services/database.service.js';
import { getEngineConfig } from '../config/loader.js';
import { massiveOptionsService } from '../data/MassiveOptionsService.js';
import type { OptionQuote } from '../data/MassiveOptionsService.js';
import { IVRegime, TermShape } from '../types/enums.js';
import { ivSeriesCollector } from './IVSeriesCollector.js';

export interface VolSurfaceSnapshot {
  id: string;
  underlying: string;
  computedAt: Date;
  windowDays: number;
  frontDte: number;
  midDte: number;
  backDte: number;
  ivFront: number | null;
  ivMid: number | null;
  ivBack: number | null;
  termSlope: number | null;
  termShape: TermShape;
  skew25dRR: number | null;
  ivPercentile252d: number | null;
  ivRegime: IVRegime;
  sampleCount: number;
  confidence: number;
  source: string;
  notes: string | null;
}

export interface VolSurfaceInput {
  underlying: string;
  windowDays?: number;
}

/**
 * Volatility Surface Engine (Module 2 from Prompt 3).
 * Computes cached, auditable vol surface metrics per underlying:
 * - Term structure slope and shape
 * - Skew (25delta risk reversal proxy)
 * - ATM IV daily series + 1Y IV percentile
 * - IV regime classification
 */
export class VolSurfaceEngine {

  /**
   * Compute and persist a vol surface snapshot for an underlying.
   */
  async computeAndPersist(input: VolSurfaceInput): Promise<VolSurfaceSnapshot> {
    const cfg = getEngineConfig().volSurface;
    const windowDays = input.windowDays ?? 252;

    // Fetch current option snapshots for term structure + skew
    let quotes: OptionQuote[] = [];
    let fetchNotes: string[] = [];

    try {
      const snapshot = await massiveOptionsService.getOptionsSnapshot(input.underlying);
      quotes = snapshot.quotes;
    } catch (err) {
      Sentry.captureException(err, { tags: { service: 'VolSurfaceEngine', op: 'computeAndPersist' } });
      fetchNotes.push(`Snapshot fetch failed: ${(err as Error).message}`);
    }

    // Compute term structure anchors
    const { ivFront, ivMid, ivBack, frontDte, midDte, backDte, termNotes } =
      this.computeTermStructure(quotes, cfg);
    fetchNotes = fetchNotes.concat(termNotes);

    // Compute term slope and shape
    const { termSlope, termShape } = this.classifyTermShape(ivFront, ivBack, cfg.termEpsilon);

    // Compute 25delta skew
    const skew25dRR = this.computeSkew25d(quotes, cfg.midDTE);

    // Compute IV percentile from stored series
    const series = await ivSeriesCollector.getSeries(input.underlying, windowDays);
    const ivValues = series.map(s => s.atmIv);
    const currentIV = ivMid ?? ivFront ?? ivBack ?? (ivValues.length > 0 ? ivValues[0] : null);
    const ivPercentile = this.computeIVPercentile(ivValues, currentIV);

    // Classify IV regime
    const regimeCfg = getEngineConfig().regime;
    const ivRegime = this.classifyIVRegime(ivPercentile, ivValues.length, regimeCfg);

    // Confidence based on sample size
    const confidence = Math.min(1, ivValues.length / 252);

    const id = randomUUID();
    const now = new Date();
    const notes = fetchNotes.length > 0 ? fetchNotes.join('; ') : null;

    await db.query(
      `INSERT INTO oe_vol_surface_snapshots
        (id, underlying, computed_at, window_days, front_dte, mid_dte, back_dte,
         iv_front, iv_mid, iv_back, term_slope, term_shape,
         skew_25d_rr, iv_percentile_252d, iv_regime, sample_count, confidence, source, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        id, input.underlying, now, windowDays,
        frontDte, midDte, backDte,
        ivFront, ivMid, ivBack,
        termSlope, termShape,
        skew25dRR, ivPercentile, ivRegime,
        ivValues.length, confidence,
        'COMPUTED_FROM_MASSIVE', notes,
      ]
    );

    const snapshot: VolSurfaceSnapshot = {
      id, underlying: input.underlying, computedAt: now, windowDays,
      frontDte, midDte, backDte,
      ivFront, ivMid, ivBack, termSlope, termShape,
      skew25dRR, ivPercentile252d: ivPercentile, ivRegime,
      sampleCount: ivValues.length, confidence, source: 'COMPUTED_FROM_MASSIVE', notes,
    };

    logger.info('Vol surface computed', {
      underlying: input.underlying,
      termShape, ivRegime,
      ivPercentile: ivPercentile?.toFixed(3),
      sampleCount: ivValues.length,
    });

    return snapshot;
  }

  /**
   * Get latest snapshot from DB.
   */
  async getLatest(underlying: string): Promise<VolSurfaceSnapshot | null> {
    const result = await db.query(
      `SELECT * FROM oe_vol_surface_snapshots
       WHERE underlying = $1
       ORDER BY computed_at DESC LIMIT 1`,
      [underlying]
    );

    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  // ─── Term Structure ───

  private computeTermStructure(
    quotes: OptionQuote[],
    cfg: { frontDTERange: [number, number]; midDTE: number; backDTERange: [number, number]; backFallbackRange: [number, number] }
  ): {
    ivFront: number | null;
    ivMid: number | null;
    ivBack: number | null;
    frontDte: number;
    midDte: number;
    backDte: number;
    termNotes: string[];
  } {
    const notes: string[] = [];

    const frontCandidates = this.getATMIVsInDTERange(quotes, cfg.frontDTERange[0], cfg.frontDTERange[1]);
    const midCandidates = this.getATMIVsInDTERange(quotes, cfg.midDTE - 3, cfg.midDTE + 3);

    let backCandidates = this.getATMIVsInDTERange(quotes, cfg.backDTERange[0], cfg.backDTERange[1]);
    if (backCandidates.length === 0) {
      backCandidates = this.getATMIVsInDTERange(quotes, cfg.backFallbackRange[0], cfg.backFallbackRange[1]);
      if (backCandidates.length > 0) {
        notes.push(`Back DTE: used fallback range ${cfg.backFallbackRange[0]}-${cfg.backFallbackRange[1]}`);
      }
    }

    const ivFront = this.median(frontCandidates);
    const ivMid = this.median(midCandidates);
    const ivBack = this.median(backCandidates);

    return {
      ivFront, ivMid, ivBack,
      frontDte: cfg.frontDTERange[0],
      midDte: cfg.midDTE,
      backDte: cfg.backDTERange[0],
      termNotes: notes,
    };
  }

  /**
   * Get ATM IVs (call+put avg) for options in a DTE range.
   */
  private getATMIVsInDTERange(quotes: OptionQuote[], dteMin: number, dteMax: number): number[] {
    const ivs: number[] = [];

    // Group by expiration and strike to pair calls and puts
    const byExpStrike = new Map<string, { callIv: number | null; putIv: number | null }>();

    for (const q of quotes) {
      if (q.iv === null || q.bid <= 0 || q.ask <= 0) continue;
      if (q.delta === null) continue;

      const dte = this.computeDTE(q.expirationDate);
      if (dte < dteMin || dte > dteMax) continue;

      // Only consider near-ATM (|delta| between 0.35 and 0.65)
      if (Math.abs(q.delta) < 0.35 || Math.abs(q.delta) > 0.65) continue;

      const key = `${q.expirationDate}:${q.strikePrice}`;
      const entry = byExpStrike.get(key) ?? { callIv: null, putIv: null };

      if (q.contractType === 'call') entry.callIv = q.iv;
      else entry.putIv = q.iv;

      byExpStrike.set(key, entry);
    }

    for (const entry of byExpStrike.values()) {
      if (entry.callIv !== null && entry.putIv !== null) {
        ivs.push((entry.callIv + entry.putIv) / 2);
      } else if (entry.callIv !== null) {
        ivs.push(entry.callIv);
      } else if (entry.putIv !== null) {
        ivs.push(entry.putIv);
      }
    }

    return ivs;
  }

  // ─── Term Shape Classification ───

  classifyTermShape(
    ivFront: number | null,
    ivBack: number | null,
    epsilon: number
  ): { termSlope: number | null; termShape: TermShape } {
    if (ivFront === null || ivBack === null) {
      return { termSlope: null, termShape: TermShape.UNKNOWN };
    }

    const termSlope = ivFront - ivBack;

    if (ivFront < ivBack - epsilon) {
      return { termSlope, termShape: TermShape.CONTANGO };
    }
    if (ivFront > ivBack + epsilon) {
      return { termSlope, termShape: TermShape.BACKWARDATION };
    }
    return { termSlope, termShape: TermShape.FLAT };
  }

  // ─── Skew (25-delta risk reversal) ───

  private computeSkew25d(quotes: OptionQuote[], targetDte: number): number | null {
    const dteTolerance = 7;
    let bestPut: OptionQuote | null = null;
    let bestCall: OptionQuote | null = null;
    let bestPutDist = Infinity;
    let bestCallDist = Infinity;

    for (const q of quotes) {
      if (q.delta === null || q.iv === null) continue;
      if (q.bid <= 0 || q.ask <= 0) continue;

      const dte = this.computeDTE(q.expirationDate);
      if (Math.abs(dte - targetDte) > dteTolerance) continue;

      if (q.contractType === 'put') {
        const dist = Math.abs(q.delta - (-0.25));
        if (dist < bestPutDist) {
          bestPutDist = dist;
          bestPut = q;
        }
      } else {
        const dist = Math.abs(q.delta - 0.25);
        if (dist < bestCallDist) {
          bestCallDist = dist;
          bestCall = q;
        }
      }
    }

    if (!bestPut || !bestCall || bestPut.iv === null || bestCall.iv === null) {
      return null;
    }

    return bestPut.iv - bestCall.iv;
  }

  // ─── IV Percentile ───

  computeIVPercentile(series: number[], currentIV: number | null): number | null {
    if (currentIV === null || series.length === 0) return null;

    const below = series.filter(iv => iv < currentIV).length;
    return below / series.length;
  }

  // ─── IV Regime ───

  classifyIVRegime(
    percentile: number | null,
    sampleCount: number,
    cfg: { ivLowThreshold: number; ivHighThreshold: number; minIVSampleDays: number }
  ): IVRegime {
    if (percentile === null || sampleCount < cfg.minIVSampleDays) {
      return IVRegime.UNKNOWN;
    }
    if (percentile < cfg.ivLowThreshold) return IVRegime.LOW;
    if (percentile > cfg.ivHighThreshold) return IVRegime.HIGH;
    return IVRegime.NEUTRAL;
  }

  // ─── Utility ───

  private median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  private computeDTE(expirationDate: string): number {
    const exp = new Date(expirationDate + 'T16:00:00-05:00');
    const now = new Date();
    return Math.max(0, Math.round((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  }

  private mapRow(row: Record<string, unknown>): VolSurfaceSnapshot {
    return {
      id: row.id as string,
      underlying: row.underlying as string,
      computedAt: new Date(row.computed_at as string),
      windowDays: parseInt(row.window_days as string),
      frontDte: parseInt(row.front_dte as string),
      midDte: parseInt(row.mid_dte as string),
      backDte: parseInt(row.back_dte as string),
      ivFront: row.iv_front !== null ? parseFloat(row.iv_front as string) : null,
      ivMid: row.iv_mid !== null ? parseFloat(row.iv_mid as string) : null,
      ivBack: row.iv_back !== null ? parseFloat(row.iv_back as string) : null,
      termSlope: row.term_slope !== null ? parseFloat(row.term_slope as string) : null,
      termShape: row.term_shape as TermShape,
      skew25dRR: row.skew_25d_rr !== null ? parseFloat(row.skew_25d_rr as string) : null,
      ivPercentile252d: row.iv_percentile_252d !== null ? parseFloat(row.iv_percentile_252d as string) : null,
      ivRegime: row.iv_regime as IVRegime,
      sampleCount: parseInt(row.sample_count as string),
      confidence: parseFloat(row.confidence as string),
      source: row.source as string,
      notes: row.notes as string | null,
    };
  }
}

export const volSurfaceEngine = new VolSurfaceEngine();
