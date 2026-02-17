/**
 * Strat Plan Lifecycle Manager
 * Manages plan capacity, prioritization, state transitions.
 * Gates execution through Engine A/B via signal creation.
 */

import { db } from '../database.service.js';
import { logger } from '../../utils/logger.js';
import { publishStratPlanUpdate } from '../realtime-updates.service.js';
import { watchlistManager } from './watchlist-manager.service.js';
import { getStratPlanConfig } from './strat-plan-config.service.js';
import type {
  StratPlan,
  StratPlanState,
  PlanSource,
  PlanPrioritizationInput,
} from './types.js';

const PRIORITY_WEIGHTS = {
  riskReward: 0.25,
  atrPercent: 0.15,
  expectedMoveAlignment: 0.15,
  gammaBias: 0.15,
  liquidityScore: 0.15,
  engineConfidence: 0.15,
  recencyBonus: 0.05,
};

export interface CreatePlanInput {
  symbol: string;
  direction: 'long' | 'short';
  timeframe: string;
  source: PlanSource;
  rawPayload?: Record<string, unknown>;
  /** Strat Command: entry/target/stop for trigger monitoring */
  entry?: number;
  target?: number;
  stop?: number;
  reversalLevel?: number;
  setup?: string;
  sourceAlertId?: string;
  executionMode?: 'manual' | 'auto_on_trigger';
  triggerCondition?: string;
  fromAlert?: boolean;
}

export interface CreatePlanResult {
  ok: boolean;
  plan?: StratPlan;
  reason?: string;
  state?: StratPlanState;
}

export interface PlanLifecycleStatus {
  totalPlans: number;
  byState: Record<string, number>;
  atCapacity: boolean;
  inForceCount: number;
  plansByTicker: Record<string, number>;
}

export class StratPlanLifecycleService {
  /**
   * Compute priority score from enrichment data
   */
  computePriorityScore(input: PlanPrioritizationInput): number {
    const {
      riskReward = 0,
      atrPercent = 0,
      expectedMoveAlignment = 0,
      gammaBias = 0,
      liquidityScore = 0,
      engineConfidence = 0,
      recencyBonus = 0,
    } = input;

    return (
      riskReward * PRIORITY_WEIGHTS.riskReward +
      atrPercent * PRIORITY_WEIGHTS.atrPercent +
      expectedMoveAlignment * PRIORITY_WEIGHTS.expectedMoveAlignment +
      gammaBias * PRIORITY_WEIGHTS.gammaBias +
      liquidityScore * PRIORITY_WEIGHTS.liquidityScore +
      engineConfidence * PRIORITY_WEIGHTS.engineConfidence +
      recencyBonus * PRIORITY_WEIGHTS.recencyBonus
    );
  }

  /**
   * Create plan. Checks watchlist and capacity.
   */
  async createPlan(input: CreatePlanInput): Promise<CreatePlanResult> {
    const symbol = input.symbol.toUpperCase().trim();
    const cfg = await getStratPlanConfig();

    // 1. Watchlist gate (auto-add when fromAlert if capacity allows)
    let inWatchlist = await watchlistManager.isInWatchlist(symbol);
    if (!inWatchlist && input.fromAlert) {
      const addResult = await watchlistManager.add(symbol, 'manual', 0);
      inWatchlist = addResult.ok;
    }
    if (!inWatchlist) {
      return {
        ok: false,
        reason: `Symbol ${symbol} not in watchlist. Add to watchlist first (max ${cfg.maxWatchlistTickers} tickers).`,
        state: 'BLOCKED',
      };
    }

    // 2. Count active plans
    const activeCount = await this.countActivePlans();
    const planCountForSymbol = await this.countPlansForSymbol(symbol);
    const inForceCount = await this.countInForce();

    if (activeCount >= cfg.maxConcurrentPlans) {
      return {
        ok: true,
        plan: await this.createPlanAsQueued(input),
        reason: `Plan capacity full (${cfg.maxConcurrentPlans}). Plan queued.`,
        state: 'QUEUED',
      };
    }

    if (planCountForSymbol >= cfg.maxPlansPerTicker) {
      return {
        ok: false,
        reason: `Max ${cfg.maxPlansPerTicker} plans per ticker. ${symbol} already has ${planCountForSymbol} active plans.`,
        state: 'BLOCKED',
      };
    }

    if (inForceCount >= cfg.maxInForceSimultaneous) {
      return {
        ok: true,
        plan: await this.createPlanAsPlanned(input),
        reason: `Max ${cfg.maxInForceSimultaneous} IN_FORCE. Plan created as PLANNED.`,
        state: 'PLANNED',
      };
    }

    return {
      ok: true,
      plan: await this.createPlanAsPlanned(input),
      state: 'PLANNED',
    };
  }

  private async createPlanAsPlanned(input: CreatePlanInput): Promise<StratPlan> {
    return this.insertPlan(input, 'PLANNED');
  }

  private async createPlanAsQueued(input: CreatePlanInput): Promise<StratPlan> {
    return this.insertPlan(input, 'QUEUED');
  }

  private async insertPlan(
    input: CreatePlanInput,
    state: StratPlanState
  ): Promise<StratPlan> {
    const symbol = input.symbol.toUpperCase().trim();
    const rawPayload = {
      ...(input.rawPayload ?? {}),
      ...(input.entry != null && { entry: input.entry }),
      ...(input.target != null && { target: input.target }),
      ...(input.stop != null && { stop: input.stop }),
    };
    const execMode = input.executionMode ?? 'manual';
    const planStatus = execMode === 'auto_on_trigger' ? 'armed' : 'armed';

    const result = await db.query(
      `INSERT INTO strat_plans (
         symbol, direction, timeframe, source, state, raw_payload,
         entry_price, target_price, stop_price, reversal_level, setup, source_alert_id,
         execution_mode, trigger_condition, plan_status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING plan_id, symbol, direction, timeframe, source, state, signal_id,
                 raw_payload, risk_reward, atr_percent, expected_move_alignment,
                 gamma_bias, liquidity_score, engine_confidence, priority_score,
                 in_force_at, expires_at, rejection_reason, created_at, updated_at`,
      [
        symbol,
        input.direction,
        input.timeframe,
        input.source,
        state,
        JSON.stringify(rawPayload),
        input.entry ?? null,
        input.target ?? null,
        input.stop ?? null,
        input.reversalLevel ?? null,
        input.setup ?? null,
        input.sourceAlertId ?? null,
        execMode,
        input.triggerCondition ?? null,
        planStatus,
      ]
    );

    return this.mapRowToPlan(result.rows[0]);
  }

  /**
   * Get plans eligible for TRIGGER (ranked by priority)
   */
  async getEligiblePlansForTrigger(limit: number = 5): Promise<StratPlan[]> {
    const cfg = await getStratPlanConfig();
    const inForceCount = await this.countInForce();
    const slots = Math.max(0, cfg.maxInForceSimultaneous - inForceCount);
    if (slots <= 0) return [];

    const result = await db.query(
      `SELECT plan_id, symbol, direction, timeframe, source, state, signal_id,
              raw_payload, risk_reward, atr_percent, expected_move_alignment,
              gamma_bias, liquidity_score, engine_confidence, priority_score,
              in_force_at, expires_at, rejection_reason, created_at, updated_at
       FROM strat_plans
       WHERE state IN ('PLANNED', 'QUEUED', 'IN_FORCE')
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY priority_score DESC NULLS LAST, created_at ASC
       LIMIT $1`,
      [Math.min(limit, slots)]
    );

    return result.rows.map((row) => this.mapRowToPlan(row));
  }

  /**
   * Update plan with enrichment data (priority scores)
   */
  async enrichPlan(
    planId: string,
    enrichment: PlanPrioritizationInput
  ): Promise<StratPlan | null> {
    const priorityScore = this.computePriorityScore(enrichment);
    const result = await db.query(
      `UPDATE strat_plans
       SET risk_reward = COALESCE($2, risk_reward),
           atr_percent = COALESCE($3, atr_percent),
           expected_move_alignment = COALESCE($4, expected_move_alignment),
           gamma_bias = COALESCE($5, gamma_bias),
           liquidity_score = COALESCE($6, liquidity_score),
           engine_confidence = COALESCE($7, engine_confidence),
           priority_score = $8,
           updated_at = NOW()
       WHERE plan_id = $1
       RETURNING plan_id, symbol, direction, timeframe, source, state, signal_id,
                 raw_payload, risk_reward, atr_percent, expected_move_alignment,
                 gamma_bias, liquidity_score, engine_confidence, priority_score,
                 in_force_at, expires_at, rejection_reason, created_at, updated_at`,
      [
        planId,
        enrichment.riskReward ?? null,
        enrichment.atrPercent ?? null,
        enrichment.expectedMoveAlignment ?? null,
        enrichment.gammaBias ?? null,
        enrichment.liquidityScore ?? null,
        enrichment.engineConfidence ?? null,
        priorityScore,
      ]
    );

    if (result.rows.length === 0) return null;
    return this.mapRowToPlan(result.rows[0]);
  }

  /**
   * Transition plan to TRIGGERED and link signal_id
   */
  async markTriggered(planId: string, signalId: string): Promise<boolean> {
    const result = await db.query(
      `UPDATE strat_plans
       SET state = 'TRIGGERED', signal_id = $2, updated_at = NOW(),
           plan_status = 'triggered', triggered_at = NOW()
       WHERE plan_id = $1
         AND (state IN ('PLANNED', 'QUEUED', 'IN_FORCE') OR plan_status = 'armed')
       RETURNING plan_id`,
      [planId, signalId]
    );

    if (result.rows.length > 0) {
      logger.info('Plan triggered', { plan_id: planId, signal_id: signalId });
      publishStratPlanUpdate({ event: 'triggered', plan_id: planId });
      return true;
    }
    return false;
  }

  /**
   * Transition plan to EXECUTED
   */
  async markExecuted(planId: string): Promise<boolean> {
    const result = await db.query(
      `UPDATE strat_plans SET state = 'EXECUTED', updated_at = NOW()
       WHERE plan_id = $1 RETURNING plan_id`,
      [planId]
    );
    return result.rows.length > 0;
  }

  /**
   * Transition plan to EXPIRED or REJECTED
   */
  async markExpired(planId: string, reason?: string): Promise<boolean> {
    const result = await db.query(
      `UPDATE strat_plans
       SET state = 'EXPIRED', rejection_reason = $2, updated_at = NOW()
       WHERE plan_id = $1 RETURNING plan_id`,
      [planId, reason ?? null]
    );
    return result.rows.length > 0;
  }

  async markRejected(planId: string, reason: string): Promise<boolean> {
    const result = await db.query(
      `UPDATE strat_plans
       SET state = 'REJECTED', rejection_reason = $2, updated_at = NOW(),
           plan_status = 'rejected'
       WHERE plan_id = $1 RETURNING plan_id`,
      [planId, reason]
    );
    return result.rows.length > 0;
  }

  /**
   * Mark plan as EXECUTING when order is created (by signal_id)
   */
  async markExecutingBySignal(signalId: string): Promise<boolean> {
    const result = await db.query(
      `UPDATE strat_plans
       SET plan_status = 'executing', updated_at = NOW()
       WHERE signal_id = $1 AND plan_status = 'triggered'
       RETURNING plan_id`,
      [signalId]
    );
    if (result.rows.length > 0) {
      publishStratPlanUpdate({ event: 'executing', plan_id: result.rows[0].plan_id });
      return true;
    }
    return false;
  }

  /**
   * Mark plan as FILLED when position is opened (by signal_id)
   */
  async markFilledBySignal(signalId: string, positionId: string): Promise<boolean> {
    const result = await db.query(
      `UPDATE strat_plans
       SET plan_status = 'filled', position_id = $2, filled_at = NOW(), updated_at = NOW()
       WHERE signal_id = $1 AND plan_status IN ('triggered', 'executing')
       RETURNING plan_id`,
      [signalId, positionId]
    );
    if (result.rows.length > 0) {
      logger.info('Strat plan filled', { signal_id: signalId, position_id: positionId });
      publishStratPlanUpdate({ event: 'filled', plan_id: result.rows[0].plan_id, position_id: positionId });
      return true;
    }
    return false;
  }

  /**
   * Cancel or remove plan. Draft/armed/triggered/executing → mark cancelled.
   * History plans (filled, expired, cancelled, rejected) → hard delete (remove from list).
   */
  async markCancelled(planId: string): Promise<boolean> {
    const existing = await db.query(
      `SELECT plan_id, plan_status FROM strat_plans WHERE plan_id = $1`,
      [planId]
    ).then((r) => r.rows[0]);
    if (!existing) return false;

    const status = (existing.plan_status ?? 'draft').toString();
    const terminalStates = ['filled', 'expired', 'cancelled', 'rejected'];

    if (terminalStates.includes(status)) {
      await db.query(`DELETE FROM strat_plans WHERE plan_id = $1`, [planId]);
      logger.info('Strat plan removed from history', { plan_id: planId });
      publishStratPlanUpdate({ event: 'removed', plan_id: planId });
      return true;
    }

    const result = await db.query(
      `UPDATE strat_plans
       SET plan_status = 'cancelled', state = 'EXPIRED', updated_at = NOW()
       WHERE plan_id = $1 AND plan_status IN ('draft', 'armed', 'triggered', 'executing')
       RETURNING plan_id`,
      [planId]
    );
    if (result.rows.length > 0) {
      logger.info('Strat plan cancelled', { plan_id: planId });
      publishStratPlanUpdate({ event: 'cancelled', plan_id: planId });
      return true;
    }
    return false;
  }

  /**
   * Record realized PnL when linked position is closed (by position_id)
   */
  async markClosedByPosition(
    positionId: string,
    realizedPnl: number,
    options?: { exitPrice?: number; holdDurationMinutes?: number }
  ): Promise<boolean> {
    const planRow = await db.query(
      `SELECT plan_id, entry_price, stop_price FROM strat_plans
       WHERE position_id = $1 AND plan_status = 'filled' LIMIT 1`,
      [positionId]
    ).then((r) => r.rows[0]);

    if (!planRow) return false;

    const entryPrice = planRow.entry_price != null ? Number(planRow.entry_price) : null;
    const stopPrice = planRow.stop_price != null ? Number(planRow.stop_price) : null;
    const riskDistance =
      entryPrice != null && stopPrice != null ? Math.abs(entryPrice - stopPrice) : null;
    const rMultipleAchieved =
      riskDistance != null && riskDistance > 0 ? realizedPnl / riskDistance : null;

    const result = await db.query(
      `UPDATE strat_plans
       SET realized_pnl = $2, closed_at = NOW(), updated_at = NOW(),
           exit_price = $3, r_multiple_achieved = $4, hold_duration_minutes = $5
       WHERE position_id = $1 AND plan_status = 'filled'
       RETURNING plan_id`,
      [
        positionId,
        realizedPnl,
        options?.exitPrice ?? null,
        rMultipleAchieved,
        options?.holdDurationMinutes ?? null,
      ]
    );
    if (result.rows.length > 0) {
      logger.info('Strat plan closed with PnL', {
        position_id: positionId,
        realized_pnl: realizedPnl,
        r_multiple: rMultipleAchieved,
      });
      publishStratPlanUpdate({
        event: 'closed',
        plan_id: result.rows[0].plan_id,
        position_id: positionId,
        realized_pnl: realizedPnl,
      });
      return true;
    }
    return false;
  }

  /**
   * Mark plan as REJECTED when signal is rejected (by signal_id)
   */
  async markRejectedBySignal(signalId: string, reason: string): Promise<boolean> {
    const result = await db.query(
      `UPDATE strat_plans
       SET plan_status = 'rejected', state = 'REJECTED', rejection_reason = $2, updated_at = NOW()
       WHERE signal_id = $1 AND plan_status IN ('triggered', 'executing')
       RETURNING plan_id`,
      [signalId, reason]
    );
    if (result.rows.length > 0) {
      publishStratPlanUpdate({ event: 'rejected', plan_id: result.rows[0].plan_id });
      return true;
    }
    return false;
  }

  /**
   * Promote QUEUED → PLANNED when slot available
   */
  async promoteQueuedToPlanned(): Promise<number> {
    const cfg = await getStratPlanConfig();
    const activeCount = await this.countActivePlans();
    const slots = Math.max(0, cfg.maxConcurrentPlans - activeCount);
    if (slots <= 0) return 0;

    const result = await db.query(
      `UPDATE strat_plans
       SET state = 'PLANNED', updated_at = NOW()
       WHERE plan_id IN (
         SELECT plan_id FROM strat_plans
         WHERE state = 'QUEUED'
         ORDER BY priority_score DESC NULLS LAST, created_at ASC
         LIMIT $1
       )
       RETURNING plan_id`,
      [slots]
    );

    const count = result.rows.length;
    if (count > 0) {
      logger.info('Promoted queued plans to planned', { count });
    }
    return count;
  }

  async getPlanById(planId: string): Promise<StratPlan | null> {
    const result = await db.query(
      `SELECT plan_id, symbol, direction, timeframe, source, state, signal_id,
              raw_payload, risk_reward, atr_percent, expected_move_alignment,
              gamma_bias, liquidity_score, engine_confidence, priority_score,
              in_force_at, expires_at, rejection_reason, created_at, updated_at
       FROM strat_plans WHERE plan_id = $1`,
      [planId]
    );
    if (result.rows.length === 0) return null;
    return this.mapRowToPlan(result.rows[0]);
  }

  async getPlansBySymbol(symbol: string): Promise<StratPlan[]> {
    const normalized = symbol.toUpperCase().trim();
    const result = await db.query(
      `SELECT plan_id, symbol, direction, timeframe, source, state, signal_id,
              raw_payload, risk_reward, atr_percent, expected_move_alignment,
              gamma_bias, liquidity_score, engine_confidence, priority_score,
              in_force_at, expires_at, rejection_reason, created_at, updated_at
       FROM strat_plans
       WHERE symbol = $1 AND state NOT IN ('EXECUTED', 'EXPIRED', 'REJECTED')
       ORDER BY priority_score DESC NULLS LAST, created_at ASC`,
      [normalized]
    );
    return result.rows.map((row) => this.mapRowToPlan(row));
  }

  async getLifecycleStatus(): Promise<PlanLifecycleStatus> {
    const cfg = await getStratPlanConfig();
    const countResult = await db.query(
      `SELECT state, COUNT(*)::int AS cnt FROM strat_plans
       WHERE state NOT IN ('EXECUTED', 'EXPIRED', 'REJECTED')
       GROUP BY state`
    );

    const byState: Record<string, number> = {};
    let totalPlans = 0;
    for (const row of countResult.rows) {
      byState[row.state] = row.cnt;
      totalPlans += row.cnt;
    }

    const inForceResult = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM strat_plans WHERE state = 'IN_FORCE'`
    );
    const inForceCount = inForceResult.rows[0]?.cnt ?? 0;

    const tickerResult = await db.query(
      `SELECT symbol, COUNT(*)::int AS cnt FROM strat_plans
       WHERE state NOT IN ('EXECUTED', 'EXPIRED', 'REJECTED')
       GROUP BY symbol`
    );
    const plansByTicker: Record<string, number> = {};
    for (const row of tickerResult.rows) {
      plansByTicker[row.symbol] = row.cnt;
    }

    return {
      totalPlans,
      byState,
      atCapacity: totalPlans >= cfg.maxConcurrentPlans,
      inForceCount,
      plansByTicker,
    };
  }

  private async countActivePlans(): Promise<number> {
    const result = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM strat_plans
       WHERE state IN ('PLANNED', 'QUEUED', 'IN_FORCE', 'TRIGGERED')`
    );
    return result.rows[0]?.cnt ?? 0;
  }

  private async countPlansForSymbol(symbol: string): Promise<number> {
    const normalized = symbol.toUpperCase().trim();
    const result = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM strat_plans
       WHERE symbol = $1 AND state IN ('PLANNED', 'QUEUED', 'IN_FORCE', 'TRIGGERED')`,
      [normalized]
    );
    return result.rows[0]?.cnt ?? 0;
  }

  private async countInForce(): Promise<number> {
    const result = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM strat_plans WHERE state = 'IN_FORCE'`
    );
    return result.rows[0]?.cnt ?? 0;
  }

  private mapRowToPlan(row: Record<string, unknown>): StratPlan {
    return {
      plan_id: row.plan_id as string,
      symbol: row.symbol as string,
      direction: row.direction as 'long' | 'short',
      timeframe: row.timeframe as string,
      source: row.source as PlanSource,
      state: row.state as StratPlanState,
      signal_id: row.signal_id as string | null,
      raw_payload: row.raw_payload as Record<string, unknown> | null,
      risk_reward: row.risk_reward != null ? Number(row.risk_reward) : null,
      atr_percent: row.atr_percent != null ? Number(row.atr_percent) : null,
      expected_move_alignment: row.expected_move_alignment != null ? Number(row.expected_move_alignment) : null,
      gamma_bias: row.gamma_bias != null ? Number(row.gamma_bias) : null,
      liquidity_score: row.liquidity_score != null ? Number(row.liquidity_score) : null,
      engine_confidence: row.engine_confidence != null ? Number(row.engine_confidence) : null,
      priority_score: row.priority_score != null ? Number(row.priority_score) : null,
      in_force_at: row.in_force_at ? new Date(row.in_force_at as string) : null,
      expires_at: row.expires_at ? new Date(row.expires_at as string) : null,
      rejection_reason: row.rejection_reason as string | null,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
    };
  }
}

export const stratPlanLifecycleService = new StratPlanLifecycleService();
