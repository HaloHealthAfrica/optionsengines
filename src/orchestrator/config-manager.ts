/**
 * Config Manager - execution policy configuration
 */

import { ExecutionMode } from './types.js';

export interface ExecutionPolicyConfig {
  execution_mode: ExecutionMode;
  split_percentage: number;
  policy_version: string;
}

export class ConfigManager {
  private config: ExecutionPolicyConfig;

  constructor(initial?: Partial<ExecutionPolicyConfig>) {
    this.config = this.loadFromEnv();
    if (initial) {
      this.applyConfig(initial);
    }
  }

  loadFromEnv(): ExecutionPolicyConfig {
    const execution_mode = (process.env.EXECUTION_MODE as ExecutionMode) || 'SHADOW_ONLY';
    const split_percentage = process.env.SPLIT_PERCENTAGE
      ? Number(process.env.SPLIT_PERCENTAGE)
      : 0.5;
    const policy_version = process.env.POLICY_VERSION || 'v1.0';

    const config = { execution_mode, split_percentage, policy_version };
    this.validate(config);
    return config;
  }

  getConfig(): ExecutionPolicyConfig {
    return { ...this.config };
  }

  applyConfig(update: Partial<ExecutionPolicyConfig>): ExecutionPolicyConfig {
    const next = { ...this.config, ...update };
    this.validate(next);
    this.config = next;
    return this.getConfig();
  }

  validate(config: ExecutionPolicyConfig): void {
    const modes: ExecutionMode[] = [
      'SHADOW_ONLY',
      'ENGINE_A_PRIMARY',
      'ENGINE_B_PRIMARY',
      'SPLIT_CAPITAL',
    ];

    if (!modes.includes(config.execution_mode)) {
      throw new Error(`Invalid execution mode: ${config.execution_mode}`);
    }

    if (Number.isNaN(config.split_percentage) || config.split_percentage < 0 || config.split_percentage > 1) {
      throw new Error('split_percentage must be between 0 and 1');
    }

    if (!config.policy_version || config.policy_version.trim().length === 0) {
      throw new Error('policy_version is required');
    }
  }
}
