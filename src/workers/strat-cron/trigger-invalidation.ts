/**
 * Trigger & Invalidation Checking - Within Tier 1 price check
 * Checks: trigger (price hit entry), invalidation (price hit stop), integrity breach
 */

import { db } from '../../services/database.service.js';
import { planToSignalBridge } from '../../services/strat-plan/plan-to-signal-bridge.service.js';
import {
  publishStratAlertTriggered,
  publishStratAlertInvalidated,
  publishStratAlertIntegrityBroken,
} from '../../services/realtime-updates.service.js';
import { logger } from '../../utils/logger.js';
import type { StratAlertRow } from './types.js';
import type { StratPlan } from '../../services/strat-plan/types.js';

function rowToPlan(row: Record<string, unknown>): StratPlan {
  return {
    plan_id: row.plan_id as string,
    symbol: row.symbol as string,
    direction: row.direction as 'long' | 'short',
    timeframe: (row.timeframe as string) || '1d',
    source: 'manual',
    state: 'IN_FORCE',
    signal_id: null,
    raw_payload: {
      ...((row.raw_payload as Record<string, unknown>) ?? {}),
      entry: row.entry_price ?? (row.raw_payload as Record<string, unknown>)?.entry,
      target: row.target_price ?? (row.raw_payload as Record<string, unknown>)?.target,
      stop: row.stop_price ?? (row.raw_payload as Record<string, unknown>)?.stop,
    } as Record<string, unknown>,
    risk_reward: null,
    atr_percent: null,
    expected_move_alignment: null,
    gamma_bias: null,
    liquidity_score: null,
    engine_confidence: null,
    priority_score: null,
    in_force_at: null,
    expires_at: row.expires_at ? new Date(row.expires_at as string) : null,
    rejection_reason: null,
    created_at: new Date(row.created_at as string),
    updated_at: new Date(),
  };
}

export interface TriggerInvalidationResult {
  triggered: number;
  invalidated: number;
  integrityBroken: number;
}

export async function checkTriggerAndInvalidation(
  alert: StratAlertRow,
  currentPrice: number
): Promise<TriggerInvalidationResult> {
  const result: TriggerInvalidationResult = { triggered: 0, invalidated: 0, integrityBroken: 0 };

  if (['triggered', 'completed', 'closed', 'archived'].includes(alert.status)) {
    return result;
  }

  const entryPrice = Number(alert.entry);
  const stopPrice = Number(alert.stop);
  const isLong = (alert.direction || '').toLowerCase() === 'long';

  // CHECK TRIGGER
  const triggered = isLong ? currentPrice >= entryPrice : currentPrice <= entryPrice;
  if (triggered) {
    const currentScore = alert.current_score ?? alert.score;
    const scoreTrend = alert.score_trend ?? 'stable';
    await db.query(
      `UPDATE strat_alerts SET
        status = 'triggered',
        triggered_at = NOW(),
        trigger_score = $1,
        trigger_trend = $2
      WHERE alert_id = $3`,
      [currentScore, scoreTrend, alert.alert_id]
    );

    const history = alert.score_history ?? [];
    publishStratAlertTriggered({
      alertId: alert.alert_id,
      symbol: alert.symbol,
      direction: alert.direction,
      setup: alert.setup,
      scoreAtTrigger: currentScore,
      trendAtTrigger: scoreTrend,
      scoreHistory: history,
    });

    const linkedPlans = await db.query(
      `SELECT plan_id, symbol, direction, timeframe, entry_price, target_price, stop_price,
              reversal_level, trigger_condition, raw_payload, created_at, expires_at
       FROM strat_plans
       WHERE source_alert_id = $1 AND plan_status = 'armed'
         AND COALESCE(execution_mode, 'manual') = 'auto_on_trigger'
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [alert.alert_id]
    );

    for (const row of linkedPlans.rows) {
      const plan = rowToPlan(row);
      const bridgeResult = await planToSignalBridge.planToSignal(plan);
      if (bridgeResult.ok) {
        logger.info('Strat cron: linked plan triggered', {
          alert_id: alert.alert_id,
          plan_id: plan.plan_id,
          signal_id: bridgeResult.signalId,
        });
      }
    }
    result.triggered = 1;
    return result;
  }

  // CHECK INVALIDATION
  const invalidated = isLong ? currentPrice <= stopPrice : currentPrice >= stopPrice;
  if (invalidated) {
    await db.query(
      `UPDATE strat_alerts SET status = 'invalidated', outcome = 'invalidated' WHERE alert_id = $1`,
      [alert.alert_id]
    );
    // Auto-cancel linked plans when source alert is invalidated
    await db.query(
      `UPDATE strat_plans SET plan_status = 'cancelled', rejection_reason = 'Source alert invalidated (stop hit)'
       WHERE source_alert_id = $1 AND plan_status IN ('armed', 'draft')`,
      [alert.alert_id]
    );
    publishStratAlertInvalidated({
      alertId: alert.alert_id,
      symbol: alert.symbol,
      reason: 'Price hit stop level before trigger',
    });
    result.invalidated = 1;
    return result;
  }

  // CHECK PATTERN INTEGRITY (C1 inside bar broken)
  if (alert.c1_type === '1' && alert.c2_high != null && alert.c2_low != null) {
    const c2High = Number(alert.c2_high);
    const c2Low = Number(alert.c2_low);
    if (currentPrice > c2High || currentPrice < c2Low) {
      await db.query(
        `UPDATE strat_alerts SET integrity_broken = TRUE, integrity_broken_at = NOW() WHERE alert_id = $1`,
        [alert.alert_id]
      );
      publishStratAlertIntegrityBroken({
        alertId: alert.alert_id,
        symbol: alert.symbol,
        reason: 'C1 inside bar breached C2 range',
      });
      result.integrityBroken = 1;
    }
  }

  return result;
}
