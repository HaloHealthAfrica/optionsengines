/**
 * Engine invokers - bridge orchestrator to decision engines.
 */

import { config } from '../config/index.js';
import { TradeRecommendation, Signal, MarketContext } from './types.js';
import { logger } from '../utils/logger.js';
import { selectStrike } from '../services/strike-selection.service.js';
import { buildEntryExitPlan } from '../services/entry-exit-agent.service.js';
import { buildSignalEnrichment } from '../services/signal-enrichment.service.js';
import { marketData } from '../services/market-data.js';
import { ContextAgent } from '../agents/core/context-agent.js';
import { TechnicalAgent } from '../agents/core/technical-agent.js';
import { RiskAgent } from '../agents/core/risk-agent.js';
import { MetaDecisionAgent } from '../agents/core/meta-decision-agent.js';
import { eventLogger } from '../services/event-logger.service.js';
import { EnrichedSignal, MarketData } from '../types/index.js';

async function buildRecommendation(
  engine: 'A' | 'B',
  signal: Signal
): Promise<TradeRecommendation | null> {
  try {
    const { strike, expiration, optionType } = await selectStrike(signal.symbol, signal.direction);
    const { entryPrice } = await buildEntryExitPlan(signal.symbol, strike, expiration, optionType);

    const quantity = Math.max(1, Math.floor(config.maxPositionSize));

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
    return null;
  }
}

async function buildEngineBRecommendation(signal: Signal): Promise<TradeRecommendation | null> {
  try {
    const enrichment = await buildSignalEnrichment(signal);
    const candles = await marketData.getCandles(signal.symbol, signal.timeframe, 200);
    const indicators = enrichment.enrichedData.indicators || (await marketData.getIndicators(signal.symbol, signal.timeframe));
    const currentPrice = enrichment.enrichedData.currentPrice ?? (await marketData.getStockPrice(signal.symbol));
    const marketHours = await marketData.getMarketHours();
    const isMarketOpen = marketHours.isMarketOpen;
    const riskResult = enrichment.riskResult || {};
    const positionLimitExceeded =
      Number(riskResult.openPositions ?? 0) >= Number(riskResult.maxOpenPositions ?? Number.POSITIVE_INFINITY) ||
      Number(riskResult.openSymbolPositions ?? 0) >= Number(riskResult.maxPositionsPerSymbol ?? Number.POSITIVE_INFINITY);

    const marketContextForAgents: MarketData = {
      candles,
      indicators,
      currentPrice,
      sessionContext: {
        sessionType: isMarketOpen ? 'RTH' : 'ETH',
        isMarketOpen,
        minutesUntilClose: marketHours.minutesUntilClose,
      },
      gex: enrichment.enrichedData.gex || null,
      optionsFlow: enrichment.enrichedData.optionsFlow || null,
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
      sessionType: isMarketOpen ? 'RTH' : 'ETH',
    };

    const contextAgent = new ContextAgent();
    const technicalAgent = new TechnicalAgent();
    const riskAgent = new RiskAgent();
    const metaAgent = new MetaDecisionAgent();

    const outputs = await Promise.all([
      contextAgent.analyze(enrichedSignal, marketContextForAgents),
      technicalAgent.analyze(enrichedSignal, marketContextForAgents),
      riskAgent.analyze(enrichedSignal, marketContextForAgents),
    ]);

    const outputsWithType = outputs.map((output) => ({
      ...output,
      metadata: { ...(output.metadata || {}), agentType: 'core' as const },
    }));

    const metaDecision = metaAgent.aggregate(outputsWithType);

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
    const quantity = Math.max(1, Math.floor(config.maxPositionSize));

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
    return null;
  }
}

export function createEngineAInvoker() {
  return async (signal: Signal, _context: MarketContext) =>
    buildRecommendation('A', signal);
}

export function createEngineBInvoker() {
  return async (signal: Signal, _context: MarketContext) =>
    buildEngineBRecommendation(signal);
}
