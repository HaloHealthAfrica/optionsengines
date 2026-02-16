/**
 * Alert Trigger Monitor - Monitors PENDING strat alerts against live prices
 * When trigger condition is met: update to triggered, emit WebSocket, trigger linked plans.
 * When stop is hit: update to invalidated.
 * When expired: update to expired.
 */

import { logger } from '../utils/logger.js';
import { db } from '../services/database.service.js';
import { config } from '../config/index.js';
import { marketData } from '../services/market-data.js';
import { planToSignalBridge } from '../services/strat-plan/plan-to-signal-bridge.service.js';
import {
  publishStratAlertTriggered,
  publishStratAlertInvalidated,
} from '../services/realtime-updates.service.js';
import type { StratPlan } from '../services/strat-plan/types.js';

export class AlertTriggerMonitorWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(private intervalMs: number = 60_000) {}

  start(): void {
    if (this.timer) return;

    if (!config.enableStratPlanLifecycle) {
      logger.info('AlertTriggerMonitorWorker skipped: Strat Plan Lifecycle disabled');
      return;
    }

    this.timer = setInterval(() => {
      this.run().catch((err) => logger.error('AlertTriggerMonitorWorker error', err));
    }, this.intervalMs);

    this.run().catch((err) => logger.error('AlertTriggerMonitorWorker startup error', err));
    logger.info('AlertTriggerMonitorWorker started', { intervalMs: this.intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('AlertTriggerMonitorWorker stopped');
    }
  }

  private rowToPlan(row: Record<string, unknown>): StratPlan {
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

  async run(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const result = await db.query(
        `SELECT alert_id, symbol, direction, timeframe, setup, entry, target, stop,
                reversal_level, score, c1_type, c2_type, c1_shape, atr, rvol,
                flow_sentiment, unusual_activity, status, source, options_suggestion,
                condition_text, created_at, triggered_at, expires_at
         FROM strat_alerts
         WHERE status IN ('pending', 'watching')
         LIMIT 50`
      );

      const alerts = result.rows;
      if (alerts.length === 0) return;

      const symbols = [...new Set(alerts.map((r) => r.symbol))];
      const prices: Record<string, number> = {};
      for (const sym of symbols) {
        try {
          const p = await marketData.getStockPrice(sym);
          if (Number.isFinite(p) && p > 0) prices[sym] = p;
        } catch (err) {
          logger.warn('AlertTriggerMonitor: price fetch failed', { symbol: sym, error: err });
        }
      }

      for (const alert of alerts) {
        const price = prices[alert.symbol];
        if (!Number.isFinite(price)) continue;

        const entry = Number(alert.entry);
        const stop = Number(alert.stop);
        const isLong = (alert.direction || '').toLowerCase() === 'long';

        if (alert.expires_at && new Date() > new Date(alert.expires_at)) {
          await db.query(
            `UPDATE strat_alerts SET status = 'expired' WHERE alert_id = $1`,
            [alert.alert_id]
          );
          continue;
        }

        const triggered =
          isLong ? price >= entry : price <= entry;
        const invalidated =
          isLong ? price < stop : price > stop;

        if (triggered) {
          await db.query(
            `UPDATE strat_alerts SET status = 'triggered', triggered_at = NOW() WHERE alert_id = $1`,
            [alert.alert_id]
          );

          const alertPayload = {
            id: alert.alert_id,
            symbol: alert.symbol,
            direction: alert.direction,
            timeframe: alert.timeframe,
            setup: alert.setup,
            entry: Number(alert.entry),
            target: Number(alert.target),
            stop: Number(alert.stop),
            status: 'triggered',
            triggeredAt: new Date().toISOString(),
          };
          publishStratAlertTriggered(alertPayload);

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
            const plan = this.rowToPlan(row);
            const bridgeResult = await planToSignalBridge.planToSignal(plan);
            if (bridgeResult.ok) {
              logger.info('AlertTriggerMonitor: linked plan triggered', {
                alert_id: alert.alert_id,
                plan_id: plan.plan_id,
                signal_id: bridgeResult.signalId,
              });
            }
          }
        } else if (invalidated) {
          await db.query(
            `UPDATE strat_alerts SET status = 'invalidated' WHERE alert_id = $1`,
            [alert.alert_id]
          );

          const alertPayload = {
            id: alert.alert_id,
            symbol: alert.symbol,
            direction: alert.direction,
            status: 'invalidated',
          };
          publishStratAlertInvalidated(alertPayload);
        }
      }
    } finally {
      this.isRunning = false;
    }
  }
}
