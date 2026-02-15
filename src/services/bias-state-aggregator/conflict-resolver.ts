/**
 * Bias Conflict Resolver - Stub for multi-source merge.
 * V1: Single source (MTF_BIAS_ENGINE_V3). Full implementation when gamma/flow exist.
 */

import type { UnifiedBiasState } from '../../lib/mtfBias/types-v3.js';

export interface StatesBySource {
  [source: string]: UnifiedBiasState;
}

/**
 * Merge states from multiple sources into canonical state.
 * Stub: when only one source, return it. Future: weighted merge.
 */
export function mergeStatesBySource(statesBySource: StatesBySource): UnifiedBiasState | null {
  const sources = Object.keys(statesBySource);
  if (sources.length === 0) return null;
  if (sources.length === 1) return statesBySource[sources[0]];

  // Multi-source: prefer MTF_BIAS_ENGINE_V3 for now
  const mtf = statesBySource['MTF_BIAS_ENGINE_V3'];
  if (mtf) return mtf;

  return statesBySource[sources[0]];
}
