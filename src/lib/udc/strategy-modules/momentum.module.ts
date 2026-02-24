import type { StrategyCandidate, UDCSignal } from '../types.js';

const INTRADAY_INVALIDATION_PCT = 0.010;
const SWING_INVALIDATION_PCT = 0.020;
const INTRADAY_TIMEFRAMES = new Set(['1', '3', '5', '15']);

/**
 * Momentum strategy: trend-following entries on strong directional moves.
 * Matches patterns: momentum, trend_cont, trend_start, breakout, continuation.
 */
export function evaluateMomentum(signal: UDCSignal): StrategyCandidate | null {
  const pattern = (signal.pattern ?? '').toLowerCase();
  const direction = signal.direction?.toLowerCase();

  const isMomentumPattern =
    pattern.includes('momentum') ||
    pattern.includes('trend_cont') ||
    pattern.includes('trend_start') ||
    pattern.includes('breakout') ||
    pattern.includes('continuation') ||
    pattern.includes('impulse');

  if (!isMomentumPattern) {
    return null;
  }

  const isBull = direction === 'long' || direction === 'bull' || direction === 'bullish';
  const tradeDirection = isBull ? 'BULL' as const : 'BEAR' as const;
  const confidence = signal.confidence ?? 0.55;
  const isIntraday = INTRADAY_TIMEFRAMES.has(signal.timeframe);

  const invalidation = resolveInvalidation(signal, isBull, isIntraday);

  return {
    intent: {
      strategy: 'MOMENTUM',
      symbol: signal.symbol,
      direction: tradeDirection,
      structure: tradeDirection === 'BULL' ? 'LONG_CALL' : 'LONG_PUT',
      invalidation,
      dteMin: isIntraday ? 1 : 7,
      dteMax: isIntraday ? 7 : 30,
      confidence,
    },
    confidence,
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
