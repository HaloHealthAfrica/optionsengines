import { marketData } from './market-data.js';
import * as Sentry from '@sentry/node';

export type EntryExitPlan = {
  entryPrice: number;
};

export async function buildEntryExitPlan(
  symbol: string,
  strike: number,
  expiration: Date,
  optionType: 'call' | 'put'
): Promise<EntryExitPlan> {
  const entryPrice = await marketData.getOptionPrice(symbol, strike, expiration, optionType);
  if (entryPrice == null || !Number.isFinite(entryPrice)) {
    const err = new Error('Option price unavailable');
    Sentry.captureException(err, {
      tags: { service: 'entry-exit-agent' },
      extra: { symbol, strike, expiration: expiration.toISOString(), optionType },
    });
    throw err;
  }
  return { entryPrice };
}
