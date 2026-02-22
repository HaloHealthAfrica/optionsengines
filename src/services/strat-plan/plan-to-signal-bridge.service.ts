/**
 * Plan-to-Signal Bridge
 * Converts eligible Strat Plans into signals for Orchestrator processing.
 * Gates execution: only plans that pass watchlist + capacity flow to Engine A/B.
 */

import crypto from 'crypto';
import { db } from '../database.service.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import { stratPlanLifecycleService } from './strat-plan-lifecycle.service.js';
import type { StratPlan } from './types.js';
import * as Sentry from '@sentry/node';

function generateSignalHash(
  symbol: string,
  direction: string,
  timeframe: string,
  timestamp: Date
): string {
  const hashInput = `${symbol}:${direction}:${timeframe}:${timestamp.toISOString()}`;
  return crypto.createHash('sha256').update(hashInput).digest('hex');
}

export interface BridgeResult {
  ok: boolean;
  signalId?: string;
  planId?: string;
  reason?: string;
}

export class PlanToSignalBridge {
  /**
   * Convert an eligible plan to a signal and persist.
   * Caller (orchestrator worker) will then process the signal.
   */
  async planToSignal(plan: StratPlan): Promise<BridgeResult> {
    if (!config.enableStratPlanLifecycle) {
      return { ok: false, reason: 'Strat plan lifecycle disabled' };
    }

    const timestamp = plan.created_at;
    const signalHash = generateSignalHash(
      plan.symbol,
      plan.direction,
      plan.timeframe,
      timestamp
    );

    const payload = plan.raw_payload ?? {};
    const entry = typeof payload.entry === 'number' ? payload.entry : parseFloat(String(payload.entry || ''));
    const target = typeof payload.target === 'number' ? payload.target : parseFloat(String(payload.target || ''));
    const stop = typeof payload.stop === 'number' ? payload.stop : parseFloat(String(payload.stop || ''));
    const rawPayload = {
      ...payload,
      strat_plan_id: plan.plan_id,
      source: 'strat_plan',
      ...(Number.isFinite(entry) && { entry_price: entry }),
      ...(Number.isFinite(target) && { target }),
      ...(Number.isFinite(stop) && { stop_loss: stop }),
    };

    try {
      const result = await db.query(
        `INSERT INTO signals (
          symbol, direction, timeframe, timestamp, status, raw_payload, signal_hash
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING signal_id`,
        [
          plan.symbol,
          plan.direction,
          plan.timeframe,
          timestamp,
          'pending',
          JSON.stringify(rawPayload),
          signalHash,
        ]
      );

      const signalId = result.rows[0].signal_id;

      await stratPlanLifecycleService.markTriggered(plan.plan_id, signalId);

      logger.info('Plan bridged to signal', {
        plan_id: plan.plan_id,
        signal_id: signalId,
        symbol: plan.symbol,
        direction: plan.direction,
      });

      return { ok: true, signalId, planId: plan.plan_id };
    } catch (err) {
      logger.error('Plan-to-signal bridge failed', {
        plan_id: plan.plan_id,
        error: err,
      });
      Sentry.captureException(err, {
        tags: { service: 'plan-to-signal-bridge' },
        extra: { plan_id: plan.plan_id, symbol: plan.symbol },
      });
      return { ok: false, reason: 'Database error' };
    }
  }

  /**
   * Get plans eligible for trigger and create signals for them.
   * Returns signal IDs for orchestrator to process.
   */
  async bridgeEligiblePlans(limit: number = 3): Promise<string[]> {
    const plans = await stratPlanLifecycleService.getEligiblePlansForTrigger(limit);
    const signalIds: string[] = [];

    for (const plan of plans) {
      const result = await this.planToSignal(plan);
      if (result.ok && result.signalId) {
        signalIds.push(result.signalId);
      }
    }

    return signalIds;
  }
}

export const planToSignalBridge = new PlanToSignalBridge();
