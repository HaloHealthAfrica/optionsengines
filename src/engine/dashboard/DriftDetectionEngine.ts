import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';
import { db } from '../../services/database.service.js';
import { getEngineConfig } from '../config/loader.js';

export type DriftType = 'WIN_RATE' | 'SHARPE' | 'SLIPPAGE' | 'PNL_MEAN';
export type DriftSeverity = 'WARNING' | 'CRITICAL';

export interface DriftEvent {
  id: string;
  accountId: string;
  strategyTag: string;
  detectedAt: Date;
  driftType: DriftType;
  baselineValue: number;
  currentValue: number;
  delta: number;
  threshold: number;
  baselineWindow: number;
  rollingWindow: number;
  severity: DriftSeverity;
  resolved: boolean;
  resolvedAt: Date | null;
  metadata: Record<string, unknown> | null;
}

export interface DriftDetectionResult {
  strategyTag: string;
  driftsDetected: DriftEvent[];
  rollingWindow: number;
  baselineWindow: number;
  checkedAt: Date;
}

interface DriftThresholds {
  winRateDropPct: number;
  sharpeDropAbs: number;
  slippageIncreasePct: number;
  pnlMeanDropPct: number;
}

const DEFAULT_THRESHOLDS: DriftThresholds = {
  winRateDropPct: 0.10,
  sharpeDropAbs: 0.5,
  slippageIncreasePct: 0.50,
  pnlMeanDropPct: 0.30,
};

/**
 * Module 5.2: Drift Detection Engine.
 * Detects when live performance deviates from baseline using rolling vs historical windows.
 * Emits STRATEGY_DEGRADATION_DETECTED to feed MetaLearner.
 */
export class DriftDetectionEngine {

  private getThresholds(): DriftThresholds {
    try {
      const config = getEngineConfig();
      const drift = config.research?.drift;
      return {
        winRateDropPct: drift?.winRateDropPct ?? DEFAULT_THRESHOLDS.winRateDropPct,
        sharpeDropAbs: drift?.sharpeDropAbs ?? DEFAULT_THRESHOLDS.sharpeDropAbs,
        slippageIncreasePct: drift?.slippageIncreasePct ?? DEFAULT_THRESHOLDS.slippageIncreasePct,
        pnlMeanDropPct: drift?.pnlMeanDropPct ?? DEFAULT_THRESHOLDS.pnlMeanDropPct,
      };
    } catch {
      return DEFAULT_THRESHOLDS;
    }
  }

  /**
   * Run drift detection for a specific strategy.
   */
  async detect(
    accountId: string,
    strategyTag: string,
    rollingWindow: number = 30,
    baselineWindow: number = 100
  ): Promise<DriftDetectionResult> {
    const rows = await this.fetchRecentTrades(accountId, strategyTag, baselineWindow + rollingWindow);

    if (rows.length < baselineWindow) {
      logger.info('Insufficient data for drift detection', {
        accountId, strategyTag, available: rows.length, required: baselineWindow,
      });
      return {
        strategyTag, driftsDetected: [],
        rollingWindow, baselineWindow, checkedAt: new Date(),
      };
    }

    const recentRows = rows.slice(0, rollingWindow);
    const baselineRows = rows.slice(rollingWindow, rollingWindow + baselineWindow);

    const recentPnls = recentRows.map(r => parseFloat(r.realized_pnl));
    const baselinePnls = baselineRows.map(r => parseFloat(r.realized_pnl));

    const recentSlippages = recentRows
      .filter(r => r.slippage_dollars !== null)
      .map(r => parseFloat(r.slippage_dollars!));
    const baselineSlippages = baselineRows
      .filter(r => r.slippage_dollars !== null)
      .map(r => parseFloat(r.slippage_dollars!));

    const thresholds = this.getThresholds();
    const drifts: DriftEvent[] = [];

    // Win rate drift
    const recentWinRate = recentPnls.filter(p => p > 0).length / recentPnls.length;
    const baselineWinRate = baselinePnls.filter(p => p > 0).length / baselinePnls.length;
    if (baselineWinRate > 0) {
      const winRateDelta = baselineWinRate - recentWinRate;
      if (winRateDelta > thresholds.winRateDropPct) {
        drifts.push(this.buildEvent(accountId, strategyTag, 'WIN_RATE',
          baselineWinRate, recentWinRate, winRateDelta, thresholds.winRateDropPct,
          baselineWindow, rollingWindow));
      }
    }

    // Sharpe drift
    const recentSharpe = this.computeSharpe(recentPnls);
    const baselineSharpe = this.computeSharpe(baselinePnls);
    const sharpeDelta = baselineSharpe - recentSharpe;
    if (sharpeDelta > thresholds.sharpeDropAbs) {
      drifts.push(this.buildEvent(accountId, strategyTag, 'SHARPE',
        baselineSharpe, recentSharpe, sharpeDelta, thresholds.sharpeDropAbs,
        baselineWindow, rollingWindow));
    }

    // Slippage drift
    if (recentSlippages.length > 0 && baselineSlippages.length > 0) {
      const recentAvgSlip = recentSlippages.reduce((s, d) => s + d, 0) / recentSlippages.length;
      const baselineAvgSlip = baselineSlippages.reduce((s, d) => s + d, 0) / baselineSlippages.length;
      if (baselineAvgSlip !== 0) {
        const slipDelta = (recentAvgSlip - baselineAvgSlip) / Math.abs(baselineAvgSlip);
        if (slipDelta > thresholds.slippageIncreasePct) {
          drifts.push(this.buildEvent(accountId, strategyTag, 'SLIPPAGE',
            baselineAvgSlip, recentAvgSlip, slipDelta, thresholds.slippageIncreasePct,
            baselineWindow, rollingWindow));
        }
      }
    }

    // PnL mean drift
    const recentMeanPnl = recentPnls.reduce((s, p) => s + p, 0) / recentPnls.length;
    const baselineMeanPnl = baselinePnls.reduce((s, p) => s + p, 0) / baselinePnls.length;
    if (baselineMeanPnl > 0) {
      const pnlDelta = (baselineMeanPnl - recentMeanPnl) / baselineMeanPnl;
      if (pnlDelta > thresholds.pnlMeanDropPct) {
        drifts.push(this.buildEvent(accountId, strategyTag, 'PNL_MEAN',
          baselineMeanPnl, recentMeanPnl, pnlDelta, thresholds.pnlMeanDropPct,
          baselineWindow, rollingWindow));
      }
    }

    for (const drift of drifts) {
      await this.persistDriftEvent(drift);
    }

    if (drifts.length > 0) {
      logger.warn('STRATEGY_DEGRADATION_DETECTED', {
        accountId, strategyTag, driftCount: drifts.length,
        types: drifts.map(d => d.driftType),
      });
    }

    return {
      strategyTag,
      driftsDetected: drifts,
      rollingWindow,
      baselineWindow,
      checkedAt: new Date(),
    };
  }

  /**
   * Run drift detection for all strategies in an account.
   */
  async detectAll(
    accountId: string,
    rollingWindow: number = 30,
    baselineWindow: number = 100
  ): Promise<DriftDetectionResult[]> {
    const strategies = await db.query(
      `SELECT DISTINCT strategy_tag FROM oe_attribution_rows
       WHERE account_id = $1 AND realized_pnl IS NOT NULL`,
      [accountId]
    );

    const results: DriftDetectionResult[] = [];
    for (const row of strategies.rows) {
      const result = await this.detect(accountId, row.strategy_tag as string, rollingWindow, baselineWindow);
      results.push(result);
    }

    return results;
  }

  /**
   * Get unresolved drift events for an account.
   */
  async getUnresolvedDrifts(accountId: string): Promise<DriftEvent[]> {
    const result = await db.query(
      `SELECT * FROM oe_drift_events
       WHERE account_id = $1 AND resolved = false
       ORDER BY detected_at DESC`,
      [accountId]
    );
    return result.rows.map(r => this.mapRow(r));
  }

  /**
   * Resolve a drift event.
   */
  async resolveDrift(driftId: string): Promise<void> {
    await db.query(
      `UPDATE oe_drift_events SET resolved = true, resolved_at = NOW() WHERE id = $1`,
      [driftId]
    );
  }

  // ─── Internal ───

  private computeSharpe(pnls: number[]): number {
    if (pnls.length < 2) return 0;
    const mean = pnls.reduce((s, p) => s + p, 0) / pnls.length;
    const variance = pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / (pnls.length - 1);
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return 0;
    return (mean / stdDev) * Math.sqrt(252);
  }

  private buildEvent(
    accountId: string, strategyTag: string,
    driftType: DriftType,
    baselineValue: number, currentValue: number,
    delta: number, threshold: number,
    baselineWindow: number, rollingWindow: number
  ): DriftEvent {
    const severity: DriftSeverity = delta > threshold * 2 ? 'CRITICAL' : 'WARNING';

    return {
      id: randomUUID(),
      accountId,
      strategyTag,
      detectedAt: new Date(),
      driftType,
      baselineValue,
      currentValue,
      delta,
      threshold,
      baselineWindow,
      rollingWindow,
      severity,
      resolved: false,
      resolvedAt: null,
      metadata: null,
    };
  }

  private async fetchRecentTrades(
    accountId: string, strategyTag: string, limit: number
  ): Promise<Array<{ realized_pnl: string; slippage_dollars: string | null }>> {
    const result = await db.query(
      `SELECT realized_pnl, slippage_dollars
       FROM oe_attribution_rows
       WHERE account_id = $1 AND strategy_tag = $2 AND realized_pnl IS NOT NULL
       ORDER BY exit_date DESC
       LIMIT $3`,
      [accountId, strategyTag, limit]
    );
    return result.rows as Array<{ realized_pnl: string; slippage_dollars: string | null }>;
  }

  private async persistDriftEvent(event: DriftEvent): Promise<void> {
    await db.query(
      `INSERT INTO oe_drift_events
        (id, account_id, strategy_tag, detected_at, drift_type,
         baseline_value, current_value, delta, threshold,
         baseline_window, rolling_window, severity, resolved, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        event.id, event.accountId, event.strategyTag, event.detectedAt, event.driftType,
        event.baselineValue, event.currentValue, event.delta, event.threshold,
        event.baselineWindow, event.rollingWindow, event.severity, event.resolved,
        event.metadata ? JSON.stringify(event.metadata) : null,
      ]
    );
  }

  private mapRow(row: Record<string, unknown>): DriftEvent {
    return {
      id: row.id as string,
      accountId: row.account_id as string,
      strategyTag: row.strategy_tag as string,
      detectedAt: new Date(row.detected_at as string),
      driftType: row.drift_type as DriftType,
      baselineValue: parseFloat(row.baseline_value as string),
      currentValue: parseFloat(row.current_value as string),
      delta: parseFloat(row.delta as string),
      threshold: parseFloat(row.threshold as string),
      baselineWindow: parseInt(row.baseline_window as string),
      rollingWindow: parseInt(row.rolling_window as string),
      severity: row.severity as DriftSeverity,
      resolved: row.resolved as boolean,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
      metadata: row.metadata as Record<string, unknown> | null,
    };
  }
}

export const driftDetectionEngine = new DriftDetectionEngine();
