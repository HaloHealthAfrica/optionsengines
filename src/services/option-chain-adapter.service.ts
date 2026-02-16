/**
 * Option Chain Adapter - transforms MarketDataOptionRow[] into OptionContract[]
 * with Black-Scholes approximated Greeks when providers don't return them.
 */

import type { MarketDataOptionRow } from './providers/marketdata-client.js';
import type { OptionContract } from '../lib/strikeSelection/types.js';
import { logger } from '../utils/logger.js';

/** Cumulative standard normal distribution approximation (Abramowitz & Stegun) */
function cdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);
  return 0.5 * (1.0 + sign * y);
}

/** Standard normal PDF */
function pdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Black-Scholes Greeks approximation */
function approximateGreeks(
  spotPrice: number,
  strike: number,
  dteYears: number,
  iv: number,
  optionType: 'call' | 'put',
  riskFreeRate = 0.05
): { delta: number; gamma: number; theta: number; vega: number } {
  if (dteYears <= 0 || iv <= 0 || spotPrice <= 0 || strike <= 0) {
    return { delta: optionType === 'call' ? 0.5 : -0.5, gamma: 0, theta: 0, vega: 0 };
  }

  const sqrtT = Math.sqrt(dteYears);
  const d1 = (Math.log(spotPrice / strike) + (riskFreeRate + 0.5 * iv * iv) * dteYears) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;

  const callDelta = cdf(d1);
  const gamma = pdf(d1) / (spotPrice * iv * sqrtT);
  // Theta per day (negative for long options)
  const theta = (-(spotPrice * pdf(d1) * iv) / (2 * sqrtT) - riskFreeRate * strike * Math.exp(-riskFreeRate * dteYears) * cdf(d2)) / 365;
  const vega = spotPrice * pdf(d1) * sqrtT / 100; // per 1% IV change

  const delta = optionType === 'call' ? callDelta : callDelta - 1;

  return { delta, gamma, theta, vega };
}

/** Estimate IV from option mid price using bisection (rough approximation) */
function estimateIV(
  spotPrice: number,
  strike: number,
  dteYears: number,
  mid: number,
  optionType: 'call' | 'put',
  riskFreeRate = 0.05
): number {
  if (dteYears <= 0 || mid <= 0) return 0.3; // default 30%

  let low = 0.01;
  let high = 3.0;

  for (let i = 0; i < 20; i++) {
    const ivGuess = (low + high) / 2;
    const sqrtT = Math.sqrt(dteYears);
    const d1 = (Math.log(spotPrice / strike) + (riskFreeRate + 0.5 * ivGuess * ivGuess) * dteYears) / (ivGuess * sqrtT);
    const d2 = d1 - ivGuess * sqrtT;

    let price: number;
    if (optionType === 'call') {
      price = spotPrice * cdf(d1) - strike * Math.exp(-riskFreeRate * dteYears) * cdf(d2);
    } else {
      price = strike * Math.exp(-riskFreeRate * dteYears) * cdf(-d2) - spotPrice * cdf(-d1);
    }

    if (price > mid) {
      high = ivGuess;
    } else {
      low = ivGuess;
    }
  }

  return (low + high) / 2;
}

/**
 * Transform MarketDataOptionRow[] into OptionContract[] suitable for the advanced
 * strike selection framework. Approximates Greeks via Black-Scholes when not provided.
 */
export function adaptOptionChain(
  rows: MarketDataOptionRow[],
  spotPrice: number,
  direction: 'call' | 'put'
): OptionContract[] {
  const now = new Date();
  const contracts: OptionContract[] = [];

  for (const row of rows) {
    if (row.optionType !== direction) continue;
    if (!row.expiration || !Number.isFinite(row.strike)) continue;

    const expiryDate = new Date(row.expiration);
    const dte = Math.max(0, Math.ceil((expiryDate.getTime() - now.getTime()) / 86400000));
    if (dte <= 0) continue;

    const dteYears = dte / 365;

    // Use premium as a proxy for mid price if bid/ask not available
    const mid = Number(row.premium) || 0;
    if (mid <= 0) continue;

    // Estimate IV from the mid price
    const iv = estimateIV(spotPrice, row.strike, dteYears, mid, direction);

    // Approximate Greeks
    const greeks = approximateGreeks(spotPrice, row.strike, dteYears, iv, direction);

    // Estimate bid/ask from mid with a rough 2-5% spread
    const spreadFraction = mid > 1 ? 0.02 : 0.05;
    const halfSpread = mid * spreadFraction;

    contracts.push({
      expiry: row.expiration,
      dte,
      strike: row.strike,
      bid: Math.max(0.01, mid - halfSpread),
      ask: mid + halfSpread,
      mid,
      openInterest: Number(row.openInterest ?? 0),
      volume: Number(row.volume ?? 0),
      greeks,
      iv,
    });
  }

  logger.debug('Option chain adapted', {
    inputRows: rows.length,
    outputContracts: contracts.length,
    direction,
  });

  return contracts;
}
