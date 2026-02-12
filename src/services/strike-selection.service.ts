import { marketData } from './market-data.js';
import { config } from '../config/index.js';
import * as Sentry from '@sentry/node';

export type StrikeSelection = {
  strike: number;
  expiration: Date;
  optionType: 'call' | 'put';
};

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

export async function selectStrike(symbol: string, direction: 'long' | 'short'): Promise<StrikeSelection> {
  try {
    Sentry.addBreadcrumb({
      category: 'strike-selection',
      message: 'Strike selection start',
      level: 'info',
      data: { symbol, direction },
    });
    const price = await marketData.getStockPrice(symbol);
    const strike = calculateStrike(price, direction);
    const expiration = calculateExpiration(config.maxHoldDays);
    const optionType = direction === 'long' ? 'call' : 'put';
    Sentry.addBreadcrumb({
      category: 'strike-selection',
      message: 'Strike selection complete',
      level: 'info',
      data: { symbol, strike, expiration, optionType },
    });
    return { strike, expiration, optionType };
  } catch (error) {
    Sentry.captureException(error, {
      tags: { stage: 'strike_selection', symbol },
    });
    throw error;
  }
}
