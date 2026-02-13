/**
 * Engine invokers - bridge orchestrator to decision engines.
 */

import { config } from '../config/index.js';
import { evaluateMarketSession } from '../utils/market-session.js';
import { TradeRecommendation, Signal, MarketContext } from './types.js';
import { logger } from '../utils/logger.js';
import { selectStrike } from '../services/strike-selection.service.js';
import { buildEntryExitPlan } from '../services/entry-exit-agent.service.js';
import { buildSignalEnrichment } from '../services/signal-enrichment.service.js';
import { buildEntryDecisionInput } from '../services/entry-decision-adapter.service.js';
import { evaluateEntryDecision } from '../lib/entryEngine/index.js';
import { marketData } from '../services/market-data.js';
import { ContextAgent } from '../agents/core/context-agent.js';
import { TechnicalAgent } from '../agents/core/technical-agent.js';
import { RiskAgent } from '../agents/core/risk-agent.js';
import { MetaDecisionAgent } from '../agents/core/meta-decision-agent.js';
import { GammaFlowSpecialist } from '../agents/specialists/gamma-flow-specialist.js';
import { ORBSpecialist } from '../agents/specialists/orb-specialist.js';
import { StratSpecialist } from '../agents/specialists/strat-specialist.js';
import { TTMSpecialist } from '../agents/specialists/ttm-specialist.js';
import { SatylandSubAgent } from '../agents/subagents/satyland-sub-agent.js';
import { eventLogger } from '../services/event-logger.service.js';
import { EnrichedSignal, MarketData, Indicators } from '../types/index.js';
import * as Sentry from '@sentry/node';

function applyGammaSizingMultiplier(
  baseSize: number,
  gammaContext?: { regime?: string; position_size_multiplier?: number }
): number {
  if (gammaContext?.position_size_multiplier != null && Number.isFinite(gammaContext.position_size_multiplier)) {
    return Math.max(1, Math.floor(baseSize * gammaContext.position_size_multiplier));
  }
  const regime = String(gammaContext?.regime || '').toUpperCase();
  if (regime === 'LONG_GAMMA') return baseSize * 1.25;
  if (regime === 'SHORT_GAMMA') return baseSize * 0.6;
  return baseSize;
}

async function buildRecommendation(
  engine: 'A' | 'B',
  signal: Signal,
  context?: MarketContext
): Promise<TradeRecommendation | null> {
  try {
    if (engine === 'A' && context?.enrichment) {
      const entryInput = buildEntryDecisionInput(signal, context, context.enrichment);
      const entryResult = evaluateEntryDecision(entryInput);
      if (entryResult.action === 'BLOCK') {
        logger.info('Engine A entry decision blocked', {
          signal_id: signal.signal_id,
          symbol: signal.symbol,
          rationale: entryResult.rationale,
        });
        Sentry.addBreadcrumb({
          category: 'engine',
          message: 'Engine A entry blocked by tier rules',
          level: 'info',
          data: { signal_id: signal.signal_id, rationale: entryResult.rationale },
        });
        return null;
      }
      if (entryResult.action === 'WAIT') {
        logger.info('Engine A entry decision wait', {
          signal_id: signal.signal_id,
          symbol: signal.symbol,
          rationale: entryResult.rationale,
        });
        Sentry.addBreadcrumb({
          category: 'engine',
          message: 'Engine A entry delayed by tier rules',
          level: 'info',
          data: { signal_id: signal.signal_id, rationale: entryResult.rationale },
        });
        return null;
      }
    }

    Sentry.addBreadcrumb({
      category: 'engine',
      message: `Engine ${engine} strike selection`,
      level: 'info',
      data: { signal_id: signal.signal_id, symbol: signal.symbol },
    });
    const { strike, expiration, optionType } = await selectStrike(signal.symbol, signal.direction);
    Sentry.addBreadcrumb({
      category: 'engine',
      message: `Engine ${engine} entry plan creation`,
      level: 'info',
      data: { strike, expiration, optionType },
    });
    const { entryPrice } = await buildEntryExitPlan(signal.symbol, strike, expiration, optionType);

    const baseSize = Math.max(1, Math.floor(config.maxPositionSize));
    const gammaCtx = context?.enrichment?.gammaDecision
      ? {
          regime: context.enrichment.gammaDecision.regime,
          position_size_multiplier: context.enrichment.gammaDecision.position_size_multiplier,
        }
      : context?.marketIntel?.gamma;
    const adjustedSize = applyGammaSizingMultiplier(baseSize, gammaCtx);
    const quantity = Math.max(1, Math.floor(adjustedSize));

    return {
      experiment_id: signal.experiment_id ?? '00000000-0000-0000-0000-000000000000',
      engine,
      symbol: signal.symbol,
      direction: signal.direction,
      strike,
      expiration,
      quantity,
      entry_price: entryPrice,
      is_shadow: false,
    };
  } catch (error) {
    logger.error('Engine recommendation failed', error, { engine, signal_id: signal.signal_id });
    Sentry.captureException(error, {
      tags: { stage: 'engine', engine, signalId: signal.signal_id },
    });
    return null;
  }
}

async function buildEngineBRecommendation(
  signal: Signal,
  context?: MarketContext
): Promise<TradeRecommendation | null> {
  try {
    Sentry.addBreadcrumb({
      category: 'engine',
      message: 'Engine B enrichment start',
      level: 'info',
      data: { signal_id: signal.signal_id, symbol: signal.symbol },
    });
    const enrichment = await buildSignalEnrichment(signal);
    let candles: any[] = [];
    let indicators = enrichment.enrichedData.indicators as Indicators | undefined;
    let currentPrice = enrichment.enrichedData.currentPrice as number | undefined;

    try {
      candles = await marketData.getCandles(signal.symbol, signal.timeframe, 200);
    } catch (error) {
      logger.warn('Engine B candles unavailable', { error, symbol: signal.symbol });
    }

    if (!indicators) {
      try {
        indicators = await marketData.getIndicators(signal.symbol, signal.timeframe);
      } catch (error) {
        logger.warn('Engine B indicators unavailable', { error, symbol: signal.symbol });
      }
    }

    if (!Number.isFinite(currentPrice) || !currentPrice) {
      try {
        currentPrice = await marketData.getStockPrice(signal.symbol);
      } catch (error) {
        logger.warn('Engine B price unavailable', { error, symbol: signal.symbol });
      }
    }

    if (!currentPrice) {
      logger.warn('Engine B market data missing, skipping recommendation', {
        symbol: signal.symbol,
        hasIndicators: Boolean(indicators),
        hasPrice: Boolean(currentPrice),
      });
      return null;
    }

    if (!indicators) {
      indicators = {
        ema8: [currentPrice],
        ema13: [currentPrice],
        ema21: [currentPrice],
        ema48: [currentPrice],
        ema200: [currentPrice],
        atr: [0],
        bollingerBands: { upper: [currentPrice], middle: [currentPrice], lower: [currentPrice] },
        keltnerChannels: { upper: [currentPrice], middle: [currentPrice], lower: [currentPrice] },
        ttmSqueeze: { state: 'off', momentum: 0 },
      };
    }
    const signalTimestamp =
      signal.timestamp instanceof Date ? signal.timestamp : new Date(signal.timestamp);
    const sessionEvaluation = evaluateMarketSession({
      timestamp: signalTimestamp,
      allowPremarket: config.allowPremarket,
      allowAfterhours: config.allowAfterhours,
      gracePeriodMinutes: config.marketCloseGraceMinutes,
    });
    const marketHours = await marketData.getMarketHours();
    const isMarketOpen = sessionEvaluation.isOpen;
    const sessionType = sessionEvaluation.sessionType === 'RTH' ? 'RTH' : 'ETH';
    const minutesUntilClose =
      sessionType === 'RTH' && marketHours.isMarketOpen ? marketHours.minutesUntilClose : undefined;
    const riskResult = enrichment.riskResult || {};
    const effectiveOpenPositions = Number(
      riskResult.effectiveOpenPositions ?? riskResult.openPositions ?? 0
    );
    const positionLimitExceeded =
      effectiveOpenPositions >=
        Number(riskResult.maxOpenPositions ?? Number.POSITIVE_INFINITY) ||
      Number(riskResult.openSymbolPositions ?? 0) >= Number(riskResult.maxPositionsPerSymbol ?? Number.POSITIVE_INFINITY);

    const marketContextForAgents: MarketData = {
      candles,
      indicators,
      currentPrice,
      sessionContext: {
        sessionType,
        isMarketOpen,
        minutesUntilClose,
      },
      gex: enrichment.enrichedData.gex || null,
      optionsFlow: enrichment.enrichedData.optionsFlow || null,
      marketIntel: context?.marketIntel,
      risk: {
        positionLimitExceeded,
        exposureExceeded: false,
      },
    };

    const enrichedSignal: EnrichedSignal = {
      signalId: signal.signal_id,
      symbol: signal.symbol,
      direction: signal.direction,
      timeframe: signal.timeframe,
      timestamp: signal.timestamp,
      sessionType,
    };

    const metaAgent = new MetaDecisionAgent();

    const agents = [
      new ContextAgent(),
      new TechnicalAgent(),
      new RiskAgent(),
      new GammaFlowSpecialist(),
      new ORBSpecialist(),
      new StratSpecialist(),
      new TTMSpecialist(),
      new SatylandSubAgent(),
    ];

    const activatedAgents = agents.filter((agent) =>
      agent.shouldActivate(enrichedSignal, marketContextForAgents)
    );
    Sentry.addBreadcrumb({
      category: 'engine',
      message: 'Engine B agents activated',
      level: 'info',
      data: { agents: activatedAgents.map((agent) => agent.type) },
    });

    const outputs = await Promise.all(
      activatedAgents.map(async (agent) => {
        const output = await agent.analyze(enrichedSignal, marketContextForAgents);
        return {
          ...output,
          metadata: { ...(output.metadata || {}), agentType: agent.type },
        };
      })
    );

    const metaDecision = metaAgent.aggregate(outputs);
    Sentry.addBreadcrumb({
      category: 'engine',
      message: 'Engine B meta decision',
      level: 'info',
      data: { decision: metaDecision.decision, confidence: metaDecision.finalConfidence },
    });

    if (signal.experiment_id) {
      await eventLogger.logDecision({
        experimentId: signal.experiment_id,
        signalId: signal.signal_id,
        outputs,
        metaDecision,
      });
    }

    if (metaDecision.decision !== 'approve') {
      logger.info('Engine B meta decision rejected', {
        signal_id: signal.signal_id,
        reasons: metaDecision.reasons,
      });
      return null;
    }

    const { strike, expiration, optionType } = await selectStrike(signal.symbol, signal.direction);
    const { entryPrice } = await buildEntryExitPlan(signal.symbol, strike, expiration, optionType);
    const baseSize = Math.max(1, Math.floor(config.maxPositionSize));
    const gammaCtx = context?.enrichment?.gammaDecision
      ? {
          regime: context.enrichment.gammaDecision.regime,
          position_size_multiplier: context.enrichment.gammaDecision.position_size_multiplier,
        }
      : context?.marketIntel?.gamma;
    const adjustedSize = applyGammaSizingMultiplier(baseSize, gammaCtx);
    const quantity = Math.max(1, Math.floor(adjustedSize));

    return {
      experiment_id: signal.experiment_id ?? '00000000-0000-0000-0000-000000000000',
      engine: 'B',
      symbol: signal.symbol,
      direction: signal.direction,
      strike,
      expiration,
      quantity,
      entry_price: entryPrice,
      is_shadow: false,
    };
  } catch (error) {
    logger.error('Engine B pipeline failed', error, { signal_id: signal.signal_id });
    Sentry.captureException(error, {
      tags: { stage: 'engine', engine: 'B', signalId: signal.signal_id },
    });
    return null;
  }
}

export function createEngineAInvoker() {
  return async (signal: Signal, context: MarketContext) =>
    buildRecommendation('A', signal, context);
}

export function createEngineBInvoker() {
  return async (signal: Signal, context: MarketContext) =>
    buildEngineBRecommendation(signal, context);
}
