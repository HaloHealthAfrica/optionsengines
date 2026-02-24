import type { StrategyCandidate, UDCSignal } from './types.js';
import { evaluateFailed2 } from './strategy-modules/failed2.module.js';
import { evaluateORB } from './strategy-modules/orb.module.js';
import { evaluateMomentum } from './strategy-modules/momentum.module.js';
import { evaluateReversal } from './strategy-modules/reversal.module.js';
import { evaluateStrat } from './strategy-modules/strat.module.js';
import { evaluateSatyland } from './strategy-modules/satyland.module.js';

/**
 * Deterministic strategy router.
 * Evaluates all strategy modules and returns the highest-confidence candidate.
 * No portfolio logic. No execution logic.
 */
export function strategyRouter(signal: UDCSignal): StrategyCandidate | null {
  const candidates: StrategyCandidate[] = [
    evaluateStrat(signal),
    evaluateSatyland(signal),
    evaluateFailed2(signal),
    evaluateORB(signal),
    evaluateMomentum(signal),
    evaluateReversal(signal),
  ].filter((c): c is StrategyCandidate => c !== null);

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.confidence - a.confidence);

  return candidates[0];
}
