/**
 * Shared option contract utilities.
 * Canonical implementations — all call sites should import from here.
 */

/** Align a date to the next Friday (weekly options expiry). */
export function nextFriday(from: Date): Date {
  const d = new Date(from);
  const day = d.getUTCDay();
  const daysUntilFriday = (5 - day + 7) % 7;
  const addDays = daysUntilFriday === 0 ? 7 : daysUntilFriday;
  d.setUTCDate(d.getUTCDate() + addDays);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Calculate expiration date by adding DTE days and aligning to Friday. */
export function calculateExpiration(dteDays: number): Date {
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + dteDays);
  const day = base.getUTCDay();
  const daysUntilFriday = (5 - day + 7) % 7;
  base.setUTCDate(base.getUTCDate() + daysUntilFriday);
  base.setUTCHours(0, 0, 0, 0);
  return base;
}

/** Select a strike based on price and direction. */
export function calculateStrike(price: number, direction: 'long' | 'short'): number {
  return direction === 'long' ? Math.ceil(price) : Math.floor(price);
}

/** Build a standardized option symbol string. */
export function buildOptionSymbol(
  symbol: string,
  expiration: Date,
  type: 'call' | 'put',
  strike: number
): string {
  const yyyy = expiration.getUTCFullYear().toString();
  const mm = String(expiration.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(expiration.getUTCDate()).padStart(2, '0');
  return `${symbol}-${yyyy}${mm}${dd}-${type.toUpperCase()}-${strike.toFixed(2)}`;
}
