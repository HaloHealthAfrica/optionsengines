/**
 * PlanTriggerWorker - Monitors ARMED plans and creates signals when trigger conditions are met
 *
 * Full lifecycle: ARMED → TRIGGERED → signal created → Decision Engine → Order Creator
 *
 * TODO Phase 3: Implement full trigger evaluation
 * - Poll ARMED plans from strat_plans
 * - Fetch live price via market data provider
 * - Evaluate trigger_condition (e.g. "price >= reversal_level")
 * - On trigger: create signal, mark plan TRIGGERED, send to orchestrator
 */

import { logger } from '../utils/logger.js';
import { db } from '../services/database.service.js';
import { config } from '../config/index.js';

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
      this.run().catch((err) => logger.error('PlanTriggerWorker error', err));
    }, this.intervalMs);

    this.run().catch((err) => logger.error('PlanTriggerWorker startup error', err));
    logger.info('PlanTriggerWorker started', { intervalMs: this.intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('PlanTriggerWorker stopped');
    }
  }

  async run(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      // TODO: Query strat_plans WHERE plan_status = 'armed'
      // TODO: For each plan, fetch current price
      // TODO: Evaluate trigger_condition
      // TODO: If met: create signal, update plan to triggered
      const result = await db.query(
        `SELECT plan_id, symbol, entry_price, target_price, stop_price, reversal_level, trigger_condition
         FROM strat_plans
         WHERE plan_status = 'armed'
           AND (expires_at IS NULL OR expires_at > NOW())
         LIMIT 10`
      );

      if (result.rows.length > 0) {
        logger.debug('PlanTriggerWorker: armed plans to monitor', {
          count: result.rows.length,
          plan_ids: result.rows.map((r) => r.plan_id),
        });
        // TODO: Implement trigger evaluation + signal creation
      }
    } finally {
      this.isRunning = false;
    }
  }
}
