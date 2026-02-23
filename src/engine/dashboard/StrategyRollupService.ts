import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';
import { db } from '../../services/database.service.js';

export interface StrategyRollup {
  id: string;
  accountId: string;
  strategyTag: string;
  period: string;
  computedAt: Date;
  sampleCount: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
  avgRMultiple: number;
  avgSlippage: number;
  sharpe: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  profitFactor: number;
  avgHoldingDays: number;
  byRegime: Record<string, RegimeBucket>;
  byDteBucket: Record<string, DteBucket>;
  byHour: Record<string, HourBucket>;
}

export interface RegimeBucket {
  count: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
}

export interface DteBucket {
  count: number;
  winRate: number;
  avgPnl: number;
}

export interface HourBucket {
  count: number;
  winRate: number;
  avgPnl: number;
}

interface RawRow {
  realized_pnl: string;
  iv_regime: string;
  dte_at_entry: string;
  entry_date: string;
  entry_price: string;
  slippage_dollars: string | null;
  holding_period_days: string | null;
  max_adverse_excursion: string | null;
}

/**
 * Module 5.1: Strategy Performance Rollups.
 * Computes nightly/intraday aggregations across all attribution data.
 */
export class StrategyRollupService {

  /**
   * Compute and persist a rollup for a strategy/account.
   */
  async computeRollup(
    accountId: string,
    strategyTag: string,
    period: string = 'ALL'
  ): Promise<StrategyRollup> {
    const rows = await this.fetchAttributionRows(accountId, strategyTag);

    if (rows.length === 0) {
      return this.emptyRollup(accountId, strategyTag, period);
    }

    const pnls = rows.map(r => parseFloat(r.realized_pnl));
    const wins = pnls.filter(p => p > 0);
    const losses = pnls.filter(p => p < 0);

    const totalPnl = pnls.reduce((s, p) => s + p, 0);
    const avgPnl = totalPnl / pnls.length;
    const winRate = wins.length / pnls.length;

    const grossProfit = wins.reduce((s, p) => s + p, 0);
    const grossLoss = Math.abs(losses.reduce((s, p) => s + p, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    const avgRMultiple = this.computeAvgRMultiple(rows);
    const avgSlippage = this.computeAvgSlippage(rows);
    const sharpe = this.computeSharpe(pnls);
    const { maxDrawdown, maxDrawdownPct } = this.computeMaxDrawdown(pnls);
    const avgHoldingDays = this.computeAvgHoldingDays(rows);

    const byRegime = this.groupByRegime(rows);
    const byDteBucket = this.groupByDteBucket(rows);
    const byHour = this.groupByHour(rows);

    const rollup: StrategyRollup = {
      id: randomUUID(),
      accountId,
      strategyTag,
      period,
      computedAt: new Date(),
      sampleCount: pnls.length,
      winRate,
      avgPnl,
      totalPnl,
      avgRMultiple,
      avgSlippage,
      sharpe,
      maxDrawdown,
      maxDrawdownPct,
      profitFactor,
      avgHoldingDays,
      byRegime,
      byDteBucket,
      byHour,
    };

    await this.persistRollup(rollup);

    logger.info('Strategy rollup computed', {
      accountId, strategyTag, period,
      sampleCount: pnls.length, winRate: winRate.toFixed(3), sharpe: sharpe.toFixed(3),
    });

    return rollup;
  }

  /**
   * Compute rollups for all strategies in an account.
   */
  async computeAllRollups(accountId: string, period: string = 'ALL'): Promise<StrategyRollup[]> {
    const strategies = await db.query(
      `SELECT DISTINCT strategy_tag FROM oe_attribution_rows
       WHERE account_id = $1 AND realized_pnl IS NOT NULL`,
      [accountId]
    );

    const rollups: StrategyRollup[] = [];
    for (const row of strategies.rows) {
      const rollup = await this.computeRollup(accountId, row.strategy_tag as string, period);
      rollups.push(rollup);
    }

    return rollups;
  }

  /**
   * Get latest rollup for a strategy.
   */
  async getLatest(accountId: string, strategyTag: string): Promise<StrategyRollup | null> {
    const result = await db.query(
      `SELECT * FROM oe_strategy_rollups
       WHERE account_id = $1 AND strategy_tag = $2
       ORDER BY computed_at DESC LIMIT 1`,
      [accountId, strategyTag]
    );

    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  // ─── Computations ───

  private computeSharpe(pnls: number[]): number {
    if (pnls.length < 2) return 0;

    const mean = pnls.reduce((s, p) => s + p, 0) / pnls.length;
    const variance = pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / (pnls.length - 1);
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;
    return (mean / stdDev) * Math.sqrt(252);
  }

  private computeMaxDrawdown(pnls: number[]): { maxDrawdown: number; maxDrawdownPct: number } {
    if (pnls.length === 0) return { maxDrawdown: 0, maxDrawdownPct: 0 };

    let cumPnl = 0;
    let peak = 0;
    let maxDD = 0;
    let maxDDPct = 0;

    for (const pnl of pnls) {
      cumPnl += pnl;
      if (cumPnl > peak) peak = cumPnl;
      const dd = peak - cumPnl;
      if (dd > maxDD) {
        maxDD = dd;
        maxDDPct = peak > 0 ? dd / peak : 0;
      }
    }

    return { maxDrawdown: maxDD, maxDrawdownPct: maxDDPct };
  }

  private computeAvgRMultiple(rows: RawRow[]): number {
    const rMultiples: number[] = [];

    for (const r of rows) {
      const pnl = parseFloat(r.realized_pnl);
      const entryPrice = parseFloat(r.entry_price);
      if (entryPrice > 0) {
        rMultiples.push(pnl / (entryPrice * 100));
      }
    }

    if (rMultiples.length === 0) return 0;
    return rMultiples.reduce((s, r) => s + r, 0) / rMultiples.length;
  }

  private computeAvgSlippage(rows: RawRow[]): number {
    const slippages = rows
      .filter(r => r.slippage_dollars !== null)
      .map(r => parseFloat(r.slippage_dollars!));

    if (slippages.length === 0) return 0;
    return slippages.reduce((s, d) => s + d, 0) / slippages.length;
  }

  private computeAvgHoldingDays(rows: RawRow[]): number {
    const days = rows
      .filter(r => r.holding_period_days !== null)
      .map(r => parseInt(r.holding_period_days!));

    if (days.length === 0) return 0;
    return days.reduce((s, d) => s + d, 0) / days.length;
  }

  // ─── Groupings ───

  private groupByRegime(rows: RawRow[]): Record<string, RegimeBucket> {
    const groups = new Map<string, number[]>();

    for (const r of rows) {
      const regime = r.iv_regime;
      const pnl = parseFloat(r.realized_pnl);
      const list = groups.get(regime) ?? [];
      list.push(pnl);
      groups.set(regime, list);
    }

    const result: Record<string, RegimeBucket> = {};
    for (const [regime, pnls] of groups) {
      const wins = pnls.filter(p => p > 0).length;
      result[regime] = {
        count: pnls.length,
        winRate: pnls.length > 0 ? wins / pnls.length : 0,
        avgPnl: pnls.length > 0 ? pnls.reduce((s, p) => s + p, 0) / pnls.length : 0,
        totalPnl: pnls.reduce((s, p) => s + p, 0),
      };
    }

    return result;
  }

  private groupByDteBucket(rows: RawRow[]): Record<string, DteBucket> {
    const bucketize = (dte: number): string => {
      if (dte <= 7) return '0-7';
      if (dte <= 14) return '8-14';
      if (dte <= 21) return '15-21';
      if (dte <= 30) return '22-30';
      return '30+';
    };

    const groups = new Map<string, number[]>();

    for (const r of rows) {
      const bucket = bucketize(parseInt(r.dte_at_entry));
      const pnl = parseFloat(r.realized_pnl);
      const list = groups.get(bucket) ?? [];
      list.push(pnl);
      groups.set(bucket, list);
    }

    const result: Record<string, DteBucket> = {};
    for (const [bucket, pnls] of groups) {
      const wins = pnls.filter(p => p > 0).length;
      result[bucket] = {
        count: pnls.length,
        winRate: pnls.length > 0 ? wins / pnls.length : 0,
        avgPnl: pnls.length > 0 ? pnls.reduce((s, p) => s + p, 0) / pnls.length : 0,
      };
    }

    return result;
  }

  private groupByHour(rows: RawRow[]): Record<string, HourBucket> {
    const groups = new Map<string, number[]>();

    for (const r of rows) {
      const entryDate = new Date(r.entry_date);
      const hour = entryDate.getUTCHours().toString().padStart(2, '0') + ':00';
      const pnl = parseFloat(r.realized_pnl);
      const list = groups.get(hour) ?? [];
      list.push(pnl);
      groups.set(hour, list);
    }

    const result: Record<string, HourBucket> = {};
    for (const [hour, pnls] of groups) {
      const wins = pnls.filter(p => p > 0).length;
      result[hour] = {
        count: pnls.length,
        winRate: pnls.length > 0 ? wins / pnls.length : 0,
        avgPnl: pnls.length > 0 ? pnls.reduce((s, p) => s + p, 0) / pnls.length : 0,
      };
    }

    return result;
  }

  // ─── Data Access ───

  private async fetchAttributionRows(accountId: string, strategyTag: string): Promise<RawRow[]> {
    const result = await db.query(
      `SELECT realized_pnl, iv_regime, dte_at_entry, entry_date, entry_price,
              slippage_dollars, holding_period_days, max_adverse_excursion
       FROM oe_attribution_rows
       WHERE account_id = $1 AND strategy_tag = $2 AND realized_pnl IS NOT NULL
       ORDER BY exit_date ASC`,
      [accountId, strategyTag]
    );
    return result.rows as RawRow[];
  }

  private async persistRollup(rollup: StrategyRollup): Promise<void> {
    await db.query(
      `INSERT INTO oe_strategy_rollups
        (id, account_id, strategy_tag, period, computed_at,
         sample_count, win_rate, avg_pnl, total_pnl, avg_r_multiple,
         avg_slippage, sharpe, max_drawdown, max_drawdown_pct,
         profit_factor, avg_holding_days, by_regime, by_dte_bucket, by_hour)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        rollup.id, rollup.accountId, rollup.strategyTag, rollup.period, rollup.computedAt,
        rollup.sampleCount, rollup.winRate, rollup.avgPnl, rollup.totalPnl, rollup.avgRMultiple,
        rollup.avgSlippage, rollup.sharpe, rollup.maxDrawdown, rollup.maxDrawdownPct,
        rollup.profitFactor, rollup.avgHoldingDays,
        JSON.stringify(rollup.byRegime), JSON.stringify(rollup.byDteBucket), JSON.stringify(rollup.byHour),
      ]
    );
  }

  private emptyRollup(accountId: string, strategyTag: string, period: string): StrategyRollup {
    return {
      id: randomUUID(), accountId, strategyTag, period, computedAt: new Date(),
      sampleCount: 0, winRate: 0, avgPnl: 0, totalPnl: 0, avgRMultiple: 0,
      avgSlippage: 0, sharpe: 0, maxDrawdown: 0, maxDrawdownPct: 0,
      profitFactor: 0, avgHoldingDays: 0,
      byRegime: {}, byDteBucket: {}, byHour: {},
    };
  }

  private mapRow(row: Record<string, unknown>): StrategyRollup {
    return {
      id: row.id as string,
      accountId: row.account_id as string,
      strategyTag: row.strategy_tag as string,
      period: row.period as string,
      computedAt: new Date(row.computed_at as string),
      sampleCount: parseInt(row.sample_count as string),
      winRate: parseFloat(row.win_rate as string),
      avgPnl: parseFloat(row.avg_pnl as string),
      totalPnl: parseFloat(row.total_pnl as string),
      avgRMultiple: parseFloat(row.avg_r_multiple as string),
      avgSlippage: parseFloat(row.avg_slippage as string),
      sharpe: parseFloat(row.sharpe as string),
      maxDrawdown: parseFloat(row.max_drawdown as string),
      maxDrawdownPct: parseFloat(row.max_drawdown_pct as string),
      profitFactor: parseFloat(row.profit_factor as string),
      avgHoldingDays: parseFloat(row.avg_holding_days as string),
      byRegime: row.by_regime as Record<string, RegimeBucket>,
      byDteBucket: row.by_dte_bucket as Record<string, DteBucket>,
      byHour: row.by_hour as Record<string, HourBucket>,
    };
  }
}

export const strategyRollupService = new StrategyRollupService();
