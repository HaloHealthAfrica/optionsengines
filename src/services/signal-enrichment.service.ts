import { db } from './database.service.js';
import { marketData } from './market-data.js';
import { positioningService } from './positioning.service.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { evaluateMarketSession, normalizeMarketSession } from '../utils/market-session.js';

export type SignalEnrichmentResult = {
  enrichedData: Record<string, any>;
  riskResult: Record<string, any>;
  rejectionReason: string | null;
  queueUntil?: Date | null;
  queueReason?: string | null;
};

type SignalLike = {
  signal_id: string;
  symbol: string;
  timeframe: string;
  timestamp: Date | string;
  raw_payload?: Record<string, any> | null;
};

export async function buildSignalEnrichment(signal: SignalLike): Promise<SignalEnrichmentResult> {
  const riskResult: Record<string, any> = {};
  let rejectionReason: string | null = null;
  let queueUntil: Date | null = null;
  let queueReason: string | null = null;
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

  if (!isMarketOpen) {
    const signalAgeMinutes = (Date.now() - signalTimestamp.getTime()) / 60000;
    riskResult.signalAgeMinutes = Math.round(signalAgeMinutes * 10) / 10;
    if (signalAgeMinutes > config.signalMaxAgeMinutes) {
      rejectionReason = 'signal_stale';
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
    const closeCandidates = positionsToReview.rows.filter((row: any) => {
      const pnlPercent = Number(row.position_pnl_percent ?? 0);
      const hoursOpen =
        (now.getTime() - new Date(row.entry_timestamp).getTime()) / 3600000;

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

  try {
    currentPrice = await marketData.getStockPrice(signal.symbol);
  } catch (error) {
    logger.warn('Failed to fetch current price for enrichment', { error, symbol: signal.symbol });
    rejectionReason = rejectionReason || 'market_data_unavailable';
  }

  try {
    candles = await marketData.getCandles(signal.symbol, signal.timeframe, 200);
  } catch (error) {
    logger.warn('Failed to fetch candles for enrichment', { error, symbol: signal.symbol });
    rejectionReason = rejectionReason || 'market_data_unavailable';
  }

  try {
    indicators = await marketData.getIndicators(signal.symbol, signal.timeframe);
  } catch (error) {
    logger.warn('Failed to fetch indicators for enrichment', { error, symbol: signal.symbol });
    rejectionReason = rejectionReason || 'market_data_unavailable';
    indicators = {
      ema8: [currentPrice],
      ema21: [currentPrice],
      atr: [0],
      ttmSqueeze: { state: 'off', momentum: 0 },
    };
  }

  let gexData = null;
  let optionsFlow = null;
  try {
    gexData = await positioningService.getGexSnapshot(signal.symbol);
  } catch (error) {
    logger.warn('GEX data unavailable for signal', { error, symbol: signal.symbol });
  }
  try {
    optionsFlow = await positioningService.getOptionsFlowSnapshot(signal.symbol, 50);
  } catch (error) {
    logger.warn('Options flow data unavailable for signal', { error, symbol: signal.symbol });
  }

  const enrichedData = {
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    currentPrice,
    indicators,
    candlesCount: candles.length,
    gex: gexData,
    optionsFlow,
  };

  return { enrichedData, riskResult, rejectionReason, queueUntil, queueReason };
}
