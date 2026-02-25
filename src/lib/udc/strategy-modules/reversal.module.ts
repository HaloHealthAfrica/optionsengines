import type { StrategyCandidate, UDCSignal } from '../types.js';

const INTRADAY_INVALIDATION_PCT = 0.015;
const SWING_INVALIDATION_PCT = 0.030;
const INTRADAY_TIMEFRAMES = new Set(['1', '3', '5', '15']);

/**
 * Reversal / mean-reversion strategy: counter-trend entries at extremes.
 * Matches patterns: reversal, scalp_rev, mean_rev, exhaustion, divergence, climax.
 *
 * Reversals get wider invalidation than momentum (higher adverse move tolerance)
 * and shorter DTE windows (faster time-decay capture).
 */
export function evaluateReversal(signal: UDCSignal): StrategyCandidate | null {
  const pattern = (signal.pattern ?? '').toLowerCase();
  const direction = signal.direction?.toLowerCase();

  const isReversalPattern =
    pattern.includes('reversal') ||
    pattern.includes('scalp_rev') ||
    pattern === 'scalp' ||
    pattern.includes('mean_rev') ||
    pattern.includes('exhaustion') ||
    pattern.includes('divergence') ||
    pattern.includes('climax');

  if (!isReversalPattern) {
    return null;
  }

  const isBull = direction === 'long' || direction === 'bull' || direction === 'bullish';
  const tradeDirection = isBull ? 'BULL' as const : 'BEAR' as const;
  const baseConfidence = signal.confidence ?? 0.50;
  const isIntraday = INTRADAY_TIMEFRAMES.has(signal.timeframe);

  const invalidation = resolveInvalidation(signal, isBull, isIntraday);

  return {
    intent: {
      strategy: 'REVERSAL',
      symbol: signal.symbol,
      direction: tradeDirection,
      structure: tradeDirection === 'BULL' ? 'LONG_CALL' : 'LONG_PUT',
      invalidation,
      dteMin: isIntraday ? 0 : 3,
      dteMax: isIntraday ? 5 : 14,
      confidence: baseConfidence,
    },
    confidence: baseConfidence,
  };
}

function resolveInvalidation(
  signal: UDCSignal,
  isBull: boolean,
  isIntraday: boolean,
): number {
  const raw = signal.raw_payload ?? {};

  const explicit = Number(raw.invalidation ?? raw.stop_loss ?? 0);
  if (explicit > 0) return explicit;

  const price = Number(raw.price ?? 0);
  if (price <= 0) return 0;

  const pct = isIntraday ? INTRADAY_INVALIDATION_PCT : SWING_INVALIDATION_PCT;
  return Math.round(price * (isBull ? 1 - pct : 1 + pct) * 100) / 100;
}
