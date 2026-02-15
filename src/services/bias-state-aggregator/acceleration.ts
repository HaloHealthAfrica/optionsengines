/**
 * Acceleration - Computes stateStrengthDelta, intentMomentumDelta, macroDriftScore.
 */

import type { UnifiedBiasState, BiasAcceleration } from '../../lib/mtfBias/types-v3.js';

/** Compute acceleration deltas from prev vs curr */
export function computeAcceleration(
  prev: UnifiedBiasState | null,
  curr: UnifiedBiasState,
  macroFlip: boolean
): BiasAcceleration {
  if (!prev) {
    return {
      stateStrengthDelta: 0,
      intentMomentumDelta: 0,
      macroDriftScore: 0,
    };
  }

  const stateStrengthDelta = curr.biasScore - prev.biasScore;
  const intentMomentumDelta = curr.intentConfidence - prev.intentConfidence;
  const macroConfDelta = curr.macroConfidence - prev.macroConfidence;
  const macroDriftScore = macroConfDelta + (macroFlip ? 0.15 : 0);

  return {
    stateStrengthDelta,
    intentMomentumDelta,
    macroDriftScore,
  };
}
