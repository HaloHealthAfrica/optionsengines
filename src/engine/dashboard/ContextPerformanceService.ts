import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/node';
import { logger } from '../../utils/logger.js';
import { db } from '../../services/database.service.js';

export type ContextType =
  | 'IV_PERCENTILE_BUCKET'
  | 'TERM_SHAPE'
  | 'SKEW_REGIME'
  | 'LIQUIDITY_REGIME'
  | 'IV_REGIME';

export interface ContextPerformanceRow {
  id: string;
  accountId: string;
  strategyTag: string;
  contextType: ContextType;
  contextValue: string;
  computedAt: Date;
  sampleCount: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
  sharpe: number;
  avgSlippage: number;
  notes: string | null;
}

export interface ContextBreakdown {
  strategyTag: string;
  contextType: ContextType;
  computedAt: Date;
  segments: ContextPerformanceRow[];
}

interface TradeRow {
  realized_pnl: string;
  iv_regime: string;
  term_shape: string | null;
  regime_tag: string | null;
  liquidity_score_at_entry: string | null;
  slippage_dollars: string | null;
}

/**
 * Module 5.3: Context Performance Service.
 * Groups trades by IV percentile bucket, term structure shape, skew regime,
 * and liquidity regime to expose when strategies work and when they don't.
 */
export class ContextPerformanceService {

  /**
   * Compute and persist context performance for a strategy across all context types.
   */
  async computeAll(accountId: string, strategyTag: string): Promise<ContextBreakdown[]> {
    const rows = await this.fetchTrades(accountId, strategyTag);

    if (rows.length === 0) {
      logger.info('No trades for context performance', { accountId, strategyTag });
      return [];
    }

    Sentry.addBreadcrumb({
      category: 'engine',
      message: 'Context performance computation started',
      level: 'info',
      data: { accountId, strategyTag, tradeCount: rows.length },
    });

    const breakdowns: ContextBreakdown[] = [];

    breakdowns.push(await this.computeByIVRegime(accountId, strategyTag, rows));
    breakdowns.push(await this.computeByIVPercentileBucket(accountId, strategyTag));
    breakdowns.push(await this.computeByTermShape(accountId, strategyTag, rows));
    breakdowns.push(await this.computeByLiquidityRegime(accountId, strategyTag, rows));

    return breakdowns;
  }

  /**
   * Compute context breakdown for all strategies in an account.
   */
  async computeAllStrategies(accountId: string): Promise<Map<string, ContextBreakdown[]>> {
    const strategies = await db.query(
      `SELECT DISTINCT strategy_tag FROM oe_attribution_rows
       WHERE account_id = $1 AND realized_pnl IS NOT NULL`,
      [accountId]
    );

    const result = new Map<string, ContextBreakdown[]>();
    for (const row of strategies.rows) {
      const tag = row.strategy_tag as string;
      const breakdowns = await this.computeAll(accountId, tag);
      result.set(tag, breakdowns);
    }

    return result;
  }

  /**
   * Get latest context performance for a strategy + context type.
   */
  async getLatest(
    accountId: string, strategyTag: string, contextType: ContextType
  ): Promise<ContextPerformanceRow[]> {
    const result = await db.query(
      `SELECT DISTINCT ON (context_value) *
       FROM oe_context_performance
       WHERE account_id = $1 AND strategy_tag = $2 AND context_type = $3
       ORDER BY context_value, computed_at DESC`,
      [accountId, strategyTag, contextType]
    );
    return result.rows.map(r => this.mapRow(r));
  }

  // ─── By IV Regime ───

  private async computeByIVRegime(
    accountId: string, strategyTag: string, rows: TradeRow[]
  ): Promise<ContextBreakdown> {
    const groups = this.groupBy(rows, r => r.iv_regime);
    const segments = this.buildSegments(accountId, strategyTag, 'IV_REGIME', groups);

    for (const seg of segments) {
      await this.persistRow(seg);
    }

    return { strategyTag, contextType: 'IV_REGIME', computedAt: new Date(), segments };
  }

  // ─── By IV Percentile Bucket ───

  private async computeByIVPercentileBucket(
    accountId: string, strategyTag: string
  ): Promise<ContextBreakdown> {
    const result = await db.query(
      `SELECT a.realized_pnl, a.slippage_dollars,
              v.iv_percentile_252d
       FROM oe_attribution_rows a
       LEFT JOIN oe_vol_surface_snapshots v
         ON a.underlying = v.underlying
         AND v.computed_at::date = a.entry_date::date
       WHERE a.account_id = $1 AND a.strategy_tag = $2 AND a.realized_pnl IS NOT NULL
       ORDER BY a.exit_date ASC`,
      [accountId, strategyTag]
    );

    const bucketize = (pct: number | null): string => {
      if (pct === null) return 'UNKNOWN';
      if (pct < 0.33) return 'LOW_0-33';
      if (pct < 0.66) return 'MID_33-66';
      return 'HIGH_66-100';
    };

    const groups = new Map<string, number[]>();
    const slippageGroups = new Map<string, number[]>();

    for (const row of result.rows) {
      const bucket = bucketize(
        row.iv_percentile_252d !== null ? parseFloat(row.iv_percentile_252d as string) : null
      );
      const pnl = parseFloat(row.realized_pnl as string);
      const list = groups.get(bucket) ?? [];
      list.push(pnl);
      groups.set(bucket, list);

      if (row.slippage_dollars !== null) {
        const slipList = slippageGroups.get(bucket) ?? [];
        slipList.push(parseFloat(row.slippage_dollars as string));
        slippageGroups.set(bucket, slipList);
      }
    }

    const segments: ContextPerformanceRow[] = [];
    for (const [bucket, pnls] of groups) {
      const slippages = slippageGroups.get(bucket) ?? [];
      segments.push(this.buildSegment(
        accountId, strategyTag, 'IV_PERCENTILE_BUCKET', bucket, pnls, slippages
      ));
    }

    for (const seg of segments) {
      await this.persistRow(seg);
    }

    return { strategyTag, contextType: 'IV_PERCENTILE_BUCKET', computedAt: new Date(), segments };
  }

  // ─── By Term Shape ───

  private async computeByTermShape(
    accountId: string, strategyTag: string, rows: TradeRow[]
  ): Promise<ContextBreakdown> {
    const groups = this.groupBy(rows, r => r.term_shape ?? 'UNKNOWN');
    const segments = this.buildSegments(accountId, strategyTag, 'TERM_SHAPE', groups);

    for (const seg of segments) {
      await this.persistRow(seg);
    }

    return { strategyTag, contextType: 'TERM_SHAPE', computedAt: new Date(), segments };
  }

  // ─── By Liquidity Regime ───

  private async computeByLiquidityRegime(
    accountId: string, strategyTag: string, rows: TradeRow[]
  ): Promise<ContextBreakdown> {
    const bucketize = (score: number | null): string => {
      if (score === null) return 'UNKNOWN';
      if (score < 0.3) return 'LOW';
      if (score < 0.7) return 'MEDIUM';
      return 'HIGH';
    };

    const groups = this.groupBy(rows, r =>
      bucketize(r.liquidity_score_at_entry !== null ? parseFloat(r.liquidity_score_at_entry) : null)
    );
    const segments = this.buildSegments(accountId, strategyTag, 'LIQUIDITY_REGIME', groups);

    for (const seg of segments) {
      await this.persistRow(seg);
    }

    return { strategyTag, contextType: 'LIQUIDITY_REGIME', computedAt: new Date(), segments };
  }

  // ─── Helpers ───

  private groupBy(
    rows: TradeRow[],
    keyFn: (r: TradeRow) => string
  ): Map<string, { pnls: number[]; slippages: number[] }> {
    const groups = new Map<string, { pnls: number[]; slippages: number[] }>();

    for (const r of rows) {
      const key = keyFn(r);
      const group = groups.get(key) ?? { pnls: [], slippages: [] };
      group.pnls.push(parseFloat(r.realized_pnl));
      if (r.slippage_dollars !== null) {
        group.slippages.push(parseFloat(r.slippage_dollars));
      }
      groups.set(key, group);
    }

    return groups;
  }

  private buildSegments(
    accountId: string, strategyTag: string,
    contextType: ContextType,
    groups: Map<string, { pnls: number[]; slippages: number[] }>
  ): ContextPerformanceRow[] {
    const segments: ContextPerformanceRow[] = [];
    for (const [value, data] of groups) {
      segments.push(this.buildSegment(
        accountId, strategyTag, contextType, value, data.pnls, data.slippages
      ));
    }
    return segments;
  }

  private buildSegment(
    accountId: string, strategyTag: string,
    contextType: ContextType, contextValue: string,
    pnls: number[], slippages: number[]
  ): ContextPerformanceRow {
    const wins = pnls.filter(p => p > 0).length;
    const totalPnl = pnls.reduce((s, p) => s + p, 0);
    const avgPnl = pnls.length > 0 ? totalPnl / pnls.length : 0;
    const winRate = pnls.length > 0 ? wins / pnls.length : 0;
    const avgSlippage = slippages.length > 0
      ? slippages.reduce((s, d) => s + d, 0) / slippages.length : 0;

    return {
      id: randomUUID(),
      accountId,
      strategyTag,
      contextType,
      contextValue,
      computedAt: new Date(),
      sampleCount: pnls.length,
      winRate,
      avgPnl,
      totalPnl,
      sharpe: this.computeSharpe(pnls),
      avgSlippage,
      notes: null,
    };
  }

  private computeSharpe(pnls: number[]): number {
    if (pnls.length < 2) return 0;
    const mean = pnls.reduce((s, p) => s + p, 0) / pnls.length;
    const variance = pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / (pnls.length - 1);
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return 0;
    return (mean / stdDev) * Math.sqrt(252);
  }

  private async fetchTrades(accountId: string, strategyTag: string): Promise<TradeRow[]> {
    const result = await db.query(
      `SELECT a.realized_pnl, a.iv_regime, a.regime_tag,
              a.slippage_dollars, a.liquidity_score_at_entry,
              r.term_shape
       FROM oe_attribution_rows a
       LEFT JOIN LATERAL (
         SELECT term_shape FROM oe_vol_surface_snapshots v
         WHERE v.underlying = a.underlying
           AND v.computed_at::date <= a.entry_date::date
         ORDER BY v.computed_at DESC LIMIT 1
       ) r ON true
       WHERE a.account_id = $1 AND a.strategy_tag = $2 AND a.realized_pnl IS NOT NULL
       ORDER BY a.exit_date ASC`,
      [accountId, strategyTag]
    );

    return result.rows as TradeRow[];
  }

  private async persistRow(row: ContextPerformanceRow): Promise<void> {
    await db.query(
      `INSERT INTO oe_context_performance
        (id, account_id, strategy_tag, context_type, context_value,
         computed_at, sample_count, win_rate, avg_pnl, total_pnl,
         sharpe, avg_slippage, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        row.id, row.accountId, row.strategyTag, row.contextType, row.contextValue,
        row.computedAt, row.sampleCount, row.winRate, row.avgPnl, row.totalPnl,
        row.sharpe, row.avgSlippage, row.notes,
      ]
    );
  }

  private mapRow(row: Record<string, unknown>): ContextPerformanceRow {
    return {
      id: row.id as string,
      accountId: row.account_id as string,
      strategyTag: row.strategy_tag as string,
      contextType: row.context_type as ContextType,
      contextValue: row.context_value as string,
      computedAt: new Date(row.computed_at as string),
      sampleCount: parseInt(row.sample_count as string),
      winRate: parseFloat(row.win_rate as string),
      avgPnl: parseFloat(row.avg_pnl as string),
      totalPnl: parseFloat(row.total_pnl as string),
      sharpe: parseFloat(row.sharpe as string),
      avgSlippage: parseFloat(row.avg_slippage as string),
      notes: row.notes as string | null,
    };
  }
}

export const contextPerformanceService = new ContextPerformanceService();
