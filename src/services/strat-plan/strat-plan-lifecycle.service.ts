/**
 * Strat Plan Lifecycle Manager
 * Manages plan capacity, prioritization, state transitions.
 * Gates execution through Engine A/B via signal creation.
 */

import { db } from '../database.service.js';
import { logger } from '../../utils/logger.js';
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

    // 1. Watchlist gate
    const inWatchlist = await watchlistManager.isInWatchlist(symbol);
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
    const result = await db.query(
      `INSERT INTO strat_plans (symbol, direction, timeframe, source, state, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6)
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
        input.rawPayload ? JSON.stringify(input.rawPayload) : null,
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
       SET state = 'TRIGGERED', signal_id = $2, updated_at = NOW()
       WHERE plan_id = $1 AND state IN ('PLANNED', 'QUEUED', 'IN_FORCE')
       RETURNING plan_id`,
      [planId, signalId]
    );

    if (result.rows.length > 0) {
      logger.info('Plan triggered', { plan_id: planId, signal_id: signalId });
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
       SET state = 'REJECTED', rejection_reason = $2, updated_at = NOW()
       WHERE plan_id = $1 RETURNING plan_id`,
      [planId, reason]
    );
    return result.rows.length > 0;
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
