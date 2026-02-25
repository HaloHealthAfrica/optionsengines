import type { StrategyCandidate, UDCSignal } from '../types.js';

const INTRADAY_INVALIDATION_PCT = 0.010;
const SWING_INVALIDATION_PCT = 0.015;
const INTRADAY_TIMEFRAMES = new Set(['1', '3', '5', '15']);

/**
 * Opening Range Breakout strategy: identifies ORB setups.
 * Pure evaluation — no portfolio or execution logic.
 */
export function evaluateORB(signal: UDCSignal): StrategyCandidate | null {
  const pattern = (signal.pattern ?? '').toLowerCase();
  const direction = signal.direction?.toLowerCase();

  const isORBPattern =
    pattern.includes('orb') ||
    pattern.includes('opening_range') ||
    pattern.includes('openingrange');

  if (!isORBPattern) {
    return null;
  }

  const isBull = direction === 'long' || direction === 'bull' || direction === 'bullish';
  const tradeDirection = isBull ? 'BULL' as const : 'BEAR' as const;
  const confidence = signal.confidence ?? 0.55;
  const isIntraday = INTRADAY_TIMEFRAMES.has(signal.timeframe);

  const invalidation = resolveInvalidation(signal, isBull, isIntraday);

  return {
    intent: {
      strategy: 'ORB',
      symbol: signal.symbol,
      direction: tradeDirection,
      structure: tradeDirection === 'BULL' ? 'LONG_CALL' : 'LONG_PUT',
      invalidation,
      dteMin: 1,
      dteMax: 7,
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
