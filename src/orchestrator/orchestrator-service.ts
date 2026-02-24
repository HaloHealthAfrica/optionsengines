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
import { buildSignalEnrichment } from '../services/signal-enrichment.service.js';
import { gammaDealerStrategy } from '../strategies/GammaDealerStrategy.js';
import {
  dealerPositioningStrategy,
  type DealerPositioningDecision,
} from '../strategies/DealerPositioningStrategy.js';
import type { GammaStrategyDecision, MarketDataLike } from '../strategies/types.js';
import { alertService } from '../services/alert.service.js';
import {
  shouldBlockSameStrike,
  extractWebhookSource,
} from '../services/same-strike-cooldown.service.js';
import { buildOptionSymbol } from '../lib/shared/option-utils.js';
import * as Sentry from '@sentry/node';
import { getTradingMode } from '../config/trading-mode.js';
import { runUDC } from '../lib/udc/index.js';
import type { UDCSignal, PortfolioState } from '../lib/udc/types.js';
import { marketSnapshotService, StaleSnapshotError } from '../services/market-snapshot.service.js';

export class OrchestratorService {
  constructor(
    private signalProcessor: SignalProcessor,
    private experimentManager: ExperimentManager,
    private policyEngine: PolicyEngine,
    private engineCoordinator: EngineCoordinator,
    private outcomeTracker?: OutcomeTracker,
    private shadowExecutor?: ShadowExecutor
  ) {}

  async processSignals(
    limit: number = 10,
    signalIds?: string[],
    options?: {
      concurrency?: number;
      timeoutMs?: number;
      retryDelayMs?: number;
    }
  ): Promise<ExperimentResult[]> {
    const signals = await this.signalProcessor.getUnprocessedSignals(limit, signalIds);
    const results: ExperimentResult[] = [];
    const queue = [...signals];
    const concurrency = Math.max(1, options?.concurrency ?? 1);
    const timeoutMs = Math.max(1000, options?.timeoutMs ?? 30000);
    const retryDelayMs = Math.max(1000, options?.retryDelayMs ?? 60000);

    const workers = Array.from({ length: Math.min(concurrency, queue.length) }).map(async () => {
      while (queue.length > 0) {
        const signal = queue.shift();
        if (!signal) {
          break;
        }
        const result = await this.processSignalWithTimeout(signal, timeoutMs, retryDelayMs);
        results.push(result);
      }
    });

    await Promise.all(workers);

    return results;
  }

  private async processSignalWithTimeout(
    signal: Signal,
    timeoutMs: number,
    retryDelayMs: number
  ): Promise<ExperimentResult> {
    const startedAt = Date.now();
    const timeoutPromise = new Promise<ExperimentResult>((resolve) => {
      setTimeout(() => {
        resolve({
          experiment: {} as any,
          policy: {} as any,
          market_context: {} as any,
          success: false,
          error: 'processing_timeout',
        });
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([this.processSignal(signal), timeoutPromise]);
      const durationMs = Date.now() - startedAt;

      if (result.error === 'processing_timeout') {
        return this.handleProcessingFailure(signal, 'processing_timeout', retryDelayMs, durationMs);
      }

      return { ...result, duration_ms: durationMs };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      logger.error('Signal processing failed (caught)', error, { signal_id: signal.signal_id });
      return this.handleProcessingFailure(signal, 'processing_failed', retryDelayMs, durationMs);
    }
  }

  /** Non-transient failures that will not succeed on retry */
  private static NON_TRANSIENT_FAILURES = new Set([
    'signal_stale',
    'market_closed',
    'max_open_positions_exceeded',
    'max_positions_per_symbol_exceeded',
    'daily_loss_cap_exceeded',
    'confluence_below_threshold',
  ]);

  private async handleProcessingFailure(
    signal: Signal,
    reason: string,
    retryDelayMs: number,
    durationMs: number
  ): Promise<ExperimentResult> {
    const attempts = Number(signal.processing_attempts ?? 0);
    const isTransient = !OrchestratorService.NON_TRANSIENT_FAILURES.has(reason);

    if (attempts < 2 && isTransient) {
      const nextRetryAt = new Date(Date.now() + retryDelayMs);
      await this.signalProcessor.scheduleRetry(
        signal.signal_id,
        attempts + 1,
        nextRetryAt,
        reason
      );
      logger.info('Transient failure — retry scheduled', {
        signal_id: signal.signal_id,
        reason,
        next_retry_at: nextRetryAt.toISOString(),
      });
      return {
        experiment: {} as any,
        policy: {} as any,
        market_context: {} as any,
        success: false,
        error: `retry_scheduled:${reason}`,
        duration_ms: durationMs,
      };
    }

    if (!isTransient) {
      logger.info('Non-transient failure — rejecting immediately without retry', {
        signal_id: signal.signal_id,
        reason,
      });
    }

    await this.signalProcessor.updateStatus(signal.signal_id, 'rejected', reason);
    await this.signalProcessor.markFailed(signal.signal_id);

    return {
      experiment: {} as any,
      policy: {} as any,
      market_context: {} as any,
      success: false,
      error: reason,
      duration_ms: durationMs,
    };
  }

  async processSignal(signal: Signal): Promise<ExperimentResult> {
    const startedAt = Date.now();
    // Extract trace_id from payload for distributed tracing (Gap 16 fix)
    const traceId = (signal.raw_payload as Record<string, unknown>)?.trace_id as string | undefined;
    if (traceId) {
      Sentry.setTag('trace_id', traceId);
    }
    return await Sentry.startSpan(
      {
        name: 'orchestrator.processSignal',
        op: 'orchestrator',
        attributes: {
          signalId: signal.signal_id,
          symbol: signal.symbol,
          ...(traceId ? { traceId } : {}),
        },
      },
      async () => {
        try {
          Sentry.addBreadcrumb({
            category: 'signal',
            message: 'Signal received',
            level: 'info',
            data: { signal_id: signal.signal_id, symbol: signal.symbol },
          });
          const enrichment = await buildSignalEnrichment(signal);

          // Persist enrichment for audit and replay (Gap 8 fix, Phase 2b: unique index now exists)
          try {
            await db.query(
              `INSERT INTO refactored_signals (signal_id, enriched_data, risk_check_result, rejection_reason, processed_at)
               VALUES ($1, $2, $3, $4, NOW())
               ON CONFLICT (signal_id) DO UPDATE SET
                 enriched_data = EXCLUDED.enriched_data,
                 risk_check_result = EXCLUDED.risk_check_result,
                 rejection_reason = EXCLUDED.rejection_reason,
                 processed_at = NOW()`,
              [
                signal.signal_id,
                JSON.stringify(enrichment.enrichedData ?? {}),
                JSON.stringify(enrichment.riskResult ?? {}),
                enrichment.rejectionReason,
              ]
            );
          } catch (persistErr) {
            // Fallback: try plain INSERT if ON CONFLICT fails (e.g. old schema without unique index)
            try {
              await db.query(
                `INSERT INTO refactored_signals (signal_id, enriched_data, risk_check_result, rejection_reason, processed_at)
                 VALUES ($1, $2, $3, $4, NOW())`,
                [
                  signal.signal_id,
                  JSON.stringify(enrichment.enrichedData ?? {}),
                  JSON.stringify(enrichment.riskResult ?? {}),
                  enrichment.rejectionReason,
                ]
              );
            } catch (fallbackErr) {
              logger.warn('Failed to persist enrichment to refactored_signals', { error: fallbackErr, signal_id: signal.signal_id });
              Sentry.captureException(fallbackErr, {
                tags: { component: 'orchestrator', failure: 'refactored_signals_insert' },
                extra: { signal_id: signal.signal_id, symbol: signal.symbol },
              });
            }
          }

          Sentry.addBreadcrumb({
            category: 'enrichment',
            message: 'Enrichment complete',
            level: 'info',
          });
        if (enrichment.queueUntil) {
          Sentry.addBreadcrumb({
            category: 'enrichment',
            message: 'Signal queued',
            level: 'info',
            data: { queueUntil: enrichment.queueUntil, reason: enrichment.queueReason },
          });
          await this.signalProcessor.queueSignal(
            signal.signal_id,
            enrichment.queueUntil,
            enrichment.queueReason || 'market_closed'
          );
          return {
            experiment: {} as any,
            policy: {} as any,
            market_context: {} as any,
            success: false,
            error: 'queued_market_closed',
            duration_ms: Date.now() - startedAt,
          };
        }
        if (enrichment.rejectionReason) {
          const isRetryable = !OrchestratorService.NON_TRANSIENT_FAILURES.has(enrichment.rejectionReason);
          if (isRetryable) {
            return this.handleProcessingFailure(
              signal,
              enrichment.rejectionReason,
              config.orchestratorRetryDelayMs,
              Date.now() - startedAt
            );
          }
          Sentry.addBreadcrumb({
            category: 'risk',
            message: 'Signal rejected by enrichment',
            level: 'warning',
            data: { reason: enrichment.rejectionReason },
          });
          await this.signalProcessor.updateStatus(
            signal.signal_id,
            'rejected',
            enrichment.rejectionReason
          );
          await this.signalProcessor.markFailed(signal.signal_id);
          return {
            experiment: {} as any,
            policy: {} as any,
            market_context: {} as any,
            success: false,
            error: enrichment.rejectionReason,
            duration_ms: Date.now() - startedAt,
          };
        }
        Sentry.addBreadcrumb({
          category: 'risk',
          message: 'Risk evaluation complete',
          level: 'info',
        });
        const market_context = await this.createMarketContext(signal);
        let dealerDecision: GammaStrategyDecision | DealerPositioningDecision | null = null;
        if (config.enableDealerUwGamma) {
          const gammaContext = await gammaDealerStrategy.getGammaContext(signal.symbol);
          const enrichedData = (enrichment.enrichedData ?? {}) as Record<string, unknown>;
          const marketDataLike: MarketDataLike = {
            currentPrice: market_context.current_price,
            gex: enrichedData.gex as MarketDataLike['gex'],
            optionsFlow: enrichedData.optionsFlow as MarketDataLike['optionsFlow'],
          };
          dealerDecision = await gammaDealerStrategy.evaluate(signal, marketDataLike, gammaContext);
          if (dealerDecision) {
            Sentry.addBreadcrumb({
              category: 'gamma',
              message: 'GammaDealerStrategy evaluated',
              level: 'info',
              data: { regime: dealerDecision.regime, confidence: dealerDecision.confidence_score },
            });
          }
        }
        if (!dealerDecision && config.enableDealerGex) {
          const dpContext = dealerPositioningStrategy.buildContextFromEnrichment(
            enrichment.enrichedData ?? null,
            signal.symbol
          );
          dealerDecision = dealerPositioningStrategy.evaluate(signal, dpContext);
          if (dealerDecision) {
            Sentry.addBreadcrumb({
              category: 'dealer',
              message: 'DealerPositioningStrategy evaluated',
              level: 'info',
              data: { regime: dealerDecision.regime, confidence: dealerDecision.confidence_score },
            });
          }
        }
        const contextWithEnrichment: MarketContext = {
          ...market_context,
          enrichment: {
            enrichedData: enrichment.enrichedData ?? {},
            riskResult: enrichment.riskResult ?? {},
            rejectionReason: enrichment.rejectionReason,
            decisionOnly: enrichment.decisionOnly,
            gammaContext: dealerDecision && 'gamma_context' in dealerDecision ? dealerDecision.gamma_context : undefined,
            gammaDecision: dealerDecision ? {
              regime: dealerDecision.regime,
              direction: dealerDecision.direction,
              confidence_score: dealerDecision.confidence_score,
              position_size_multiplier: dealerDecision.position_size_multiplier,
              strike_adjustment: 'strike_adjustment' in dealerDecision ? dealerDecision.strike_adjustment : { gammaInfluencedStrike: false, gammaTargetStrike: null },
              exit_profile: dealerDecision.exit_profile,
              gamma_context: 'gamma_context' in dealerDecision ? dealerDecision.gamma_context : dealerDecision.dealer_context,
            } : undefined,
          },
          marketIntel: dealerDecision
            ? {
                ...market_context.marketIntel,
                gamma: {
                  regime: dealerDecision.regime,
                  position_size_multiplier: dealerDecision.position_size_multiplier,
                },
              }
            : market_context.marketIntel,
        };
        const experiment = await this.createExperiment(signal);
        signal.experiment_id = experiment.experiment_id;
        Sentry.setTag('engine', experiment.variant);
        const policy = await this.getExecutionPolicy(experiment.experiment_id, experiment.variant);
        Sentry.addBreadcrumb({
          category: 'policy',
          message: 'Policy resolved',
          level: 'info',
          data: { execution_mode: policy.execution_mode, variant: experiment.variant },
        });
        let { engineA, engineB } = await this.distributeSignal(signal, contextWithEnrichment, experiment);

        const activeRec = experiment.variant === 'A' ? engineA : engineB;
        if (activeRec?.entryWait) {
          const attempts = Number(signal.processing_attempts ?? 0);
          const maxWaitRetries = 3;
          if (attempts < maxWaitRetries) {
            const waitDelayMs = 5 * 60 * 1000;
            const nextRetryAt = new Date(Date.now() + waitDelayMs);
            await this.signalProcessor.scheduleRetry(
              signal.signal_id,
              attempts + 1,
              nextRetryAt,
              'entry_wait'
            );
            logger.info('Entry engine WAIT — signal re-queued', {
              signal_id: signal.signal_id,
              symbol: signal.symbol,
              attempt: attempts + 1,
              maxRetries: maxWaitRetries,
              next_retry_at: nextRetryAt.toISOString(),
            });
            Sentry.addBreadcrumb({
              category: 'engine',
              message: 'Entry wait — signal re-queued',
              level: 'info',
              data: { signal_id: signal.signal_id, attempt: attempts + 1 },
            });
          } else {
            await this.signalProcessor.updateStatus(signal.signal_id, 'rejected', 'entry_wait_exhausted');
            await this.signalProcessor.markFailed(signal.signal_id);
            logger.info('Entry engine WAIT retries exhausted — signal rejected', {
              signal_id: signal.signal_id,
              symbol: signal.symbol,
              attempts,
            });
          }
          return {
            experiment,
            policy,
            market_context,
            success: false,
            error: 'entry_wait',
            duration_ms: Date.now() - startedAt,
          };
        }

        if (experiment.variant === 'B' && engineB == null) {
          logger.warn('Engine B returned no recommendation', {
            signal_id: signal.signal_id,
            symbol: signal.symbol,
            direction: signal.direction,
            experiment_id: experiment.experiment_id,
          });
          Sentry.addBreadcrumb({
            category: 'engine',
            message: 'Engine B returned null',
            level: 'warning',
            data: { signal_id: signal.signal_id },
          });
        }
        const { engineA: adjustedA, engineB: adjustedB } = this.applyGammaOverride(
          experiment.variant,
          engineA,
          engineB,
          dealerDecision,
          signal
        );
        engineA = adjustedA;
        engineB = adjustedB;
        Sentry.addBreadcrumb({
          category: 'engine',
          message: 'Engine invoked',
          level: 'info',
          data: { variant: experiment.variant },
        });

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

        await this.persistRecommendation(
          signal,
          experiment.experiment_id,
          'A',
          engine_a_recommendation,
          enrichment,
          dealerDecision
        );
        await this.persistRecommendation(
          signal,
          experiment.experiment_id,
          'B',
          engine_b_recommendation,
          enrichment,
          dealerDecision
        );
        if (dealerDecision) {
          await this.persistSignalMetaGamma(signal.signal_id, dealerDecision);
        }

        await this.updateSignalStatus(
          signal,
          policy,
          engine_a_recommendation,
          engine_b_recommendation,
          enrichment
        );
        // Test signals bypass decisionOnly to allow full pipeline testing
        const isTest = !!(signal.raw_payload as Record<string,any>)?.is_test || config.e2eTestMode;
        if (!enrichment.decisionOnly || isTest) {
          if (enrichment.decisionOnly && isTest) {
            logger.info('Test signal bypassing decisionOnly gate for order creation', {
              signal_id: signal.signal_id,
            });
          }
          await this.createPaperOrders(
            signal,
            experiment.experiment_id,
            engine_a_recommendation,
            engine_b_recommendation,
            enrichment
          );
        } else {
          Sentry.addBreadcrumb({
            category: 'orders',
            message: 'Order creation skipped (decision-only mode, market closed)',
            level: 'info',
            data: { signal_id: signal.signal_id },
          });
        }
        const shadowRecommendation = experiment.variant === 'A'
          ? engine_b_recommendation
          : engine_a_recommendation;
        await this.handleShadowExecution(
          signal,
          shadowRecommendation,
          experiment.experiment_id,
          dealerDecision
        );

        // UDC parallel shadow path — never modifies legacy flow
        await this.runUDCParallel(signal, market_context).catch((udcErr) => {
          logger.warn('UDC parallel run failed (non-blocking)', {
            signal_id: signal.signal_id,
            error: udcErr?.message ?? udcErr,
          });
        });

        await this.signalProcessor.markProcessed(signal.signal_id, experiment.experiment_id);

        return {
          experiment,
          policy,
          market_context,
          engine_a_recommendation: engine_a_recommendation ?? undefined,
          engine_b_recommendation: engine_b_recommendation ?? undefined,
          success: true,
          duration_ms: Date.now() - startedAt,
        };
        } catch (error: any) {
          logger.error('Failed to process signal', error, {
            signal_id: signal.signal_id,
          });
          Sentry.captureException(error, {
            tags: { stage: 'orchestrator', signalId: signal.signal_id },
          });
          throw error;
        }
      }
    );
  }

  async createMarketContext(signal: Signal): Promise<MarketContext> {
    return this.signalProcessor.createMarketContext(signal);
  }

  async createExperiment(signal: Signal) {
    // ENABLE_VARIANT_B is the master safety gate; AB_SPLIT_PERCENTAGE controls the ratio
    const pctB = config.enableVariantB
      ? Math.min(1, Math.max(0, config.abSplitPercentage))
      : 0;
    const splitToA = 1 - pctB;
    return this.experimentManager.createExperiment(signal, splitToA, 'v1.0');
  }

  async getExecutionPolicy(experiment_id: string, variant?: 'A' | 'B') {
    return this.policyEngine.getExecutionPolicy(experiment_id, 'v1.0', variant);
  }

  async distributeSignal(signal: Signal, context: MarketContext, experiment: { variant: 'A' | 'B' }) {
    if (config.enableShadowExecution) {
      return this.engineCoordinator.invokeBoth(signal, context);
    }

    if (experiment.variant === 'A') {
      const engineA = await this.engineCoordinator.invokeEngineA(signal, context);
      return { engineA, engineB: null };
    }

    const engineB = await this.engineCoordinator.invokeEngineB(signal, context);
    return { engineA: null, engineB };
  }

  private applyGammaOverride(
    variant: 'A' | 'B',
    engineA: TradeRecommendation | null,
    engineB: TradeRecommendation | null,
    dealerDecision: (GammaStrategyDecision | DealerPositioningDecision) | null,
    signal: Signal
  ): { engineA: TradeRecommendation | null; engineB: TradeRecommendation | null } {
    if (!dealerDecision || dealerDecision.direction === 'HOLD') {
      return { engineA, engineB };
    }
    const gammaWeight = config.dealerStrategyWeight;
    if (dealerDecision.confidence_score < gammaWeight) {
      return { engineA, engineB };
    }
    if (variant === 'A' && engineA) {
      if (dealerDecision.confidence_score >= 0.7) {
        const gammaDir = dealerDecision.direction === 'LONG' ? 'long' : 'short';
        const baseQty = engineA.quantity;
        const adjustedQty = Math.max(1, Math.floor(baseQty * dealerDecision.position_size_multiplier));
        logger.info('Dealer strategy override Engine A', {
          signal_id: signal.signal_id,
          regime: dealerDecision.regime,
          originalDirection: engineA.direction,
          gammaDirection: gammaDir,
          confidence: dealerDecision.confidence_score,
        });
        return {
          engineA: {
            ...engineA,
            direction: gammaDir,
            quantity: adjustedQty,
          },
          engineB,
        };
      }
    }
    if (variant === 'B' && engineB) {
      const gammaDir = dealerDecision.direction === 'LONG' ? 'long' : 'short';
      const baseQty = engineB.quantity;
      const adjustedQty = Math.max(1, Math.floor(baseQty * dealerDecision.position_size_multiplier));
      if (engineB.direction !== gammaDir) {
        if (dealerDecision.confidence_score >= 0.7) {
          logger.info('Dealer strategy override Engine B direction', {
            signal_id: signal.signal_id,
            originalDirection: engineB.direction,
            gammaDirection: gammaDir,
            confidence: dealerDecision.confidence_score,
          });
          return {
            engineA,
            engineB: { ...engineB, direction: gammaDir, quantity: adjustedQty },
          };
        }
        logger.info('Dealer strategy conflict with Engine B - low confidence, keeping Engine B direction', {
          signal_id: signal.signal_id,
          engineBDirection: engineB.direction,
          gammaDirection: gammaDir,
          confidence: dealerDecision.confidence_score,
        });
        return { engineA, engineB };
      }
      return {
        engineA,
        engineB: { ...engineB, quantity: adjustedQty },
      };
    }
    return { engineA, engineB };
  }

  private async persistSignalMetaGamma(
    signalId: string,
    decision: GammaStrategyDecision | DealerPositioningDecision
  ): Promise<void> {
    try {
      await db.query(
        `UPDATE signals SET meta_gamma = $1 WHERE signal_id = $2`,
        [JSON.stringify(decision), signalId]
      );
    } catch (err) {
      logger.warn('Failed to persist signal meta_gamma', { signalId, error: err });
    }
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
    engineB?: TradeRecommendation | null,
    enrichment?: { enrichedData: Record<string, any>; riskResult: Record<string, any>; rejectionReason: string | null; decisionOnly?: boolean }
  ): Promise<void> {
    const risk = enrichment?.riskResult || {};
    const isTest = Boolean(risk.testBypass);
    const positionLimitExceeded = !isTest && (
      Number(risk.openPositions ?? 0) >= Number(risk.maxOpenPositions ?? Number.POSITIVE_INFINITY) ||
      Number(risk.openSymbolPositions ?? 0) >= Number(risk.maxPositionsPerSymbol ?? Number.POSITIVE_INFINITY)
    );
    const decisionOnly = Boolean(enrichment?.decisionOnly);
    const hasRejection = Boolean(
      enrichment?.rejectionReason ||
        (!decisionOnly && !isTest && risk.marketOpen === false) ||
        positionLimitExceeded
    );

    const executed = policy.executed_engine;
    const recommendation = executed === 'A' ? engineA : executed === 'B' ? engineB : null;
    const shouldTrade = Boolean(
      executed &&
        recommendation &&
        !recommendation.is_shadow &&
        !hasRejection &&
        !decisionOnly
    );
    const status = shouldTrade || decisionOnly ? 'approved' : 'rejected';
    const rejectionReason = hasRejection && !decisionOnly ? enrichment?.rejectionReason || 'risk_rejected' : null;

    if (executed === 'B' && !shouldTrade && !decisionOnly) {
      const reason =
        !recommendation
          ? 'no_recommendation'
          : recommendation.is_shadow
            ? 'shadow_only'
            : hasRejection
              ? rejectionReason || 'risk_rejected'
              : 'unknown';
      logger.warn('Engine B signal not trading', {
        signal_id: signal.signal_id,
        symbol: signal.symbol,
        direction: signal.direction,
        reason,
        hasRecommendation: !!recommendation,
        isShadow: recommendation?.is_shadow,
        hasRejection,
        rejectionReason,
      });
    }

    await this.signalProcessor.updateStatus(signal.signal_id, status, rejectionReason);

    // Confluence alert when orchestrator approves and confluence passes
    if (
      shouldTrade &&
      config.alertsEnabled &&
      enrichment?.enrichedData?.confluence?.tradeGatePasses
    ) {
      const conf = enrichment.enrichedData.confluence;
      const entries = (enrichment.enrichedData.optionsFlow?.entries ?? []) as Array<{
        side?: string;
        premium?: number;
      }>;
      const callPremium = entries
        .filter((e) => e.side === 'call')
        .reduce((s, e) => s + Number(e.premium || 0), 0);
      const putPremium = entries
        .filter((e) => e.side === 'put')
        .reduce((s, e) => s + Number(e.premium || 0), 0);
      const netflow = callPremium - putPremium;
      const fmt = (v: number) =>
        Math.abs(v) >= 1e6
          ? `$${(v / 1e6).toFixed(1)}M`
          : Math.abs(v) >= 1e3
            ? `$${(v / 1e3).toFixed(1)}K`
            : `$${v}`;
      const dealerPos = enrichment.enrichedData.gex?.dealerPosition ?? 'neutral';
      const gammaRegime =
        dealerPos === 'long_gamma' ? 'LONG_GAMMA' : dealerPos === 'short_gamma' ? 'SHORT_GAMMA' : 'NEUTRAL';
      alertService
        .sendConfluenceAlert({
          symbol: signal.symbol,
          direction: signal.direction,
          confluenceScore: conf.score,
          netflowFormatted: fmt(netflow),
          gammaRegime,
        })
        .catch((err) =>
          logger.warn('Orchestrator confluence alert failed', { error: err, signalId: signal.signal_id })
        );
    }
  }

  private async handleShadowExecution(
    signal: Signal,
    recommendation: TradeRecommendation | undefined,
    experimentId: string,
    dealerDecision?: GammaStrategyDecision | DealerPositioningDecision | null
  ): Promise<void> {
    if (!this.shadowExecutor || !recommendation?.is_shadow || !config.enableShadowExecution) {
      return;
    }
    Sentry.addBreadcrumb({
      category: 'shadow',
      message: 'Shadow execution triggered',
      level: 'info',
      data: { experimentId },
    });

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

    const shadowRec =
      recommendation?.strike != null && recommendation?.expiration
        ? {
            strike: recommendation.strike,
            expiration: recommendation.expiration instanceof Date ? recommendation.expiration : new Date(recommendation.expiration),
            quantity: recommendation.quantity ?? 1,
            entry_price: recommendation.entry_price,
          }
        : undefined;

    await this.shadowExecutor.simulateExecution(
      metaDecision,
      enrichedSignal,
      experimentId,
      dealerDecision ? JSON.stringify(dealerDecision) : undefined,
      shadowRec
    );
  }

  private async createPaperOrders(
    signal: Signal,
    experimentId: string,
    engineA?: TradeRecommendation | null,
    engineB?: TradeRecommendation | null,
    enrichment?: { enrichedData: Record<string, any>; riskResult: Record<string, any>; rejectionReason: string | null }
  ): Promise<void> {
    if (config.appMode !== 'PAPER') {
      return;
    }
    Sentry.addBreadcrumb({
      category: 'orders',
      message: 'Order creation triggered',
      level: 'info',
      data: { experimentId },
    });

    const signalStatus = await db.query(
      `SELECT status, rejection_reason FROM signals WHERE signal_id = $1 LIMIT 1`,
      [signal.signal_id]
    );
    const statusRow = signalStatus.rows[0];
    if (!statusRow || statusRow.status !== 'approved' || statusRow.rejection_reason) {
      logger.warn('Skipping order creation (signal rejected)', {
        signal_id: signal.signal_id,
        status: statusRow?.status ?? 'unknown',
        rejection_reason: statusRow?.rejection_reason ?? enrichment?.rejectionReason ?? null,
      });
      return;
    }

    const recommendations = [
      engineA ? { engine: 'A' as const, rec: engineA } : null,
      engineB ? { engine: 'B' as const, rec: engineB } : null,
    ].filter(Boolean) as Array<{ engine: 'A' | 'B'; rec: TradeRecommendation }>;

    const webhookSource = extractWebhookSource(signal.raw_payload as Record<string, unknown>);
    const isTest = !!(signal.raw_payload as Record<string, unknown>)?.is_test;

    for (const { engine, rec } of recommendations) {
      if (rec.is_shadow) {
        continue;
      }

      const optionType = rec.direction === 'long' ? 'call' : 'put';
      const optionSymbol = buildOptionSymbol(
        rec.symbol,
        rec.expiration,
        optionType,
        rec.strike
      );

      const block = await shouldBlockSameStrike({
        optionSymbol,
        engine,
        webhookSource,
        isTest,
      });
      if (block) {
        logger.info('Same-strike cooldown: skipping order', {
          signal_id: signal.signal_id,
          optionSymbol,
          engine,
          webhookSource,
        });
        continue;
      }

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

  // buildOptionSymbol moved to src/lib/shared/option-utils.ts

  /**
   * Runs UDC in parallel with the legacy engine flow.
   * In SHADOW_UDC mode: persists DecisionSnapshot only, no execution.
   * In UDC_PRIMARY mode: persists + executes via paper order path.
   * In LEGACY_ONLY / UDC_ONLY: skipped entirely from this path.
   */
  private async runUDCParallel(
    signal: Signal,
    _marketContext: MarketContext,
  ): Promise<void> {
    const mode = getTradingMode();
    if (mode !== 'SHADOW_UDC' && mode !== 'UDC_PRIMARY') {
      return;
    }

    const udcSignal: UDCSignal = {
      id: signal.signal_id,
      symbol: signal.symbol,
      direction: signal.direction,
      timeframe: signal.timeframe,
      timestamp: signal.timestamp instanceof Date ? signal.timestamp.getTime() : Date.now(),
      pattern: (signal.raw_payload as Record<string, unknown>)?.pattern as string | undefined,
      confidence: (signal.raw_payload as Record<string, unknown>)?.confidence as number | undefined,
    };

    const isIntraday = ['1', '3', '5', '15'].includes(signal.timeframe ?? '');

    let snapshot;
    try {
      snapshot = await marketSnapshotService.getSnapshot(signal.symbol, {
        needOptionsChain: true,
        dteMin: isIntraday ? 0 : 5,
        dteMax: isIntraday ? 7 : 45,
        strikeWindowPct: 0.10,
        needGreeks: true,
      });
    } catch (err) {
      const reason = err instanceof StaleSnapshotError ? 'STALE_SNAPSHOT' : 'SNAPSHOT_FETCH_FAILED';
      await db.query(
        `INSERT INTO decision_snapshots (signal_id, status, reason, order_plan_json, created_at)
         VALUES ($1, $2, $3, NULL, NOW())`,
        [signal.signal_id, 'BLOCKED', `${reason}: ${(err as Error).message}`],
      );
      Sentry.addBreadcrumb({
        category: 'udc',
        message: `UDC ${mode}: BLOCKED (${reason})`,
        level: 'warning',
        data: { signal_id: signal.signal_id, reason },
      });
      return;
    }

    const portfolio: PortfolioState = {
      risk: {
        drawdownPct: 0,
        positionCount: 0,
        dailyPnL: 0,
        maxDailyLoss: config.maxDailyLoss,
        portfolioDelta: 0,
        portfolioGamma: 0,
        maxOpenPositions: config.maxOpenPositions,
        dteConcentration: {},
        lastEntryTimestamp: null,
      },
    };

    try {
      const openPositions = await db.query(
        `SELECT COUNT(*)::int AS cnt FROM refactored_positions WHERE status = 'open'`,
      );
      portfolio.risk.positionCount = openPositions.rows[0]?.cnt ?? 0;
    } catch {
      // fail-closed: if we can't read positions, positionCount stays 0
    }

    const udcResult = await runUDC(udcSignal, snapshot, portfolio);

    // Idempotent upsert: if decisionId already exists, return existing snapshot
    if (udcResult.decisionId) {
      const existing = await db.query(
        `SELECT id FROM decision_snapshots WHERE decision_id = $1 LIMIT 1`,
        [udcResult.decisionId],
      );
      if (existing.rows.length > 0) {
        logger.info('UDC: idempotent hit — snapshot already exists', {
          signal_id: signal.signal_id,
          decisionId: udcResult.decisionId,
        });
        return;
      }
    }

    try {
      await db.query(
        `INSERT INTO decision_snapshots (signal_id, decision_id, status, reason, order_plan_json, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          signal.signal_id,
          udcResult.decisionId ?? null,
          udcResult.status,
          udcResult.reason ?? null,
          udcResult.plan ? JSON.stringify(udcResult.plan) : null,
        ],
      );
    } catch (insertErr: any) {
      // Handle unique violation (concurrent insert race)
      if (insertErr?.code === '23505') {
        logger.info('UDC: unique violation caught — concurrent duplicate', {
          signal_id: signal.signal_id,
          decisionId: udcResult.decisionId,
        });
        return;
      }
      throw insertErr;
    }

    if (mode === 'UDC_PRIMARY' && udcResult.status === 'PLAN_CREATED' && udcResult.plan) {
      logger.info('UDC_PRIMARY: plan created, routing to paper execution', {
        signal_id: signal.signal_id,
        planId: udcResult.plan.planId,
      });
    }

    Sentry.addBreadcrumb({
      category: 'udc',
      message: `UDC ${mode}: ${udcResult.status}`,
      level: 'info',
      data: {
        signal_id: signal.signal_id,
        status: udcResult.status,
        reason: udcResult.reason,
        planId: udcResult.plan?.planId,
        decisionId: udcResult.decisionId,
      },
    });
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

  private async persistRecommendation(
    signal: Signal,
    experimentId: string,
    engine: 'A' | 'B',
    recommendation: TradeRecommendation | undefined,
    enrichment: { enrichedData: Record<string, any>; riskResult: Record<string, any>; rejectionReason: string | null },
    dealerDecision?: GammaStrategyDecision | DealerPositioningDecision | null
  ): Promise<void> {
    if (!recommendation) {
      return;
    }

    const rationale: Record<string, unknown> = {
      enriched_data: enrichment.enrichedData,
      risk_check_result: enrichment.riskResult,
      rejection_reason: enrichment.rejectionReason,
    };
    if (dealerDecision) {
      rationale.meta_gamma = dealerDecision;
    }
    // Phase 2b: Capture entry metadata for audit trail
    if (recommendation.entry_metadata) {
      rationale.entry_metadata = recommendation.entry_metadata;
    }

    await db.query(
      `INSERT INTO decision_recommendations (
        experiment_id,
        signal_id,
        engine,
        symbol,
        direction,
        timeframe,
        strike,
        expiration,
        quantity,
        entry_price,
        is_shadow,
        rationale
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (experiment_id, engine)
      DO UPDATE SET
        strike = EXCLUDED.strike,
        expiration = EXCLUDED.expiration,
        quantity = EXCLUDED.quantity,
        entry_price = EXCLUDED.entry_price,
        is_shadow = EXCLUDED.is_shadow,
        rationale = EXCLUDED.rationale`,
      [
        experimentId,
        signal.signal_id,
        engine,
        signal.symbol,
        signal.direction,
        signal.timeframe,
        recommendation.strike,
        recommendation.expiration,
        recommendation.quantity,
        recommendation.entry_price,
        recommendation.is_shadow,
        JSON.stringify(rationale),
      ]
    );
  }
}
