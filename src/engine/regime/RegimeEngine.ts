import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';
import { db } from '../../services/database.service.js';
import { getEngineConfig } from '../config/loader.js';
import { IVRegime, TermShape } from '../types/enums.js';
import type { RegimeSnapshot } from '../types/index.js';

export interface RegimeInput {
  underlying: string;
  currentATMIV: number | null;
  ivDailySeries: number[];
  frontIV: number | null;
  midIV: number | null;
  backIV: number | null;
}

export class RegimeEngine {

  /**
   * Compute and persist a regime snapshot for an underlying.
   * Uses IV percentile for regime classification and term structure for shape.
   */
  async computeAndPersist(input: RegimeInput): Promise<RegimeSnapshot> {
    const cfg = getEngineConfig().regime;

    const ivPercentile = this.computeIVPercentile(input.ivDailySeries, input.currentATMIV);
    const ivRegime = this.classifyIVRegime(ivPercentile, input.ivDailySeries.length, cfg);
    const termShape = this.classifyTermShape(input.frontIV, input.backIV);
    const confidence = this.computeConfidence(input.ivDailySeries.length);

    // Hysteresis: only change regime if it's been different for N consecutive readings
    const prevSnapshot = await this.getLatest(input.underlying);
    let hysteresisCount = 0;

    if (prevSnapshot && prevSnapshot.ivRegime !== ivRegime) {
      hysteresisCount = prevSnapshot.hysteresisCount + 1;
    }

    const effectiveRegime = (prevSnapshot && hysteresisCount < cfg.hysteresisCount)
      ? prevSnapshot.ivRegime
      : ivRegime;

    const finalHysteresis = (effectiveRegime === ivRegime) ? 0 : hysteresisCount;

    const snapshot: RegimeSnapshot = {
      id: randomUUID(),
      underlying: input.underlying,
      computedAt: new Date(),
      ivPercentile,
      ivRegime: effectiveRegime,
      termShape,
      confidence,
      hysteresisCount: finalHysteresis,
      source: 'COMPUTED',
    };

    await this.persist(snapshot);

    logger.info('Regime computed', {
      underlying: input.underlying,
      ivRegime: effectiveRegime,
      termShape,
      ivPercentile,
      confidence,
      hysteresisCount: finalHysteresis,
    });

    return snapshot;
  }

  /**
   * IV Percentile: count of historical IVs below current / N
   */
  computeIVPercentile(series: number[], currentIV: number | null): number | null {
    if (currentIV === null || series.length === 0) return null;

    const below = series.filter(iv => iv < currentIV).length;
    return below / series.length;
  }

  /**
   * Classify IV regime based on percentile and thresholds.
   */
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

  /**
   * Term structure classification.
   * CONTANGO: front IV < back IV - epsilon
   * BACKWARDATION: front IV > back IV + epsilon
   * FLAT: within epsilon band
   * UNKNOWN: if either anchor missing
   */
  classifyTermShape(frontIV: number | null, backIV: number | null): TermShape {
    const cfg = getEngineConfig().volSurface;

    if (frontIV === null || backIV === null) return TermShape.UNKNOWN;

    const diff = frontIV - backIV;
    if (diff < -cfg.termEpsilon) return TermShape.CONTANGO;
    if (diff > cfg.termEpsilon) return TermShape.BACKWARDATION;
    return TermShape.FLAT;
  }

  /**
   * Confidence based on sample size relative to 252 trading days.
   */
  computeConfidence(sampleCount: number): number {
    return Math.min(1, Math.max(0, sampleCount / 252));
  }

  /**
   * Get latest regime snapshot for an underlying.
   */
  async getLatest(underlying: string): Promise<RegimeSnapshot | null> {
    const result = await db.query(
      `SELECT * FROM oe_regime_snapshots
       WHERE underlying = $1
       ORDER BY computed_at DESC LIMIT 1`,
      [underlying]
    );

    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  /**
   * Check if regime blocks trading (when blockTradesOnUnknownIV = true).
   */
  shouldBlockTrade(regime: RegimeSnapshot): { blocked: boolean; reason: string | null } {
    const cfg = getEngineConfig().regime;

    if (cfg.blockTradesOnUnknownIV && regime.ivRegime === IVRegime.UNKNOWN) {
      return { blocked: true, reason: 'IV regime is UNKNOWN and blockTradesOnUnknownIV is enabled' };
    }

    return { blocked: false, reason: null };
  }

  // ─── Persistence ───

  private async persist(snapshot: RegimeSnapshot): Promise<void> {
    await db.query(
      `INSERT INTO oe_regime_snapshots (id, underlying, computed_at, iv_percentile, iv_regime, term_shape, confidence, hysteresis_count, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (underlying, computed_at) DO UPDATE SET
         iv_percentile = EXCLUDED.iv_percentile,
         iv_regime = EXCLUDED.iv_regime,
         term_shape = EXCLUDED.term_shape,
         confidence = EXCLUDED.confidence,
         hysteresis_count = EXCLUDED.hysteresis_count`,
      [
        snapshot.id, snapshot.underlying, snapshot.computedAt,
        snapshot.ivPercentile, snapshot.ivRegime, snapshot.termShape,
        snapshot.confidence, snapshot.hysteresisCount, snapshot.source,
      ]
    );
  }

  private mapRow(row: Record<string, unknown>): RegimeSnapshot {
    return {
      id: row.id as string,
      underlying: row.underlying as string,
      computedAt: new Date(row.computed_at as string),
      ivPercentile: row.iv_percentile !== null ? parseFloat(row.iv_percentile as string) : null,
      ivRegime: row.iv_regime as IVRegime,
      termShape: row.term_shape as TermShape,
      confidence: parseFloat(row.confidence as string),
      hysteresisCount: parseInt(row.hysteresis_count as string),
      source: row.source as string,
    };
  }
}

export const regimeEngine = new RegimeEngine();
