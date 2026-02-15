/**
 * Bias Conflict Resolver - Multi-source weighted merge.
 * stateBySource: MTF_BIAS_ENGINE_V3, GAMMA_SERVICE (stub for flow).
 * Weights configurable via mergeWeights.
 */

import type { UnifiedBiasState, UnifiedGammaContext } from '../../lib/mtfBias/types-v3.js';

export const MTF_SOURCE = 'MTF_BIAS_ENGINE_V3';
export const GAMMA_SOURCE = 'GAMMA_SERVICE';

export interface StatesBySource {
  [source: string]: UnifiedBiasState;
}

/** Gamma can contribute biasScore via gamma context on the state */
export interface MergeWeights {
  mtfWeight: number;
  gammaWeight: number;
}

const DEFAULT_WEIGHTS: MergeWeights = {
  mtfWeight: 0.7,
  gammaWeight: 0.3,
};

/** Map gamma environment to bias score (-100..100) */
function gammaToBiasScore(gamma?: UnifiedGammaContext | null): number {
  if (!gamma) return 0;
  switch (gamma.gammaEnvironment) {
    case 'POSITIVE':
      return 70;
    case 'NEGATIVE':
      return -70;
    default:
      return 0;
  }
}

/**
 * Merge states from multiple sources into canonical state.
 * Weighted merge: finalBiasScore = mtfBiasScore * mtfWeight + gammaBiasScore * gammaWeight.
 * Gamma score derived from state.gamma when present (MTF state already has gamma merged).
 */
export function mergeStatesBySource(
  statesBySource: StatesBySource,
  weights: Partial<MergeWeights> = {}
): UnifiedBiasState | null {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const sources = Object.keys(statesBySource);
  if (sources.length === 0) return null;

  const mtf = statesBySource[MTF_SOURCE];
  const gammaState = statesBySource[GAMMA_SOURCE];

  if (sources.length === 1) return statesBySource[sources[0]];

  if (!mtf) return gammaState ?? statesBySource[sources[0]];

  const mtfBiasScore = mtf.biasScore ?? 0;
  const gammaBiasScore = gammaState
    ? (gammaState.biasScore ?? gammaToBiasScore(gammaState.gamma))
    : gammaToBiasScore(mtf.gamma);
  const finalBiasScore = mtfBiasScore * w.mtfWeight + gammaBiasScore * w.gammaWeight;

  return {
    ...mtf,
    biasScore: Math.round(finalBiasScore * 100) / 100,
    source: gammaState ? `${MTF_SOURCE}+${GAMMA_SOURCE}` : mtf.source,
  };
}
