import type { StrategyCandidate, UDCSignal } from '../types.js';

/**
 * Failed-2 strategy: identifies failed second attempts at breakout/breakdown.
 * Pure evaluation — no portfolio or execution logic.
 */
export function evaluateFailed2(signal: UDCSignal): StrategyCandidate | null {
  const pattern = (signal.pattern ?? '').toLowerCase();
  const direction = signal.direction?.toLowerCase();

  const isFailed2Pattern =
    pattern.includes('failed') ||
    pattern.includes('f2') ||
    pattern.includes('failed_2');

  if (!isFailed2Pattern) {
    return null;
  }

  const isBull = direction === 'long' || direction === 'bull' || direction === 'bullish';
  const tradeDirection = isBull ? 'BULL' as const : 'BEAR' as const;
  const confidence = signal.confidence ?? 0.6;

  return {
    intent: {
      strategy: 'FAILED_2',
      symbol: signal.symbol,
      direction: tradeDirection,
      structure: tradeDirection === 'BULL' ? 'LONG_CALL' : 'LONG_PUT',
      invalidation: 0,
      dteMin: 5,
      dteMax: 21,
      confidence,
    },
    confidence,
  };
}
