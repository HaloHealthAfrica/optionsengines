import type { StrategyCandidate, UDCSignal } from '../types.js';

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

  return {
    intent: {
      strategy: 'ORB',
      symbol: signal.symbol,
      direction: tradeDirection,
      structure: tradeDirection === 'BULL' ? 'LONG_CALL' : 'LONG_PUT',
      invalidation: 0,
      dteMin: 1,
      dteMax: 7,
      confidence,
    },
    confidence,
  };
}
