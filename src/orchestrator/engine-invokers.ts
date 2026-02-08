/**
 * Engine invokers - bridge orchestrator to decision engines.
 */

import { marketData } from '../services/market-data.js';
import { config } from '../config/index.js';
import { TradeRecommendation, Signal, MarketContext } from './types.js';
import { logger } from '../utils/logger.js';

function calculateExpiration(dteDays: number): Date {
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + dteDays);
  const day = base.getUTCDay();
  const daysUntilFriday = (5 - day + 7) % 7;
  base.setUTCDate(base.getUTCDate() + daysUntilFriday);
  base.setUTCHours(0, 0, 0, 0);
  return base;
}

function calculateStrike(price: number, direction: 'long' | 'short'): number {
  return direction === 'long' ? Math.ceil(price) : Math.floor(price);
}

async function buildRecommendation(
  engine: 'A' | 'B',
  signal: Signal
): Promise<TradeRecommendation | null> {
  try {
    const price = await marketData.getStockPrice(signal.symbol);
    const strike = calculateStrike(price, signal.direction);
    const expiration = calculateExpiration(config.maxHoldDays);
    const optionType = signal.direction === 'long' ? 'call' : 'put';
    const optionPrice = await marketData.getOptionPrice(
      signal.symbol,
      strike,
      expiration,
      optionType
    );

    const quantity = Math.max(1, Math.floor(config.maxPositionSize));

    return {
      experiment_id: signal.experiment_id ?? '00000000-0000-0000-0000-000000000000',
      engine,
      symbol: signal.symbol,
      direction: signal.direction,
      strike,
      expiration,
      quantity,
      entry_price: optionPrice,
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
