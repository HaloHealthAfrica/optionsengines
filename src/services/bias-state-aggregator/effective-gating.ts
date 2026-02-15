/**
 * Effective Gating - Computes tradeSuppressed, effectiveConfidence, riskMultiplier.
 * Config-driven with deterministic, explainable rules.
 */

import type { UnifiedBiasState, EffectiveGating } from '../../lib/mtfBias/types-v3.js';
import { getBiasGatingConfig } from './bias-config.service.js';

/** Compute effective gating outputs from state and config */
export async function computeEffectiveGating(
  state: Omit<UnifiedBiasState, 'effective'>
): Promise<EffectiveGating> {
  const config = await getBiasGatingConfig();
  const notes: string[] = [];
  let tradeSuppressed = false;
  let effectiveBiasScore = state.biasScore;
  let effectiveConfidence = state.confidence;
  let riskMultiplier = 1;

  // Macro vs intraday conflict: suppress longs when macro breakdown + bullish intraday
  if (
    config.macroSuppressLongClasses.includes(state.macroClass) &&
    state.bias === 'BULLISH'
  ) {
    tradeSuppressed = true;
    effectiveConfidence *= config.macroConflictRiskMultiplier;
    riskMultiplier = config.macroConflictRiskMultiplier;
    notes.push(`Macro ${state.macroClass} suppresses longs`);
  }

  // Macro vs intraday conflict: suppress shorts when macro trend up + bearish intraday
  if (
    config.macroSuppressShortClasses.includes(state.macroClass) &&
    state.bias === 'BEARISH'
  ) {
    tradeSuppressed = true;
    effectiveConfidence *= config.macroConflictRiskMultiplier;
    riskMultiplier = config.macroConflictRiskMultiplier;
    notes.push(`Macro ${state.macroClass} suppresses shorts`);
  }

  // Low space + breakout intent: reduce confidence
  if (
    state.space.roomToResistance === 'LOW' &&
    state.intentType === 'BREAKOUT'
  ) {
    effectiveConfidence -= config.breakoutLowSpacePenalty;
    notes.push('Low room to resistance + breakout intent reduces confidence');
  }
  if (
    state.space.roomToSupport === 'LOW' &&
    state.intentType === 'BREAKOUT'
  ) {
    effectiveConfidence -= config.breakoutLowSpacePenalty;
    notes.push('Low room to support + breakout intent reduces confidence');
  }

  // Reclaim: boost confidence
  if (state.liquidity.reclaim) {
    effectiveConfidence = Math.min(1, effectiveConfidence + config.reclaimBoost);
    notes.push('Liquidity reclaim boosts confidence');
  }

  // Regime transition: boost confidence
  if (state.regimeTransition) {
    effectiveConfidence = Math.min(1, effectiveConfidence + config.regimeTransitionBoost);
    notes.push('Regime transition boosts confidence');
  }

  // High chop: suppress unless reclaim + strong macro alignment
  if (state.chopScore >= config.chopSuppressionThreshold) {
    const hasReclaimAndAlignment =
      state.liquidity.reclaim &&
      ((state.macroClass === 'MACRO_TREND_UP' && state.bias === 'BULLISH') ||
        (state.macroClass === 'MACRO_TREND_DOWN' && state.bias === 'BEARISH'));
    if (!hasReclaimAndAlignment) {
      tradeSuppressed = true;
      effectiveConfidence *= 0.7;
      notes.push(`High chop (${state.chopScore}) suppresses trades`);
    }
  }

  effectiveConfidence = Math.max(0, Math.min(1, effectiveConfidence));
  effectiveBiasScore = Math.max(-100, Math.min(100, effectiveBiasScore));

  return {
    tradeSuppressed,
    effectiveBiasScore,
    effectiveConfidence,
    riskMultiplier,
    notes,
  };
}
