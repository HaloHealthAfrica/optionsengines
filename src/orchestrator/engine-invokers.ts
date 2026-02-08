/**
 * Engine invokers - bridge orchestrator to decision engines.
 */

import { config } from '../config/index.js';
import { TradeRecommendation, Signal, MarketContext } from './types.js';
import { logger } from '../utils/logger.js';
import { selectStrike } from '../services/strike-selection.service.js';
import { buildEntryExitPlan } from '../services/entry-exit-agent.service.js';

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

export function createEngineAInvoker() {
  return async (signal: Signal, _context: MarketContext) =>
    buildRecommendation('A', signal);
}

export function createEngineBInvoker() {
  return async (signal: Signal, _context: MarketContext) =>
    buildRecommendation('B', signal);
}
