import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/node';
import { logger } from '../../utils/logger.js';
import { db } from '../../services/database.service.js';
import { getEngineConfig } from '../config/loader.js';
import { RejectionCode, PositionState } from '../types/enums.js';
import type { TradingAccount } from '../types/index.js';

export enum SafetyEventType {
  LOSING_STREAK_PAUSE = 'LOSING_STREAK_PAUSE',
  IV_SPIKE_RESIZE = 'IV_SPIKE_RESIZE',
  DRAWDOWN_TAPER = 'DRAWDOWN_TAPER',
  DRAWDOWN_FREEZE = 'DRAWDOWN_FREEZE',
  MANUAL_PAUSE = 'MANUAL_PAUSE',
}

export interface SafetyCheckResult {
  allowed: boolean;
  rejectionCode: RejectionCode | null;
  reason: string | null;
  sizeMultiplier: number;
  activeEvents: SafetyEvent[];
}

export interface SafetyEvent {
  id: string;
  accountId: string;
  eventType: SafetyEventType;
  triggerValue: string;
  actionTaken: string;
  sizeMultiplier: number | null;
  startedAt: Date;
  expiresAt: Date | null;
  resolvedAt: Date | null;
}

export class PsychologicalSafetySystem {

  /**
   * Full safety gate check — evaluates losing streaks, IV spikes, and active events.
   */
  async check(
    accountId: string,
    _account: TradingAccount,
    currentIVPercentile: number | null,
    previousIVPercentile: number | null
  ): Promise<SafetyCheckResult> {
    const cfg = getEngineConfig().pause;
    let sizeMultiplier = 1.0;
    const activeEvents = await this.getActiveEvents(accountId);

    // 1. Check active unresolved pause events
    for (const event of activeEvents) {
      if (event.eventType === SafetyEventType.LOSING_STREAK_PAUSE) {
        if (event.expiresAt && new Date() < event.expiresAt) {
          return {
            allowed: false,
            rejectionCode: RejectionCode.PSYCHOLOGICAL_PAUSE,
            reason: `Losing streak pause active until ${event.expiresAt.toISOString()}`,
            sizeMultiplier: 0,
            activeEvents,
          };
        }
        // Expired — auto-resolve
        await this.resolveEvent(event.id);
      }

      if (event.eventType === SafetyEventType.IV_SPIKE_RESIZE && event.sizeMultiplier !== null) {
        sizeMultiplier = Math.min(sizeMultiplier, event.sizeMultiplier);
      }

      if (event.eventType === SafetyEventType.DRAWDOWN_FREEZE) {
        return {
          allowed: false,
          rejectionCode: RejectionCode.PSYCHOLOGICAL_PAUSE,
          reason: 'Drawdown freeze active — entries blocked',
          sizeMultiplier: 0,
          activeEvents,
        };
      }
    }

    // 2. Check for new losing streak
    const streakCheck = await this.checkLosingStreak(accountId, cfg.losingStreakCount);
    if (streakCheck.triggered) {
      Sentry.addBreadcrumb({
        category: 'engine',
        message: `Losing streak detected: ${streakCheck.consecutiveLosses} consecutive losses`,
        level: 'warning',
        data: { accountId, consecutiveLosses: streakCheck.consecutiveLosses, pauseDurationMinutes: cfg.pauseDurationMinutes },
      });
      const event = await this.createEvent({
        accountId,
        eventType: SafetyEventType.LOSING_STREAK_PAUSE,
        triggerValue: `${streakCheck.consecutiveLosses} consecutive losses`,
        actionTaken: `Pause entries for ${cfg.pauseDurationMinutes} minutes`,
        sizeMultiplier: null,
        durationMinutes: cfg.pauseDurationMinutes,
      });

      return {
        allowed: false,
        rejectionCode: RejectionCode.PSYCHOLOGICAL_PAUSE,
        reason: `Losing streak: ${streakCheck.consecutiveLosses} consecutive losses — paused ${cfg.pauseDurationMinutes}min`,
        sizeMultiplier: 0,
        activeEvents: [...activeEvents, event],
      };
    }

    // 3. Check for IV spike
    if (currentIVPercentile !== null && previousIVPercentile !== null) {
      const ivChange = currentIVPercentile - previousIVPercentile;
      if (ivChange > cfg.ivSpikeThresholdPct) {
        Sentry.addBreadcrumb({
          category: 'engine',
          message: `IV spike detected: percentile change ${(ivChange * 100).toFixed(1)}%`,
          level: 'warning',
          data: { accountId, currentIVPercentile, previousIVPercentile, ivChange, sizeReduction: cfg.ivSpikeSizeReduction },
        });
        const existingIVEvent = activeEvents.find(e => e.eventType === SafetyEventType.IV_SPIKE_RESIZE);
        if (!existingIVEvent) {
          const event = await this.createEvent({
            accountId,
            eventType: SafetyEventType.IV_SPIKE_RESIZE,
            triggerValue: `IV percentile spiked ${(ivChange * 100).toFixed(1)}%`,
            actionTaken: `Size reduced by ${((1 - cfg.ivSpikeSizeReduction) * 100).toFixed(0)}%`,
            sizeMultiplier: cfg.ivSpikeSizeReduction,
            durationMinutes: null,
          });
          sizeMultiplier = Math.min(sizeMultiplier, cfg.ivSpikeSizeReduction);
          activeEvents.push(event);
        }
      }
    }

    return {
      allowed: true,
      rejectionCode: null,
      reason: null,
      sizeMultiplier,
      activeEvents,
    };
  }

  // ─── Losing Streak Detection ───

  private async checkLosingStreak(
    accountId: string,
    threshold: number
  ): Promise<{ triggered: boolean; consecutiveLosses: number }> {
    // Check if there's already an active pause for this account
    const activePause = await db.query(
      `SELECT id FROM oe_safety_events
       WHERE account_id = $1 AND event_type = $2 AND resolved_at IS NULL`,
      [accountId, SafetyEventType.LOSING_STREAK_PAUSE]
    );
    if (activePause.rows.length > 0) {
      return { triggered: false, consecutiveLosses: 0 };
    }

    // Get last N closed positions, ordered most recent first
    const result = await db.query(
      `SELECT realized_pnl FROM oe_positions
       WHERE account_id = $1 AND state IN ($2, $3) AND realized_pnl IS NOT NULL
       ORDER BY closed_at DESC LIMIT $4`,
      [accountId, PositionState.CLOSED, PositionState.FORCE_CLOSED, threshold]
    );

    if (result.rows.length < threshold) {
      return { triggered: false, consecutiveLosses: result.rows.length };
    }

    let consecutiveLosses = 0;
    for (const row of result.rows) {
      const pnl = parseFloat(row.realized_pnl);
      if (pnl < 0) {
        consecutiveLosses++;
      } else {
        break;
      }
    }

    return {
      triggered: consecutiveLosses >= threshold,
      consecutiveLosses,
    };
  }

  // ─── Event Management ───

  async getActiveEvents(accountId: string): Promise<SafetyEvent[]> {
    const result = await db.query(
      `SELECT * FROM oe_safety_events
       WHERE account_id = $1 AND resolved_at IS NULL
       ORDER BY started_at DESC`,
      [accountId]
    );

    return result.rows.map(this.mapRow);
  }

  async resolveEvent(eventId: string): Promise<void> {
    await db.query(
      'UPDATE oe_safety_events SET resolved_at = NOW() WHERE id = $1',
      [eventId]
    );
    logger.info('Safety event resolved', { eventId });
  }

  async resolveAllForAccount(accountId: string): Promise<number> {
    const result = await db.query(
      `UPDATE oe_safety_events SET resolved_at = NOW()
       WHERE account_id = $1 AND resolved_at IS NULL
       RETURNING id`,
      [accountId]
    );
    const count = result.rows.length;
    if (count > 0) {
      logger.info('All safety events resolved', { accountId, count });
    }
    return count;
  }

  private async createEvent(params: {
    accountId: string;
    eventType: SafetyEventType;
    triggerValue: string;
    actionTaken: string;
    sizeMultiplier: number | null;
    durationMinutes: number | null;
  }): Promise<SafetyEvent> {
    const id = randomUUID();
    const now = new Date();
    const expiresAt = params.durationMinutes
      ? new Date(now.getTime() + params.durationMinutes * 60 * 1000)
      : null;

    await db.query(
      `INSERT INTO oe_safety_events (id, account_id, event_type, trigger_value, action_taken, size_multiplier, started_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, params.accountId, params.eventType, params.triggerValue, params.actionTaken, params.sizeMultiplier, now, expiresAt]
    );

    logger.warn('Safety event created', {
      id, accountId: params.accountId, eventType: params.eventType,
      triggerValue: params.triggerValue, actionTaken: params.actionTaken,
    });

    return {
      id,
      accountId: params.accountId,
      eventType: params.eventType,
      triggerValue: params.triggerValue,
      actionTaken: params.actionTaken,
      sizeMultiplier: params.sizeMultiplier,
      startedAt: now,
      expiresAt,
      resolvedAt: null,
    };
  }

  private mapRow(row: Record<string, unknown>): SafetyEvent {
    return {
      id: row.id as string,
      accountId: row.account_id as string,
      eventType: row.event_type as SafetyEventType,
      triggerValue: row.trigger_value as string,
      actionTaken: row.action_taken as string,
      sizeMultiplier: row.size_multiplier !== null ? parseFloat(row.size_multiplier as string) : null,
      startedAt: new Date(row.started_at as string),
      expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
    };
  }
}

export const psychologicalSafetySystem = new PsychologicalSafetySystem();
