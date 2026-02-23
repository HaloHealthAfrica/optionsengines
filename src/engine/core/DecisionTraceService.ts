import { randomUUID } from 'crypto';
import { db } from '../../services/database.service.js';
import { logger } from '../../utils/logger.js';
import * as Sentry from '@sentry/node';
import { LatencyMode, SystemState } from '../types/enums.js';
import type { DecisionTrace, LatencyBudgetResult } from '../types/index.js';
import { getEngineConfig } from '../config/loader.js';

export class DecisionTraceService {
  /**
   * Create a new trace at signal receipt. Returns the trace with id assigned.
   */
  async create(params: {
    accountId: string;
    signalId: string;
    isReplay: boolean;
    systemState: SystemState;
  }): Promise<DecisionTrace> {
    const traceId = randomUUID();
    const latencyMode = LatencyMode.COLD; // will be updated if cache hit

    const result = await db.query(
      `INSERT INTO oe_decision_traces
        (decision_trace_id, account_id, signal_id, is_replay, latency_mode, system_state_at_decision)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [traceId, params.accountId, params.signalId, params.isReplay, latencyMode, params.systemState]
    );

    logger.debug('Decision trace created', { traceId, signalId: params.signalId });
    return this.mapRow(result.rows[0]);
  }

  /**
   * Append a stage result to the trace. Each stage writes its structured output
   * before passing control downstream. If a stage rejects, it writes rejection
   * then returns — no downstream stages are called.
   */
  async appendStage(
    traceId: string,
    stage: DecisionTraceStage,
    data: Record<string, unknown>
  ): Promise<void> {
    const column = STAGE_TO_COLUMN[stage];
    if (!column) {
      logger.error('Unknown decision trace stage', undefined, { traceId, stage });
      return;
    }

    try {
      await db.query(
        `UPDATE oe_decision_traces
         SET ${column} = $1
         WHERE decision_trace_id = $2`,
        [JSON.stringify(data), traceId]
      );
    } catch (error) {
      logger.error('Failed to append decision trace stage', error as Error, { traceId, stage });
      Sentry.captureException(error, {
        tags: { service: 'DecisionTraceService' },
        extra: { traceId, stage },
      });
    }
  }

  /**
   * Update latency mode (CACHED vs COLD) once determined.
   */
  async setLatencyMode(traceId: string, mode: LatencyMode): Promise<void> {
    await db.query(
      'UPDATE oe_decision_traces SET latency_mode = $1 WHERE decision_trace_id = $2',
      [mode, traceId]
    );
  }

  /**
   * Finalize the trace: set latency budget result, close timestamp if applicable.
   */
  async finalize(
    traceId: string,
    latencyResult: LatencyBudgetResult,
    pnlOutcome?: number
  ): Promise<void> {
    await db.query(
      `UPDATE oe_decision_traces
       SET latency_budget_result = $1,
           pnl_outcome = $2,
           closed_at = CASE WHEN $2 IS NOT NULL THEN NOW() ELSE closed_at END
       WHERE decision_trace_id = $3`,
      [JSON.stringify(latencyResult), pnlOutcome ?? null, traceId]
    );
  }

  /**
   * Close the trace with PnL outcome (called when position closes).
   */
  async close(traceId: string, pnlOutcome: number): Promise<void> {
    await db.query(
      `UPDATE oe_decision_traces
       SET pnl_outcome = $1, closed_at = NOW()
       WHERE decision_trace_id = $2`,
      [pnlOutcome, traceId]
    );
  }

  /**
   * Fetch a trace by ID.
   */
  async get(traceId: string): Promise<DecisionTrace | null> {
    const result = await db.query(
      'SELECT * FROM oe_decision_traces WHERE decision_trace_id = $1',
      [traceId]
    );
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * Query traces for an account within a date range.
   */
  async query(params: {
    accountId?: string;
    signalId?: string;
    isReplay?: boolean;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<DecisionTrace[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (params.accountId) {
      conditions.push(`account_id = $${idx++}`);
      values.push(params.accountId);
    }
    if (params.signalId) {
      conditions.push(`signal_id = $${idx++}`);
      values.push(params.signalId);
    }
    if (params.isReplay !== undefined) {
      conditions.push(`is_replay = $${idx++}`);
      values.push(params.isReplay);
    }
    if (params.startDate) {
      conditions.push(`created_at >= $${idx++}`);
      values.push(params.startDate);
    }
    if (params.endDate) {
      conditions.push(`created_at <= $${idx++}`);
      values.push(params.endDate);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = params.limit ?? 100;

    const result = await db.query(
      `SELECT * FROM oe_decision_traces ${where} ORDER BY created_at DESC LIMIT $${idx}`,
      [...values, limit]
    );

    return result.rows.map(this.mapRow);
  }

  private mapRow(row: any): DecisionTrace {
    return {
      decisionTraceId: row.decision_trace_id,
      accountId: row.account_id,
      signalId: row.signal_id,
      isReplay: row.is_replay,
      latencyMode: row.latency_mode as LatencyMode,
      systemStateAtDecision: row.system_state_at_decision as SystemState,
      tradeIntentSnapshot: row.trade_intent_snapshot,
      sanityValidationResult: row.sanity_validation_result,
      constructionResult: row.construction_result,
      candidatesScoredTop5: row.candidates_scored_top5,
      governorResult: row.governor_result,
      capitalValidation: row.capital_validation,
      bucketValidation: row.bucket_validation,
      policyGateResult: row.policy_gate_result,
      latencyBudgetResult: row.latency_budget_result,
      positionStateTransition: row.position_state_transition,
      finalOrders: row.final_orders,
      fills: row.fills,
      slippageAuditIds: row.slippage_audit_ids ?? [],
      pnlOutcome: row.pnl_outcome ? parseFloat(row.pnl_outcome) : null,
      regimeAtDecision: row.regime_at_decision,
      underlyingLiquidityRatio: row.underlying_liquidity_ratio
        ? parseFloat(row.underlying_liquidity_ratio)
        : null,
      createdAt: row.created_at,
      closedAt: row.closed_at,
    };
  }
}

export type DecisionTraceStage =
  | 'tradeIntent'
  | 'sanityValidation'
  | 'construction'
  | 'candidatesTop5'
  | 'governor'
  | 'capitalValidation'
  | 'bucketValidation'
  | 'policyGate'
  | 'latencyBudget'
  | 'positionState'
  | 'finalOrders'
  | 'fills'
  | 'regime';

const STAGE_TO_COLUMN: Record<DecisionTraceStage, string> = {
  tradeIntent: 'trade_intent_snapshot',
  sanityValidation: 'sanity_validation_result',
  construction: 'construction_result',
  candidatesTop5: 'candidates_scored_top5',
  governor: 'governor_result',
  capitalValidation: 'capital_validation',
  bucketValidation: 'bucket_validation',
  policyGate: 'policy_gate_result',
  latencyBudget: 'latency_budget_result',
  positionState: 'position_state_transition',
  finalOrders: 'final_orders',
  fills: 'fills',
  regime: 'regime_at_decision',
};

export const decisionTraceService = new DecisionTraceService();
