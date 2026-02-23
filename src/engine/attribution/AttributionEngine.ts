import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';
import { db } from '../../services/database.service.js';
import type { IVRegime, TermShape } from '../types/enums.js';

export interface AttributionRow {
  id: string;
  accountId: string;
  positionId: string;
  strategyTag: string;
  underlying: string;
  structure: string;
  ivRegime: string;
  termShape: string;
  entryDate: Date;
  exitDate: Date | null;
  dteAtEntry: number;
  deltaAtEntry: number | null;
  contracts: number;
  entryPrice: number;
  exitPrice: number | null;
  realizedPnl: number | null;
  maxFavorableExcursion: number | null;
  maxAdverseExcursion: number | null;
  holdingPeriodDays: number | null;
  slippageDollars: number | null;
  liquidityScoreAtEntry: number | null;
  regimeTag: string | null;
}

export interface StrategyPerformance {
  strategyTag: string;
  sampleCount: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
  avgHoldingDays: number;
  avgSlippage: number;
  profitFactor: number;
  edgeScore: number;
  byRegime: Map<string, RegimePerformance>;
}

export interface RegimePerformance {
  regime: string;
  count: number;
  winRate: number;
  avgPnl: number;
}

export class AttributionEngine {

  /**
   * Record an attribution row when a position closes.
   */
  async recordAttribution(params: {
    accountId: string;
    positionId: string;
    strategyTag: string;
    underlying: string;
    structure: string;
    ivRegime: IVRegime;
    termShape: TermShape;
    entryDate: Date;
    exitDate: Date;
    dteAtEntry: number;
    deltaAtEntry: number | null;
    contracts: number;
    entryPrice: number;
    exitPrice: number;
    realizedPnl: number;
    maxFavorableExcursion: number | null;
    maxAdverseExcursion: number | null;
    slippageDollars: number | null;
    liquidityScoreAtEntry: number | null;
    regimeTag: string | null;
  }): Promise<AttributionRow> {
    const id = randomUUID();
    const holdingPeriodDays = Math.round(
      (params.exitDate.getTime() - params.entryDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    await db.query(
      `INSERT INTO oe_attribution_rows (
        id, account_id, position_id, strategy_tag, underlying, structure,
        iv_regime, term_shape, entry_date, exit_date, dte_at_entry,
        delta_at_entry, contracts, entry_price, exit_price, realized_pnl,
        max_favorable_excursion, max_adverse_excursion, holding_period_days,
        slippage_dollars, liquidity_score_at_entry, regime_tag
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        id, params.accountId, params.positionId, params.strategyTag,
        params.underlying, params.structure, params.ivRegime, params.termShape,
        params.entryDate, params.exitDate, params.dteAtEntry, params.deltaAtEntry,
        params.contracts, params.entryPrice, params.exitPrice, params.realizedPnl,
        params.maxFavorableExcursion, params.maxAdverseExcursion, holdingPeriodDays,
        params.slippageDollars, params.liquidityScoreAtEntry, params.regimeTag,
      ]
    );

    logger.info('Attribution recorded', {
      positionId: params.positionId,
      strategyTag: params.strategyTag,
      realizedPnl: params.realizedPnl,
    });

    return {
      id,
      accountId: params.accountId,
      positionId: params.positionId,
      strategyTag: params.strategyTag,
      underlying: params.underlying,
      structure: params.structure,
      ivRegime: params.ivRegime,
      termShape: params.termShape,
      entryDate: params.entryDate,
      exitDate: params.exitDate,
      dteAtEntry: params.dteAtEntry,
      deltaAtEntry: params.deltaAtEntry,
      contracts: params.contracts,
      entryPrice: params.entryPrice,
      exitPrice: params.exitPrice,
      realizedPnl: params.realizedPnl,
      maxFavorableExcursion: params.maxFavorableExcursion,
      maxAdverseExcursion: params.maxAdverseExcursion,
      holdingPeriodDays,
      slippageDollars: params.slippageDollars,
      liquidityScoreAtEntry: params.liquidityScoreAtEntry,
      regimeTag: params.regimeTag,
    };
  }

  /**
   * Compute performance summary for a strategy within an account.
   */
  async getStrategyPerformance(accountId: string, strategyTag: string): Promise<StrategyPerformance> {
    const result = await db.query(
      `SELECT * FROM oe_attribution_rows
       WHERE account_id = $1 AND strategy_tag = $2 AND realized_pnl IS NOT NULL
       ORDER BY exit_date DESC`,
      [accountId, strategyTag]
    );

    const rows = result.rows;
    if (rows.length === 0) {
      return this.emptyPerformance(strategyTag);
    }

    const pnls = rows.map(r => parseFloat(r.realized_pnl));
    const wins = pnls.filter(p => p > 0).length;
    const totalPnl = pnls.reduce((sum, p) => sum + p, 0);
    const avgPnl = totalPnl / pnls.length;
    const winRate = wins / pnls.length;

    const holdingDays = rows
      .filter(r => r.holding_period_days !== null)
      .map(r => parseInt(r.holding_period_days));
    const avgHoldingDays = holdingDays.length > 0
      ? holdingDays.reduce((s, d) => s + d, 0) / holdingDays.length
      : 0;

    const slippages = rows
      .filter(r => r.slippage_dollars !== null)
      .map(r => parseFloat(r.slippage_dollars));
    const avgSlippage = slippages.length > 0
      ? slippages.reduce((s, d) => s + d, 0) / slippages.length
      : 0;

    const grossProfit = pnls.filter(p => p > 0).reduce((s, p) => s + p, 0);
    const grossLoss = Math.abs(pnls.filter(p => p < 0).reduce((s, p) => s + p, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    const edgeScore = this.computeEdgeScore(winRate, avgPnl, pnls.length, profitFactor);

    // By-regime breakdown
    const byRegime = new Map<string, RegimePerformance>();
    for (const row of rows) {
      const regime = row.iv_regime as string;
      const pnl = parseFloat(row.realized_pnl);
      const existing = byRegime.get(regime);

      if (existing) {
        existing.count++;
        if (pnl > 0) existing.winRate = (existing.winRate * (existing.count - 1) + 1) / existing.count;
        else existing.winRate = (existing.winRate * (existing.count - 1)) / existing.count;
        existing.avgPnl = (existing.avgPnl * (existing.count - 1) + pnl) / existing.count;
      } else {
        byRegime.set(regime, {
          regime,
          count: 1,
          winRate: pnl > 0 ? 1 : 0,
          avgPnl: pnl,
        });
      }
    }

    return {
      strategyTag,
      sampleCount: pnls.length,
      winRate,
      avgPnl,
      totalPnl,
      avgHoldingDays,
      avgSlippage,
      profitFactor,
      edgeScore,
      byRegime,
    };
  }

  /**
   * Detect edge decay: compare recent N trades to overall performance.
   * Returns true if recent performance has degraded beyond threshold.
   */
  async detectEdgeDecay(
    accountId: string,
    strategyTag: string,
    recentWindowSize: number = 20,
    degradationThreshold: number = 0.10
  ): Promise<{ decaying: boolean; recentWinRate: number; overallWinRate: number; delta: number }> {
    const overall = await this.getStrategyPerformance(accountId, strategyTag);

    if (overall.sampleCount < recentWindowSize * 2) {
      return { decaying: false, recentWinRate: overall.winRate, overallWinRate: overall.winRate, delta: 0 };
    }

    const recentResult = await db.query(
      `SELECT realized_pnl FROM oe_attribution_rows
       WHERE account_id = $1 AND strategy_tag = $2 AND realized_pnl IS NOT NULL
       ORDER BY exit_date DESC LIMIT $3`,
      [accountId, strategyTag, recentWindowSize]
    );

    const recentPnls = recentResult.rows.map((r: Record<string, unknown>) => parseFloat(r.realized_pnl as string));
    const recentWins = recentPnls.filter(p => p > 0).length;
    const recentWinRate = recentPnls.length > 0 ? recentWins / recentPnls.length : 0;

    const delta = overall.winRate - recentWinRate;
    const decaying = delta > degradationThreshold;

    if (decaying) {
      logger.warn('Edge decay detected', {
        strategyTag, recentWinRate, overallWinRate: overall.winRate, delta,
      });
    }

    return { decaying, recentWinRate, overallWinRate: overall.winRate, delta };
  }

  /**
   * Edge score: composite metric combining win rate, avg P&L, and sample size.
   */
  computeEdgeScore(winRate: number, avgPnl: number, sampleCount: number, profitFactor: number): number {
    const winComponent = winRate * 0.40;
    const pfComponent = Math.min(profitFactor / 3, 1) * 0.30;
    const sampleComponent = Math.min(sampleCount / 100, 1) * 0.15;
    const pnlComponent = (avgPnl > 0 ? Math.min(avgPnl / 200, 1) : 0) * 0.15;

    return Math.max(0, Math.min(1, winComponent + pfComponent + sampleComponent + pnlComponent));
  }

  private emptyPerformance(strategyTag: string): StrategyPerformance {
    return {
      strategyTag,
      sampleCount: 0,
      winRate: 0,
      avgPnl: 0,
      totalPnl: 0,
      avgHoldingDays: 0,
      avgSlippage: 0,
      profitFactor: 0,
      edgeScore: 0,
      byRegime: new Map(),
    };
  }
}

export const attributionEngine = new AttributionEngine();
