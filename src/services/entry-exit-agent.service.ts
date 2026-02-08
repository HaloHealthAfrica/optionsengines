import { marketData } from './market-data.js';

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
  return { entryPrice };
}
