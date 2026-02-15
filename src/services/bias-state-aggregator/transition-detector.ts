/**
 * Transition Detector - Compares previous vs current state to detect transitions.
 */

import type { UnifiedBiasState } from '../../lib/mtfBias/types-v3.js';

export interface TransitionInput {
  prev: UnifiedBiasState | null;
  curr: UnifiedBiasState;
}

/** Detect transitions between previous and current state */
export function detectTransitions(input: TransitionInput): UnifiedBiasState['transitions'] {
  const { prev, curr } = input;

  if (!prev) {
    return {
      biasFlip: false,
      regimeFlip: false,
      macroFlip: false,
      intentChange: false,
      liquidityEvent: curr.liquidity.reclaim || curr.liquidity.sweepHigh || curr.liquidity.sweepLow,
      expansionEvent: false,
      compressionEvent: false,
    };
  }

  const biasFlip =
    (prev.bias === 'BULLISH' && curr.bias === 'BEARISH') ||
    (prev.bias === 'BEARISH' && curr.bias === 'BULLISH');

  const regimeFlip = prev.regimeType !== curr.regimeType;

  const macroFlip = prev.macroClass !== curr.macroClass;

  const intentChange = prev.intentType !== curr.intentType;

  const liquidityEvent =
    (!prev.liquidity.reclaim && curr.liquidity.reclaim) ||
    (!prev.liquidity.sweepHigh && curr.liquidity.sweepHigh) ||
    (!prev.liquidity.sweepLow && curr.liquidity.sweepLow);

  const expansionEvent =
    curr.regimeTransition &&
    curr.chopScore < (prev.chopScore ?? 100) - 10 &&
    (curr.atrState15m === 'EXPANDING' || !curr.atrState15m);

  const compressionEvent =
    curr.intentType === 'COMPRESSION' && (curr.chopScore ?? 0) >= 70;

  return {
    biasFlip,
    regimeFlip,
    macroFlip,
    intentChange,
    liquidityEvent,
    expansionEvent,
    compressionEvent,
  };
}
