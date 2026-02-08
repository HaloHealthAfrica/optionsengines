/**
 * Orchestrator Service - main coordinator for signal processing
 */

import { EngineCoordinator } from './engine-coordinator.js';
import { ExperimentManager } from './experiment-manager.js';
import { PolicyEngine } from './policy-engine.js';
import { SignalProcessor } from './signal-processor.js';
import {
  ExperimentResult,
  MarketContext,
  Signal,
  TradeOutcome,
  TradeRecommendation,
} from './types.js';
import { logger } from '../utils/logger.js';
import { OutcomeTracker } from './outcome-tracker.js';
import { ShadowExecutor } from '../services/shadow-executor.service.js';
import { EnrichedSignal, MetaDecision } from '../types/index.js';
import { db } from '../services/database.service.js';
import { config } from '../config/index.js';

export class OrchestratorService {
  constructor(
    private signalProcessor: SignalProcessor,
    private experimentManager: ExperimentManager,
    private policyEngine: PolicyEngine,
    private engineCoordinator: EngineCoordinator,
    private outcomeTracker?: OutcomeTracker,
    private shadowExecutor?: ShadowExecutor
  ) {}

  async processSignals(limit: number = 10, signalIds?: string[]): Promise<ExperimentResult[]> {
    const signals = await this.signalProcessor.getUnprocessedSignals(limit, signalIds);
    const results: ExperimentResult[] = [];

    for (const signal of signals) {
      const result = await this.processSignal(signal);
      results.push(result);
    }

    return results;
  }

  async processSignal(signal: Signal): Promise<ExperimentResult> {
    try {
      const market_context = await this.createMarketContext(signal);
      const experiment = await this.createExperiment(signal);
      const policy = await this.getExecutionPolicy(experiment.experiment_id);
      const { engineA, engineB } = await this.distributeSignal(signal, market_context);

      const engine_a_recommendation = this.applyPolicyToRecommendation(
        experiment.experiment_id,
        policy.execution_mode,
        'A',
        engineA
      );
      const engine_b_recommendation = this.applyPolicyToRecommendation(
        experiment.experiment_id,
        policy.execution_mode,
        'B',
        engineB
      );

      await this.updateSignalStatus(signal, policy, engine_a_recommendation, engine_b_recommendation);
      await this.createPaperOrders(signal, experiment.experiment_id, engine_a_recommendation, engine_b_recommendation);
      await this.handleShadowExecution(signal, engine_b_recommendation, experiment.experiment_id);

      await this.signalProcessor.markProcessed(signal.signal_id, experiment.experiment_id);

      return {
        experiment,
        policy,
        market_context,
        engine_a_recommendation: engine_a_recommendation ?? undefined,
        engine_b_recommendation: engine_b_recommendation ?? undefined,
        success: true,
      };
    } catch (error: any) {
      logger.error('Failed to process signal', error, {
        signal_id: signal.signal_id,
      });
      await this.signalProcessor.markFailed(signal.signal_id);
      return {
        experiment: {} as any,
        policy: {} as any,
        market_context: {} as any,
        success: false,
        error: error?.message ?? 'Unknown error',
      };
    }
  }

  async createMarketContext(signal: Signal): Promise<MarketContext> {
    return this.signalProcessor.createMarketContext(signal);
  }

  async createExperiment(signal: Signal) {
    return this.experimentManager.createExperiment(signal, 0.5, 'v1.0');
  }

  async getExecutionPolicy(experiment_id: string) {
    return this.policyEngine.getExecutionPolicy(experiment_id, 'v1.0');
  }

  async distributeSignal(signal: Signal, context: MarketContext) {
    return this.engineCoordinator.invokeBoth(signal, context);
  }

  async trackOutcome(outcome: TradeOutcome): Promise<void> {
    if (!this.outcomeTracker) {
      return;
    }
    await this.outcomeTracker.recordOutcome(outcome);
  }

  private async updateSignalStatus(
    signal: Signal,
    policy: { executed_engine: 'A' | 'B' | null },
    engineA?: TradeRecommendation | null,
    engineB?: TradeRecommendation | null
  ): Promise<void> {
    const executed = policy.executed_engine;
    const recommendation = executed === 'A' ? engineA : executed === 'B' ? engineB : null;
    const shouldTrade = Boolean(executed && recommendation && !recommendation.is_shadow);
    const status = shouldTrade ? 'approved' : 'rejected';
    await this.signalProcessor.updateStatus(signal.signal_id, status);
  }

  private async handleShadowExecution(
    signal: Signal,
    recommendation: TradeRecommendation | undefined,
    experimentId: string
  ): Promise<void> {
    if (config.enableDualPaperTrading) {
      return;
    }
    if (!this.shadowExecutor || !recommendation?.is_shadow) {
      return;
    }

    const enrichedSignal: EnrichedSignal = {
      signalId: signal.signal_id,
      symbol: signal.symbol,
      direction: signal.direction,
      timeframe: signal.timeframe,
      timestamp: signal.timestamp,
      sessionType: 'RTH',
    };

    const metaDecision: MetaDecision = {
      finalBias: signal.direction === 'long' ? 'bullish' : 'bearish',
      finalConfidence: 0.75,
      contributingAgents: ['orchestrator-shadow'],
      consensusStrength: 0.75,
      decision: 'approve',
      reasons: ['orchestrator shadow execution'],
    };

    await this.shadowExecutor.simulateExecution(metaDecision, enrichedSignal, experimentId);
  }

  private async createPaperOrders(
    signal: Signal,
    experimentId: string,
    engineA?: TradeRecommendation | null,
    engineB?: TradeRecommendation | null
  ): Promise<void> {
    if (config.appMode !== 'PAPER') {
      return;
    }

    const recommendations = [
      engineA ? { engine: 'A' as const, rec: engineA } : null,
      engineB ? { engine: 'B' as const, rec: engineB } : null,
    ].filter(Boolean) as Array<{ engine: 'A' | 'B'; rec: TradeRecommendation }>;

    for (const { engine, rec } of recommendations) {
      if (!config.enableDualPaperTrading && rec.is_shadow) {
        continue;
      }

      const optionType = rec.direction === 'long' ? 'call' : 'put';
      const optionSymbol = this.buildOptionSymbol(
        rec.symbol,
        rec.expiration,
        optionType,
        rec.strike
      );

      const existing = await db.query(
        `SELECT order_id FROM orders WHERE signal_id = $1 AND engine = $2 AND order_type = $3 LIMIT 1`,
        [signal.signal_id, engine, 'paper']
      );
      if (existing.rows.length > 0) {
        continue;
      }

      await db.query(
        `INSERT INTO orders (
          signal_id,
          symbol,
          option_symbol,
          strike,
          expiration,
          type,
          quantity,
          engine,
          experiment_id,
          order_type,
          status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          signal.signal_id,
          rec.symbol,
          optionSymbol,
          rec.strike,
          rec.expiration,
          optionType,
          rec.quantity,
          engine,
          experimentId,
          'paper',
          'pending_execution',
        ]
      );
    }
  }

  private buildOptionSymbol(
    symbol: string,
    expiration: Date,
    type: 'call' | 'put',
    strike: number
  ): string {
    const yyyy = expiration.getUTCFullYear().toString();
    const mm = String(expiration.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(expiration.getUTCDate()).padStart(2, '0');
    return `${symbol}-${yyyy}${mm}${dd}-${type.toUpperCase()}-${strike.toFixed(2)}`;
  }

  private applyPolicyToRecommendation(
    experiment_id: string,
    execution_mode: string,
    engine: 'A' | 'B',
    recommendation: TradeRecommendation | null
  ): TradeRecommendation | undefined {
    if (!recommendation) {
      return undefined;
    }

    let is_shadow = false;
    if (execution_mode === 'SHADOW_ONLY') {
      is_shadow = true;
    } else if (execution_mode === 'ENGINE_A_PRIMARY') {
      is_shadow = engine !== 'A';
    } else if (execution_mode === 'ENGINE_B_PRIMARY') {
      is_shadow = engine !== 'B';
    }

    return {
      ...recommendation,
      experiment_id,
      is_shadow,
    };
  }
}
