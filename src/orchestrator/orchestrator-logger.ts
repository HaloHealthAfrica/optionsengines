/**
 * Orchestrator Logger - structured logging helpers
 */

import { logger } from '../utils/logger.js';

export class OrchestratorLogger {
  logSignalRetrieval(data: {
    signal_id: string;
    symbol: string;
    direction: string;
    timestamp: Date;
  }): void {
    logger.info('Signal retrieved', {
      signal_id: data.signal_id,
      symbol: data.symbol,
      direction: data.direction,
      timestamp: data.timestamp.toISOString(),
    });
  }

  logExperimentCreation(data: {
    experiment_id: string;
    signal_id: string;
    variant: string;
    assignment_hash: string;
  }): void {
    logger.info('Experiment created', {
      experiment_id: data.experiment_id,
      signal_id: data.signal_id,
      variant: data.variant,
      assignment_hash: data.assignment_hash,
    });
  }

  logPolicyApplication(data: {
    experiment_id: string;
    execution_mode: string;
    executed_engine: string | null;
    policy_version: string;
  }): void {
    logger.info('Policy applied', {
      experiment_id: data.experiment_id,
      execution_mode: data.execution_mode,
      executed_engine: data.executed_engine,
      policy_version: data.policy_version,
    });
  }

  logShadowTradeCreation(data: {
    experiment_id: string;
    engine: string;
    shadow_trade_id: string;
  }): void {
    logger.info('Shadow trade created', {
      experiment_id: data.experiment_id,
      engine: data.engine,
      shadow_trade_id: data.shadow_trade_id,
    });
  }

  logError(data: {
    signal_id?: string;
    experiment_id?: string;
    error_type: string;
    error_message: string;
    stack_trace?: string;
  }): void {
    logger.error('Orchestrator error', undefined, {
      signal_id: data.signal_id,
      experiment_id: data.experiment_id,
      error_type: data.error_type,
      error_message: data.error_message,
      stack_trace: data.stack_trace,
      timestamp: new Date().toISOString(),
    });
  }
}

export const orchestratorLogger = new OrchestratorLogger();
