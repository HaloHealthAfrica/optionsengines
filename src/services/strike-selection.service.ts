import { marketData } from './market-data.js';
import { config } from '../config/index.js';
import { DTE_POLICY } from '../lib/shared/constants.js';
import type { SetupType } from '../lib/shared/types.js';
import * as Sentry from '@sentry/node';

export type StrikeSelection = {
  strike: number;
  expiration: Date;
  optionType: 'call' | 'put';
};

/** Align date to next Friday (weekly options expiry) */
function nextFriday(from: Date): Date {
  const d = new Date(from);
  const day = d.getUTCDay();
  const daysUntilFriday = (5 - day + 7) % 7;
  const addDays = daysUntilFriday === 0 ? 7 : daysUntilFriday;
  d.setUTCDate(d.getUTCDate() + addDays);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Calculate expiration using DTE policy for the given setupType.
 * Falls back to SWING when setupType is not provided.
 */
export function calculateExpiration(setupType: SetupType = 'SWING'): Date {
  const policy = DTE_POLICY[setupType] ?? DTE_POLICY.SWING;
  const preferred = policy.preferred ?? [Math.floor((policy.min + policy.max) / 2)];
  let targetDte = config.maxHoldDays > 0
    ? Math.min(policy.max, Math.max(policy.min, config.maxHoldDays))
    : Math.min(policy.max, Math.max(policy.min, preferred[0]));
  if (config.minDteEntry > 0) {
    targetDte = Math.max(targetDte, config.minDteEntry);
  }
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + targetDte);
  return nextFriday(base);
}

function calculateStrike(price: number, direction: 'long' | 'short'): number {
  return direction === 'long' ? Math.ceil(price) : Math.floor(price);
}

export async function selectStrike(
  symbol: string,
  direction: 'long' | 'short',
  setupType: SetupType = 'SWING'
): Promise<StrikeSelection> {
  try {
    Sentry.addBreadcrumb({
      category: 'strike-selection',
      message: 'Strike selection start',
      level: 'info',
      data: { symbol, direction, setupType },
    });
    const price = await marketData.getStockPrice(symbol);
    const strike = calculateStrike(price, direction);
    const expiration = calculateExpiration(setupType);
    const optionType = direction === 'long' ? 'call' : 'put';
    Sentry.addBreadcrumb({
      category: 'strike-selection',
      message: 'Strike selection complete',
      level: 'info',
      data: { symbol, strike, expiration, optionType, setupType },
    });
    return { strike, expiration, optionType };
  } catch (error) {
    Sentry.captureException(error, {
      tags: { stage: 'strike_selection', symbol },
    });
    throw error;
  }
}
