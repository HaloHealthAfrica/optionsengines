import { db } from './database.service.js';
import { marketData } from './market-data.js';
import { positioningService } from './positioning.service.js';
import { confluenceService } from './confluence.service.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { evaluateMarketSession, normalizeMarketSession } from '../utils/market-session.js';

/** Per-call timeout for external API calls during enrichment (ms) */
const ENRICHMENT_CALL_TIMEOUT_MS = 8000;

/** Wraps a promise with a timeout. Rejects with a descriptive error on timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export type SignalEnrichmentResult = {
  enrichedData: Record<string, any>;
  riskResult: Record<string, any>;
  rejectionReason: string | null;
  queueUntil?: Date | null;
  queueReason?: string | null;
  /** When true, orchestrator runs engines and persists decisions but skips order creation (e.g. market closed) */
  decisionOnly?: boolean;
};

type SignalLike = {
  signal_id: string;
  symbol: string;
  direction?: 'long' | 'short';
  timeframe: string;
  timestamp: Date | string;
  raw_payload?: Record<string, any> | null;
};

/** Detect whether this signal is a test signal that should bypass market gates */
function isTestSignal(signal: SignalLike): boolean {
  if (config.e2eTestMode) return true;
  const payload = signal.raw_payload ?? {};
  return !!(payload.is_test || payload.metadata?.is_test);
}

export async function buildSignalEnrichment(signal: SignalLike): Promise<SignalEnrichmentResult> {
  const riskResult: Record<string, any> = {};
  let rejectionReason: string | null = null;
  let queueUntil: Date | null = null;
  let queueReason: string | null = null;
  let decisionOnly = false;
  const signalTimestamp =
    signal.timestamp instanceof Date ? signal.timestamp : new Date(signal.timestamp);
  const payload = signal.raw_payload && typeof signal.raw_payload === 'object' ? signal.raw_payload : {};

  const toNumber = (value: unknown): number | null => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const signalConfidence =
    toNumber(payload.confidence) ??
    toNumber(payload.score) ??
    toNumber(payload.signal?.confidence) ??
    toNumber(payload.meta?.confidence) ??
    null;
  const patternStrength =
    toNumber(payload.pattern_strength) ??
    toNumber(payload.patternStrength) ??
    toNumber(payload.pattern?.strength) ??
    toNumber(payload.setup_quality) ??
    null;
  const mtfAlignment =
    toNumber(payload.mtf_alignment) ??
    toNumber(payload.mtfAlignment) ??
    toNumber(payload.timeframes?.alignment) ??
    null;

  const priorityTotal =
    (signalConfidence ?? 0) + (patternStrength ?? 0) + (mtfAlignment ?? 0);
  riskResult.signalPriority = {
    confidence: signalConfidence,
    pattern_strength: patternStrength,
    mtf_alignment: mtfAlignment,
    total: priorityTotal,
  };

  const sessionHint = normalizeMarketSession(
    payload.market_session ??
      payload.marketSession ??
      payload.session ??
      payload.session_type ??
      payload.sessionType
  );
  const sessionEvaluation = evaluateMarketSession({
    timestamp: signalTimestamp,
    allowPremarket: config.allowPremarket,
    allowAfterhours: config.allowAfterhours,
    gracePeriodMinutes: config.marketCloseGraceMinutes,
  });
  const isMarketOpen = sessionEvaluation.isOpen;
  riskResult.marketOpen = isMarketOpen;
  riskResult.marketSession = {
    session_hint: sessionHint,
    session_by_time: sessionEvaluation.sessionLabel,
    session_type: sessionEvaluation.sessionType,
    within_grace: sessionEvaluation.withinGrace,
    allow_premarket: config.allowPremarket,
    allow_afterhours: config.allowAfterhours,
    grace_minutes: config.marketCloseGraceMinutes,
  };

  const testBypass = isTestSignal(signal);

  if (!isMarketOpen && !testBypass) {
    const signalAgeMinutes = (Date.now() - signalTimestamp.getTime()) / 60000;
    riskResult.signalAgeMinutes = Math.round(signalAgeMinutes * 10) / 10;
    if (signalAgeMinutes > config.signalMaxAgeMinutes) {
      rejectionReason = 'signal_stale';
    } else if (config.decisionOnlyWhenMarketClosed) {
      decisionOnly = true;
      riskResult.decisionOnly = true;
      riskResult.decisionOnlyReason = 'market_closed';
    } else {
      try {
        const marketHours = await marketData.getMarketHours();
        queueUntil = marketHours.nextOpen ?? null;
      } catch (error) {
        logger.warn('Failed to resolve next market open for queue', { error });
      }
      if (queueUntil) {
        queueReason = 'market_closed';
      } else {
        rejectionReason = 'market_closed';
      }
    }
  } else if (!isMarketOpen && testBypass) {
    logger.info('Test signal bypassing market hours gate', { signal_id: signal.signal_id, symbol: signal.symbol });
    riskResult.testBypass = true;
    riskResult.marketOpen = false;
    riskResult.testBypassReason = 'is_test_or_e2e';
  }

  const riskLimits = await db.query(
    `SELECT * FROM risk_limits WHERE enabled = true ORDER BY created_at DESC LIMIT 1`
  );
  const riskLimit = riskLimits.rows[0] || {};

  const openPositionsResult = await db.query(
    `SELECT COUNT(*)::int AS count FROM refactored_positions WHERE status IN ('open', 'closing')`
  );
  const openPositions = openPositionsResult.rows[0]?.count || 0;

  const openSymbolPositionsResult = await db.query(
    `SELECT COUNT(*)::int AS count FROM refactored_positions 
     WHERE status IN ('open', 'closing') AND symbol = $1`,
    [signal.symbol]
  );
  const openSymbolPositions = openSymbolPositionsResult.rows[0]?.count || 0;

  riskResult.openPositions = openPositions;
  riskResult.openSymbolPositions = openSymbolPositions;
  riskResult.maxOpenPositions = config.maxOpenPositions;
  riskResult.maxPositionsPerSymbol = riskLimit.max_positions_per_symbol || 0;

  let freedSlots = 0;
  if (
    !rejectionReason &&
    config.positionReplacementEnabled &&
    openPositions >= config.maxOpenPositions &&
    (signalConfidence ?? priorityTotal) >= config.minConfidenceForReplacement
  ) {
    const positionsToReview = await db.query(
      `SELECT position_id, symbol, option_symbol, strike, expiration, type, quantity,
              entry_timestamp, position_pnl_percent, engine, experiment_id
       FROM refactored_positions
       WHERE status = 'open'
       ORDER BY entry_timestamp ASC
       LIMIT 50`
    );

    const now = new Date();
    const minHoldMinutes = config.minHoldMinutesForCapacityClose ?? 15;
    const closeCandidates = positionsToReview.rows.filter((row: any) => {
      const pnlPercent = Number(row.position_pnl_percent ?? 0);
      const hoursOpen =
        (now.getTime() - new Date(row.entry_timestamp).getTime()) / 3600000;
      const minutesOpen = hoursOpen * 60;

      const minHoldMet = minutesOpen >= minHoldMinutes;
      if (!minHoldMet) return false;

      const nearTarget =
        config.autoCloseNearTarget && pnlPercent >= config.autoCloseNearTargetThresholdPct;
      const agedLowProfit =
        config.closeAgedPositions &&
        hoursOpen >= config.closeAgedAfterHours &&
        pnlPercent < config.closeAgedBelowPnlPercent;

      return nearTarget || agedLowProfit;
    });

    for (const position of closeCandidates) {
      if (openPositions - freedSlots < config.maxOpenPositions) break;

      const pnlPercent = Number(position.position_pnl_percent ?? 0);
      const exitReason =
        config.autoCloseNearTarget && pnlPercent >= config.autoCloseNearTargetThresholdPct
          ? 'capacity_near_target'
          : 'capacity_aged';

      await db.query(
        `UPDATE refactored_positions
         SET status = $1,
             exit_reason = $2,
             last_updated = $3
         WHERE position_id = $4`,
        ['closing', exitReason, now, position.position_id]
      );

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
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          null,
          position.symbol,
          position.option_symbol,
          position.strike,
          position.expiration,
          position.type,
          position.quantity,
          position.engine ?? null,
          position.experiment_id ?? null,
          'paper',
          'pending_execution',
        ]
      );

      freedSlots += 1;
    }
  }

  const effectiveOpenPositions = Math.max(0, openPositions - freedSlots);
  riskResult.capacityActions = {
    freedSlots,
    positionReplacementEnabled: config.positionReplacementEnabled,
  };
  riskResult.effectiveOpenPositions = effectiveOpenPositions;

  if (!rejectionReason && effectiveOpenPositions >= config.maxOpenPositions) {
    rejectionReason = 'max_open_positions_exceeded';
  }

  if (
    !rejectionReason &&
    riskLimit.max_positions_per_symbol &&
    openSymbolPositions >= riskLimit.max_positions_per_symbol
  ) {
    rejectionReason = 'max_positions_per_symbol_exceeded';
  }

  let candles: any[] = [];
  let indicators: Record<string, any> = {};
  let currentPrice = 0;

  // Use payload price as fallback for test signals when market data is unavailable
  const fallbackPrice = toNumber(payload.price) ?? 0;

  try {
    currentPrice = await withTimeout(
      marketData.getStockPrice(signal.symbol),
      ENRICHMENT_CALL_TIMEOUT_MS,
      `getStockPrice(${signal.symbol})`
    );
  } catch (error) {
    logger.warn('Failed to fetch current price for enrichment', { error, symbol: signal.symbol });
    if (testBypass && fallbackPrice > 0) {
      currentPrice = fallbackPrice;
      logger.info('Test signal using payload price as fallback', { price: currentPrice });
    } else {
      rejectionReason = rejectionReason || 'market_data_unavailable';
    }
  }

  try {
    candles = await withTimeout(
      marketData.getCandles(signal.symbol, signal.timeframe, 200),
      ENRICHMENT_CALL_TIMEOUT_MS,
      `getCandles(${signal.symbol})`
    );
  } catch (error) {
    logger.warn('Failed to fetch candles for enrichment', { error, symbol: signal.symbol });
    if (!testBypass) {
      rejectionReason = rejectionReason || 'market_data_unavailable';
    }
    // Test signals proceed without candles
  }

  try {
    indicators = await withTimeout(
      marketData.getIndicators(signal.symbol, signal.timeframe),
      ENRICHMENT_CALL_TIMEOUT_MS,
      `getIndicators(${signal.symbol})`
    );
  } catch (error) {
    logger.warn('Failed to fetch indicators for enrichment', { error, symbol: signal.symbol });
    if (!testBypass) {
      rejectionReason = rejectionReason || 'market_data_unavailable';
    }
    // Fallback indicators using available price
    const fallback = currentPrice || fallbackPrice;
    indicators = {
      ema8: [fallback],
      ema21: [fallback],
      atr: [0],
      ttmSqueeze: { state: 'off', momentum: 0 },
    };
  }

  let gexData = null;
  let optionsFlow = null;
  try {
    gexData = await withTimeout(
      positioningService.getGexSnapshot(signal.symbol),
      ENRICHMENT_CALL_TIMEOUT_MS,
      `getGexSnapshot(${signal.symbol})`
    );
  } catch (error) {
    logger.warn('GEX data unavailable for signal', { error, symbol: signal.symbol });
  }
  try {
    optionsFlow = await withTimeout(
      positioningService.getOptionsFlowSnapshot(signal.symbol, 50),
      ENRICHMENT_CALL_TIMEOUT_MS,
      `getOptionsFlowSnapshot(${signal.symbol})`
    );
  } catch (error) {
    logger.warn('Options flow data unavailable for signal', { error, symbol: signal.symbol });
  }

  // Confluence: netflow + gamma + signal direction
  let confluence = null;
  if (!rejectionReason && gexData && optionsFlow) {
    const callPremium = optionsFlow.entries
      .filter((e) => e.side === 'call')
      .reduce((s, e) => s + Number(e.premium || 0), 0);
    const putPremium = optionsFlow.entries
      .filter((e) => e.side === 'put')
      .reduce((s, e) => s + Number(e.premium || 0), 0);
    const netflow = callPremium - putPremium;
    const gammaRegime = confluenceService.getGammaRegime(gexData.dealerPosition);
    const signalDirection = signal.direction ?? null;
    confluence = confluenceService.computeConfluence({
      netflow,
      gammaRegime,
      signalDirection,
      flowEntriesCount: optionsFlow.entries?.length ?? 0,
    });

    const flowConfig = (await import('./flow-config.service.js')).getFlowConfigSync();
    if (flowConfig.enableConfluenceGate && !confluence.tradeGatePasses) {
      rejectionReason = 'confluence_below_threshold';
      riskResult.confluenceRejection = {
        score: confluence.score,
        threshold: flowConfig.confluenceMinThreshold,
      };
      logger.info('Confluence gate rejected signal', {
        symbol: signal.symbol,
        direction: signal.direction,
        score: confluence.score,
        threshold: flowConfig.confluenceMinThreshold,
        gap: flowConfig.confluenceMinThreshold - confluence.score,
      });
    }
  }

  const enrichedData = {
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    currentPrice,
    indicators,
    candlesCount: candles.length,
    gex: gexData,
    optionsFlow,
    confluence,
  };

  return { enrichedData, riskResult, rejectionReason, queueUntil, queueReason, decisionOnly };
}
