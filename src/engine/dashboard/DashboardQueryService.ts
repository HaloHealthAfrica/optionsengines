import { db } from '../../services/database.service.js';
import type { PositionState } from '../types/enums.js';

export interface PositionSummary {
  positionId: string;
  underlying: string;
  structure: string;
  strategyTag: string;
  state: string;
  contracts: number;
  entryAvgPrice: number | null;
  unrealizedPnl: number;
  realizedPnl: number | null;
  openedAt: Date;
  closedAt: Date | null;
  daysOpen: number;
}

export interface PnlSummary {
  totalRealizedPnl: number;
  totalUnrealizedPnl: number;
  totalPnl: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  bestTrade: number;
  worstTrade: number;
}

export interface RiskSnapshot {
  netDeltaDollars: number;
  netGamma: number;
  totalMaxLoss: number;
  openPositionCount: number;
  underlyingExposure: Record<string, number>;
  bucketUsage: Record<string, number>;
}

export interface RegimeSummary {
  underlying: string;
  ivRegime: string;
  termShape: string;
  ivPercentile: number | null;
  confidence: number;
  computedAt: Date;
}

export interface DashboardOverview {
  account: {
    totalEquity: number;
    currentCash: number;
    reservedCapital: number;
    realizedPnl: number;
    unrealizedPnl: number;
    entryFrozen: boolean;
    drawdownPct: number;
  };
  positions: PositionSummary[];
  pnl: PnlSummary;
  risk: RiskSnapshot;
  regimes: RegimeSummary[];
  recentTraces: TraceSnapshot[];
}

export interface TraceSnapshot {
  decisionTraceId: string;
  signalId: string;
  isReplay: boolean;
  underlying: string | null;
  strategyTag: string | null;
  finalDecision: string | null;
  pnlOutcome: number | null;
  createdAt: Date;
}

export interface StrategyDashboard {
  strategyTag: string;
  weight: number;
  tradeCount: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
  edgeScore: number | null;
  cooldownRemaining: number;
  recentTrades: {
    positionId: string;
    underlying: string;
    realizedPnl: number;
    exitDate: Date;
  }[];
}

/**
 * Epic 10: Dashboard Query Service
 * Read-only query layer aggregating positions, P&L, risk, regime, and attribution
 * for dashboard consumption. All queries are account-scoped.
 */
export class DashboardQueryService {

  /**
   * Full dashboard overview for an account.
   */
  async getOverview(accountId: string): Promise<DashboardOverview> {
    const [account, positions, pnl, risk, regimes, traces] = await Promise.all([
      this.getAccountSummary(accountId),
      this.getOpenPositions(accountId),
      this.getPnlSummary(accountId),
      this.getRiskSnapshot(accountId),
      this.getActiveRegimes(accountId),
      this.getRecentTraces(accountId, 20),
    ]);

    return { account, positions, pnl, risk, regimes, recentTraces: traces };
  }

  /**
   * Account summary (cash, equity, drawdown).
   */
  async getAccountSummary(accountId: string): Promise<DashboardOverview['account']> {
    const result = await db.query(
      'SELECT * FROM oe_trading_accounts WHERE id = $1',
      [accountId]
    );

    if (result.rows.length === 0) {
      return {
        totalEquity: 0, currentCash: 0, reservedCapital: 0,
        realizedPnl: 0, unrealizedPnl: 0, entryFrozen: true, drawdownPct: 0,
      };
    }

    const r = result.rows[0];
    const totalEquity = parseFloat(r.total_equity);
    const peakEquity = parseFloat(r.peak_equity);
    const drawdownPct = peakEquity > 0 ? (peakEquity - totalEquity) / peakEquity : 0;

    return {
      totalEquity,
      currentCash: parseFloat(r.current_cash),
      reservedCapital: parseFloat(r.reserved_capital),
      realizedPnl: parseFloat(r.realized_pnl),
      unrealizedPnl: parseFloat(r.unrealized_pnl),
      entryFrozen: r.entry_frozen,
      drawdownPct,
    };
  }

  /**
   * All open positions for an account.
   */
  async getOpenPositions(accountId: string): Promise<PositionSummary[]> {
    const result = await db.query(
      `SELECT * FROM oe_positions
       WHERE account_id = $1 AND state IN ('OPEN','PENDING_ENTRY','PARTIALLY_FILLED','EXIT_PENDING')
       ORDER BY opened_at DESC`,
      [accountId]
    );

    return result.rows.map((r: Record<string, unknown>) => this.mapPosition(r));
  }

  /**
   * Positions filtered by state.
   */
  async getPositionsByState(accountId: string, state: PositionState): Promise<PositionSummary[]> {
    const result = await db.query(
      'SELECT * FROM oe_positions WHERE account_id = $1 AND state = $2 ORDER BY opened_at DESC',
      [accountId, state]
    );

    return result.rows.map((r: Record<string, unknown>) => this.mapPosition(r));
  }

  /**
   * Closed positions with date range filter.
   */
  async getClosedPositions(
    accountId: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 50
  ): Promise<PositionSummary[]> {
    const conditions = [`account_id = $1`, `state IN ('CLOSED','FORCE_CLOSED')`];
    const values: unknown[] = [accountId];
    let idx = 2;

    if (startDate) {
      conditions.push(`closed_at >= $${idx++}`);
      values.push(startDate);
    }
    if (endDate) {
      conditions.push(`closed_at <= $${idx++}`);
      values.push(endDate);
    }

    values.push(limit);

    const result = await db.query(
      `SELECT * FROM oe_positions WHERE ${conditions.join(' AND ')} ORDER BY closed_at DESC LIMIT $${idx}`,
      values
    );

    return result.rows.map((r: Record<string, unknown>) => this.mapPosition(r));
  }

  /**
   * P&L summary across all closed positions.
   */
  async getPnlSummary(accountId: string): Promise<PnlSummary> {
    const result = await db.query(
      `SELECT
         COALESCE(SUM(realized_pnl), 0) as total_realized,
         COUNT(*) FILTER (WHERE realized_pnl > 0) as win_count,
         COUNT(*) FILTER (WHERE realized_pnl < 0) as loss_count,
         COALESCE(AVG(realized_pnl) FILTER (WHERE realized_pnl > 0), 0) as avg_win,
         COALESCE(AVG(realized_pnl) FILTER (WHERE realized_pnl < 0), 0) as avg_loss,
         COALESCE(MAX(realized_pnl), 0) as best_trade,
         COALESCE(MIN(realized_pnl), 0) as worst_trade,
         COALESCE(SUM(realized_pnl) FILTER (WHERE realized_pnl > 0), 0) as gross_profit,
         COALESCE(ABS(SUM(realized_pnl) FILTER (WHERE realized_pnl < 0)), 0) as gross_loss
       FROM oe_positions
       WHERE account_id = $1 AND state IN ('CLOSED','FORCE_CLOSED') AND realized_pnl IS NOT NULL`,
      [accountId]
    );

    const r = result.rows[0];
    const totalRealized = parseFloat(r.total_realized);
    const winCount = parseInt(r.win_count);
    const lossCount = parseInt(r.loss_count);
    const totalTrades = winCount + lossCount;
    const grossProfit = parseFloat(r.gross_profit);
    const grossLoss = parseFloat(r.gross_loss);

    // Get unrealized P&L from open positions
    const unrealizedResult = await db.query(
      `SELECT COALESCE(SUM(unrealized_pnl), 0) as total_unrealized
       FROM oe_positions
       WHERE account_id = $1 AND state IN ('OPEN','PARTIALLY_FILLED','EXIT_PENDING')`,
      [accountId]
    );

    const totalUnrealized = parseFloat(unrealizedResult.rows[0].total_unrealized);

    return {
      totalRealizedPnl: totalRealized,
      totalUnrealizedPnl: totalUnrealized,
      totalPnl: totalRealized + totalUnrealized,
      winCount,
      lossCount,
      winRate: totalTrades > 0 ? winCount / totalTrades : 0,
      avgWin: parseFloat(r.avg_win),
      avgLoss: parseFloat(r.avg_loss),
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      bestTrade: parseFloat(r.best_trade),
      worstTrade: parseFloat(r.worst_trade),
    };
  }

  /**
   * Current risk snapshot from open positions.
   */
  async getRiskSnapshot(accountId: string): Promise<RiskSnapshot> {
    const result = await db.query(
      `SELECT p.underlying, p.strategy_tag,
              tp.contracts, tpl.delta, tpl.gamma,
              (tp.contracts * 100 * ABS(tpl.delta) * tpl.strike) as delta_exposure
       FROM oe_positions p
       JOIN oe_trade_plans tp ON p.trade_plan_id = tp.trade_plan_id
       LEFT JOIN oe_trade_plan_legs tpl ON tp.trade_plan_id = tpl.trade_plan_id
       WHERE p.account_id = $1 AND p.state IN ('OPEN','PARTIALLY_FILLED','EXIT_PENDING')`,
      [accountId]
    );

    let netDelta = 0;
    let netGamma = 0;
    let totalMaxLoss = 0;
    const underlyingExposure: Record<string, number> = {};
    const bucketUsage: Record<string, number> = {};
    const openPositionIds = new Set<string>();

    for (const r of result.rows) {
      const delta = parseFloat(r.delta ?? '0');
      const gamma = parseFloat(r.gamma ?? '0');
      const contracts = parseInt(r.contracts ?? '0');
      const exposure = parseFloat(r.delta_exposure ?? '0');
      const underlying = r.underlying as string;
      const strategyTag = r.strategy_tag as string;

      netDelta += delta * contracts * 100;
      netGamma += gamma * contracts * 100;

      underlyingExposure[underlying] = (underlyingExposure[underlying] ?? 0) + exposure;
      bucketUsage[strategyTag] = (bucketUsage[strategyTag] ?? 0) + exposure;

      openPositionIds.add(r.position_id);
    }

    return {
      netDeltaDollars: netDelta,
      netGamma,
      totalMaxLoss,
      openPositionCount: openPositionIds.size,
      underlyingExposure,
      bucketUsage,
    };
  }

  /**
   * Active regime snapshots (latest per underlying).
   */
  async getActiveRegimes(_accountId: string): Promise<RegimeSummary[]> {
    const result = await db.query(
      `SELECT DISTINCT ON (underlying) underlying, iv_regime, term_shape,
              iv_percentile, confidence, computed_at
       FROM oe_regime_snapshots
       ORDER BY underlying, computed_at DESC`
    );

    return result.rows.map((r: Record<string, unknown>) => ({
      underlying: r.underlying as string,
      ivRegime: r.iv_regime as string,
      termShape: r.term_shape as string,
      ivPercentile: r.iv_percentile !== null ? parseFloat(r.iv_percentile as string) : null,
      confidence: parseFloat(r.confidence as string),
      computedAt: new Date(r.computed_at as string),
    }));
  }

  /**
   * Recent decision traces.
   */
  async getRecentTraces(accountId: string, limit: number = 20): Promise<TraceSnapshot[]> {
    const result = await db.query(
      `SELECT decision_trace_id, signal_id, is_replay,
              trade_intent_snapshot, governor_result, pnl_outcome, created_at
       FROM oe_decision_traces
       WHERE account_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [accountId, limit]
    );

    return result.rows.map((r: Record<string, unknown>) => {
      const intent = r.trade_intent_snapshot as Record<string, unknown> | null;
      const governor = r.governor_result as Record<string, unknown> | null;

      return {
        decisionTraceId: r.decision_trace_id as string,
        signalId: r.signal_id as string,
        isReplay: r.is_replay as boolean,
        underlying: intent?.underlying as string | null ?? null,
        strategyTag: intent?.strategyTag as string | null ?? null,
        finalDecision: governor?.decision as string | null ?? null,
        pnlOutcome: r.pnl_outcome !== null ? parseFloat(r.pnl_outcome as string) : null,
        createdAt: new Date(r.created_at as string),
      };
    });
  }

  /**
   * Strategy-level dashboard with attribution data.
   */
  async getStrategyDashboard(accountId: string, strategyTag: string): Promise<StrategyDashboard> {
    // Get weight
    const weightResult = await db.query(
      'SELECT * FROM oe_strategy_weights WHERE account_id = $1 AND strategy_tag = $2',
      [accountId, strategyTag]
    );

    const weight = weightResult.rows.length > 0
      ? parseFloat(weightResult.rows[0].weight)
      : 1.0;
    const edgeScore = weightResult.rows.length > 0 && weightResult.rows[0].edge_score !== null
      ? parseFloat(weightResult.rows[0].edge_score)
      : null;
    const cooldown = weightResult.rows.length > 0
      ? parseInt(weightResult.rows[0].cooldown_remaining) || 0
      : 0;

    // Get attribution stats
    const statsResult = await db.query(
      `SELECT
         COUNT(*) as trade_count,
         COALESCE(AVG(realized_pnl), 0) as avg_pnl,
         COALESCE(SUM(realized_pnl), 0) as total_pnl,
         COUNT(*) FILTER (WHERE realized_pnl > 0) as wins
       FROM oe_attribution_rows
       WHERE account_id = $1 AND strategy_tag = $2 AND realized_pnl IS NOT NULL`,
      [accountId, strategyTag]
    );

    const s = statsResult.rows[0];
    const tradeCount = parseInt(s.trade_count);
    const wins = parseInt(s.wins);

    // Recent trades
    const recentResult = await db.query(
      `SELECT position_id, underlying, realized_pnl, exit_date
       FROM oe_attribution_rows
       WHERE account_id = $1 AND strategy_tag = $2 AND realized_pnl IS NOT NULL
       ORDER BY exit_date DESC LIMIT 10`,
      [accountId, strategyTag]
    );

    return {
      strategyTag,
      weight,
      tradeCount,
      winRate: tradeCount > 0 ? wins / tradeCount : 0,
      avgPnl: parseFloat(s.avg_pnl),
      totalPnl: parseFloat(s.total_pnl),
      edgeScore,
      cooldownRemaining: cooldown,
      recentTrades: recentResult.rows.map((r: Record<string, unknown>) => ({
        positionId: r.position_id as string,
        underlying: r.underlying as string,
        realizedPnl: parseFloat(r.realized_pnl as string),
        exitDate: new Date(r.exit_date as string),
      })),
    };
  }

  // ─── Helpers ───

  private mapPosition(r: Record<string, unknown>): PositionSummary {
    const openedAt = new Date(r.opened_at as string);
    const closedAt = r.closed_at ? new Date(r.closed_at as string) : null;
    const now = closedAt ?? new Date();
    const daysOpen = Math.round((now.getTime() - openedAt.getTime()) / (1000 * 60 * 60 * 24));

    return {
      positionId: r.position_id as string,
      underlying: r.underlying as string,
      structure: r.structure as string,
      strategyTag: r.strategy_tag as string,
      state: r.state as string,
      contracts: parseInt(r.target_qty as string),
      entryAvgPrice: r.entry_avg_price !== null ? parseFloat(r.entry_avg_price as string) : null,
      unrealizedPnl: parseFloat((r.unrealized_pnl as string) ?? '0'),
      realizedPnl: r.realized_pnl !== null ? parseFloat(r.realized_pnl as string) : null,
      openedAt,
      closedAt,
      daysOpen,
    };
  }
}

export const dashboardQueryService = new DashboardQueryService();
