/**
 * Gamma Merge - Merges gamma context into UnifiedBiasState.
 * Used by BiasStateAggregator and gamma stream consumer.
 */

import type { UnifiedBiasState, UnifiedGammaContext } from '../../lib/mtfBias/types-v3.js';
import type { GammaContextNormalizedV1 } from '../../lib/gammaContext/schemas.js';

/** Merge gamma context into unified state. Returns new state with gamma block. */
export function mergeGammaIntoState(
  state: UnifiedBiasState,
  gamma: GammaContextNormalizedV1
): UnifiedBiasState {
  const gammaContext: UnifiedGammaContext = {
    gammaEnvironment: gamma.gamma_environment,
    gammaMagnitude: gamma.gamma_magnitude,
    gammaFlipLevel: gamma.gamma_flip_level,
    distanceToFlip: gamma.distance_to_flip,
    callWall: gamma.call_wall,
    putWall: gamma.put_wall,
    volRegimeBias: gamma.vol_regime_bias,
    gammaUpdatedAtMs: gamma.as_of_ts_ms,
  };

  return {
    ...state,
    gamma: gammaContext,
  };
}
