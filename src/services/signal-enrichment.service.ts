import { db } from './database.service.js';
import { marketData } from './market-data.js';
import { positioningService } from './positioning.service.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export type SignalEnrichmentResult = {
  enrichedData: Record<string, any>;
  riskResult: Record<string, any>;
  rejectionReason: string | null;
};

type SignalLike = {
  signal_id: string;
  symbol: string;
  timeframe: string;
};

export async function buildSignalEnrichment(signal: SignalLike): Promise<SignalEnrichmentResult> {
  const riskResult: Record<string, any> = {};
  let rejectionReason: string | null = null;

  const isMarketOpen = await marketData.isMarketOpen();
  riskResult.marketOpen = isMarketOpen;
  if (!isMarketOpen) {
    rejectionReason = 'market_closed';
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

  if (!rejectionReason && openPositions >= config.maxOpenPositions) {
    rejectionReason = 'max_open_positions_exceeded';
  }

  if (
    !rejectionReason &&
    riskLimit.max_positions_per_symbol &&
    openSymbolPositions >= riskLimit.max_positions_per_symbol
  ) {
    rejectionReason = 'max_positions_per_symbol_exceeded';
  }

  const candles = await marketData.getCandles(signal.symbol, signal.timeframe, 200);
  const indicators = await marketData.getIndicators(signal.symbol, signal.timeframe);
  const currentPrice = await marketData.getStockPrice(signal.symbol);

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

  return { enrichedData, riskResult, rejectionReason };
}
