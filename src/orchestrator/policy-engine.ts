/**
 * Policy Engine - Execution policy decisions and persistence
 */

import pg from 'pg';
import { ExecutionMode, ExecutionPolicy } from './types.js';
import { ExecutionPolicySchema } from './schemas.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export type EngineAvailability = {
  engineA: boolean;
  engineB: boolean;
};

type AvailabilityProvider = () => Promise<EngineAvailability>;

export class PolicyEngine {
  private pool: pg.Pool;
  private availabilityProvider: AvailabilityProvider;

  constructor(pool: pg.Pool, availabilityProvider?: AvailabilityProvider) {
    this.pool = pool;
    this.availabilityProvider =
      availabilityProvider ??
      (async () => ({
        engineA: true,
        engineB: true,
      }));
  }

  /**
   * v1.0 policy logic:
   * - PAPER + Engine A available => ENGINE_A_PRIMARY
   * - Otherwise => SHADOW_ONLY
   */
  async getExecutionPolicy(
    experiment_id: string,
    policy_version: string = 'v1.0'
  ): Promise<ExecutionPolicy> {
    const availability = await this.checkEngineAvailability();

    let execution_mode: ExecutionMode = 'SHADOW_ONLY';
    let executed_engine: 'A' | 'B' | null = null;
    let shadow_engine: 'A' | 'B' | null = null;
    let reason = 'Engine A unavailable or non-paper mode';

    if (config.appMode === 'PAPER' && availability.engineA) {
      execution_mode = 'ENGINE_A_PRIMARY';
      executed_engine = 'A';
      shadow_engine = availability.engineB ? 'B' : null;
      reason = 'Paper mode with Engine A available';
    }

    this.validatePolicy(execution_mode, executed_engine, shadow_engine);

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO execution_policies
         (experiment_id, execution_mode, executed_engine, shadow_engine, reason, policy_version)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING policy_id, experiment_id, execution_mode, executed_engine, shadow_engine, reason, policy_version, created_at`,
        [experiment_id, execution_mode, executed_engine, shadow_engine, reason, policy_version]
      );

      const policy = ExecutionPolicySchema.parse(result.rows[0]);

      logger.info('Execution policy recorded', {
        experiment_id: policy.experiment_id,
        execution_mode: policy.execution_mode,
        executed_engine: policy.executed_engine,
        policy_version: policy.policy_version,
      });

      return policy;
    } finally {
      client.release();
    }
  }

  validatePolicy(
    execution_mode: ExecutionMode,
    executed_engine: 'A' | 'B' | null,
    shadow_engine: 'A' | 'B' | null
  ): void {
    const validModes: ExecutionMode[] = [
      'SHADOW_ONLY',
      'ENGINE_A_PRIMARY',
      'ENGINE_B_PRIMARY',
      'SPLIT_CAPITAL',
    ];

    if (!validModes.includes(execution_mode)) {
      throw new Error(`Invalid execution mode: ${execution_mode}`);
    }

    if (execution_mode === 'SHADOW_ONLY') {
      if (executed_engine !== null) {
        throw new Error('SHADOW_ONLY cannot execute real trades');
      }
    }

    if (executed_engine && shadow_engine && executed_engine === shadow_engine) {
      throw new Error('Executed engine and shadow engine must differ');
    }
  }

  async checkEngineAvailability(): Promise<EngineAvailability> {
    return this.availabilityProvider();
  }
}
