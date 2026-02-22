/**
 * PlanTriggerWorker - Monitors ARMED plans and creates signals when trigger conditions are met
 *
 * Full lifecycle: ARMED → TRIGGERED → signal created → Decision Engine → Order Creator
 */

import { logger } from '../utils/logger.js';
import { db } from '../services/database.service.js';
import { config } from '../config/index.js';
import { marketData } from '../services/market-data.js';
import { planToSignalBridge } from '../services/strat-plan/plan-to-signal-bridge.service.js';
import type { StratPlan } from '../services/strat-plan/types.js';
import * as Sentry from '@sentry/node';

export class PlanTriggerWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(private intervalMs: number = 30_000) {}

  start(): void {
    if (this.timer) return;

    if (!config.enableStratPlanLifecycle) {
      logger.info('PlanTriggerWorker skipped: Strat Plan Lifecycle disabled');
      return;
    }

    this.timer = setInterval(() => {
      this.run().catch((err) => {
        logger.error('PlanTriggerWorker error', err);
        Sentry.captureException(err, { tags: { worker: 'plan-trigger' } });
      });
    }, this.intervalMs);

    this.run().catch((err) => {
      logger.error('PlanTriggerWorker startup error', err);
      Sentry.captureException(err, { tags: { worker: 'plan-trigger' } });
    });
    logger.info('PlanTriggerWorker started', { intervalMs: this.intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('PlanTriggerWorker stopped');
    }
  }

  private evaluateTrigger(
    triggerCondition: string | null,
    reversalLevel: number | null,
    direction: string,
    currentPrice: number
  ): boolean {
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return false;

    const level =
      reversalLevel ??
      parseFloat(String(triggerCondition || '').replace(/[^0-9.-]/g, '').trim() || '');
    if (!Number.isFinite(level)) return false;

    const tc = (triggerCondition || '').toLowerCase();
    const isLong = (direction || '').toLowerCase() === 'long';
    if (tc.includes('>=') || (isLong && !tc.includes('<='))) {
      return currentPrice >= level;
    }
    if (tc.includes('<=') || (!isLong && !tc.includes('>='))) {
      return currentPrice <= level;
    }
    return false;
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
        `SELECT plan_id, symbol, direction, timeframe, entry_price, target_price, stop_price,
                reversal_level, trigger_condition, raw_payload, created_at, expires_at
         FROM strat_plans
         WHERE plan_status = 'armed'
           AND COALESCE(execution_mode, 'manual') = 'auto_on_trigger'
           AND (expires_at IS NULL OR expires_at > NOW())
         LIMIT 10`
      );

      if (result.rows.length === 0) return;

      const symbols = [...new Set(result.rows.map((r) => r.symbol))];
      const prices: Record<string, number> = {};
      for (const sym of symbols) {
        try {
          const p = await marketData.getStockPrice(sym);
          if (Number.isFinite(p) && p > 0) prices[sym] = p;
        } catch (err) {
          logger.warn('PlanTriggerWorker: price fetch failed', { symbol: sym, error: err });
        }
      }

      for (const row of result.rows) {
        const price = prices[row.symbol];
        if (!Number.isFinite(price)) continue;

        const met = this.evaluateTrigger(
          row.trigger_condition,
          row.reversal_level != null ? Number(row.reversal_level) : null,
          row.direction,
          price
        );
        if (!met) continue;

        const plan = this.rowToPlan(row);
        const bridgeResult = await planToSignalBridge.planToSignal(plan);
        if (bridgeResult.ok) {
          logger.info('PlanTriggerWorker: plan triggered', {
            plan_id: plan.plan_id,
            signal_id: bridgeResult.signalId,
            symbol: plan.symbol,
            price,
          });
          Sentry.addBreadcrumb({
            category: 'strat-plan',
            message: `Plan triggered: ${plan.symbol} ${plan.direction}`,
            level: 'info',
            data: { plan_id: plan.plan_id, signal_id: bridgeResult.signalId },
          });
        }
      }
    } catch (err) {
      logger.error('PlanTriggerWorker run failed', err);
      Sentry.captureException(err, { tags: { worker: 'plan-trigger' } });
    } finally {
      this.isRunning = false;
    }
  }
}
