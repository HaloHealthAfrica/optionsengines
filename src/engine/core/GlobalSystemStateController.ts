import { db } from '../../services/database.service.js';
import { logger } from '../../utils/logger.js';
import * as Sentry from '@sentry/node';
import {
  SystemState,
  SystemStateTransitionTrigger,
} from '../types/enums.js';
import { SystemNotActiveError } from '../types/errors.js';
import type { SystemStateLogEntry } from '../types/index.js';

const VALID_TRANSITIONS: Record<SystemState, SystemState[]> = {
  [SystemState.ACTIVE]: [SystemState.PAUSED, SystemState.EMERGENCY_STOP],
  [SystemState.PAUSED]: [SystemState.ACTIVE, SystemState.EMERGENCY_STOP],
  [SystemState.EMERGENCY_STOP]: [SystemState.ACTIVE],
};

export class GlobalSystemStateController {
  private cachedState: SystemState | null = null;
  private cachedAt: number = 0;
  private readonly cacheTTLMs = 1000;

  /**
   * Gate check — call before any trade entry.
   * Throws SystemNotActiveError if state != ACTIVE.
   */
  async check(): Promise<SystemState> {
    const state = await this.getCurrentState();
    if (state !== SystemState.ACTIVE) {
      throw new SystemNotActiveError(state);
    }
    return state;
  }

  /**
   * Returns true only if state is ACTIVE. Non-throwing.
   */
  async isActive(): Promise<boolean> {
    const state = await this.getCurrentState();
    return state === SystemState.ACTIVE;
  }

  async getCurrentState(): Promise<SystemState> {
    const now = Date.now();
    if (this.cachedState && now - this.cachedAt < this.cacheTTLMs) {
      return this.cachedState;
    }

    try {
      const result = await db.query<{ state: string }>(
        'SELECT state FROM oe_system_state LIMIT 1'
      );

      if (result.rows.length === 0) {
        logger.error('No system state record found — defaulting to EMERGENCY_STOP');
        this.cachedState = SystemState.EMERGENCY_STOP;
        this.cachedAt = now;
        return SystemState.EMERGENCY_STOP;
      }

      const state = result.rows[0].state as SystemState;
      this.cachedState = state;
      this.cachedAt = now;
      return state;
    } catch (error) {
      logger.error('Failed to read system state — defaulting to EMERGENCY_STOP (fail-closed)', error as Error);
      Sentry.captureException(error, { tags: { service: 'GlobalSystemStateController' } });
      return SystemState.EMERGENCY_STOP;
    }
  }

  async transition(
    toState: SystemState,
    trigger: SystemStateTransitionTrigger,
    triggeredBy: string,
    reason: string,
    metadata: Record<string, unknown> = {}
  ): Promise<SystemState> {
    const fromState = await this.getCurrentState();

    if (fromState === toState) {
      logger.info('System state transition no-op (already in target state)', { fromState, toState });
      return fromState;
    }

    const allowed = VALID_TRANSITIONS[fromState];
    if (!allowed.includes(toState)) {
      const msg = `Illegal system state transition: ${fromState} → ${toState}`;
      logger.error(msg, undefined, { trigger, triggeredBy, reason });
      throw new Error(msg);
    }

    if (toState === SystemState.ACTIVE && fromState === SystemState.EMERGENCY_STOP) {
      if (trigger !== SystemStateTransitionTrigger.MANUAL) {
        const msg = 'EMERGENCY_STOP can only be resolved manually';
        logger.error(msg, undefined, { trigger, triggeredBy });
        throw new Error(msg);
      }
    }

    try {
      await db.transaction(async (client) => {
        await client.query(
          'UPDATE oe_system_state SET state = $1, updated_at = NOW(), updated_by = $2',
          [toState, triggeredBy]
        );

        await client.query(
          `INSERT INTO oe_system_state_log
            (from_state, to_state, trigger, triggered_by, reason, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [fromState, toState, trigger, triggeredBy, reason, JSON.stringify(metadata)]
        );
      });

      this.cachedState = toState;
      this.cachedAt = Date.now();

      logger.info('System state transitioned', {
        fromState,
        toState,
        trigger,
        triggeredBy,
        reason,
      });

      return toState;
    } catch (error) {
      logger.error('Failed to transition system state', error as Error, {
        fromState,
        toState,
        trigger,
      });
      Sentry.captureException(error, {
        tags: { service: 'GlobalSystemStateController' },
        extra: { fromState, toState, trigger, reason },
      });
      throw error;
    }
  }

  async pause(
    trigger: SystemStateTransitionTrigger,
    triggeredBy: string,
    reason: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    await this.transition(SystemState.PAUSED, trigger, triggeredBy, reason, metadata);
  }

  async emergencyStop(
    trigger: SystemStateTransitionTrigger,
    triggeredBy: string,
    reason: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    await this.transition(SystemState.EMERGENCY_STOP, trigger, triggeredBy, reason, metadata);
  }

  async resume(triggeredBy: string, reason: string): Promise<void> {
    await this.transition(
      SystemState.ACTIVE,
      SystemStateTransitionTrigger.MANUAL,
      triggeredBy,
      reason
    );
  }

  async getTransitionHistory(limit: number = 50): Promise<SystemStateLogEntry[]> {
    const result = await db.query<SystemStateLogEntry>(
      `SELECT id, from_state, to_state, trigger, triggered_by, reason, metadata, timestamp
       FROM oe_system_state_log
       ORDER BY timestamp DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  invalidateCache(): void {
    this.cachedState = null;
    this.cachedAt = 0;
  }
}

export const globalSystemState = new GlobalSystemStateController();
