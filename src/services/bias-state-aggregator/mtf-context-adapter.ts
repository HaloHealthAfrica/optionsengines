/**
 * MTF Context Adapter - Converts UnifiedBiasState to MTFBiasContext.
 * Engines can migrate gradually; eventually deprecate old interface.
 */

import type { UnifiedBiasState } from '../../lib/mtfBias/types-v3.js';
import type { MTFBiasContext } from '../mtf-bias/mtf-bias-state.service.js';

/** Adapt UnifiedBiasState to legacy MTFBiasContext */
export function adaptToMTFBiasContext(state: UnifiedBiasState): MTFBiasContext {
  const ctx: MTFBiasContext = {
    resolved_bias: state.bias,
    confidence_score: state.effective.effectiveConfidence,
    regime_type: state.regimeType,
    chop_score: state.chopScore,
    alignment_score: state.alignmentScore,
    conflict_score: state.conflictScore,
    vol_state: state.gamma?.volRegimeBias ?? 'UNKNOWN',
    space_to_move: null,
    invalidation_level: state.riskContext.invalidation.level,
    entry_mode_hint: state.riskContext.entryModeHint,
    vwap: state.levels.vwap.enabled
      ? { value: state.levels.vwap.value ?? 0, position: state.levels.vwap.position }
      : undefined,
    orb: state.levels.orb.enabled
      ? {
          high: state.levels.orb.high ?? 0,
          low: state.levels.orb.low ?? 0,
          state: state.levels.orb.state,
        }
      : undefined,
  };

  if (state.gamma) {
    ctx.gamma_environment = state.gamma.gammaEnvironment;
    ctx.gamma_magnitude = state.gamma.gammaMagnitude;
    ctx.gamma_flip_level = state.gamma.gammaFlipLevel;
    ctx.distance_to_flip = state.gamma.distanceToFlip;
    ctx.call_wall = state.gamma.callWall;
    ctx.put_wall = state.gamma.putWall;
    ctx.vol_regime_bias = state.gamma.volRegimeBias;
    ctx.gamma_updated_at = state.gamma.gammaUpdatedAtMs
      ? new Date(state.gamma.gammaUpdatedAtMs)
      : null;
  }

  return ctx;
}
