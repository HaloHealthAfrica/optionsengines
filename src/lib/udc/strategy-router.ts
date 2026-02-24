import type { StrategyCandidate, UDCSignal } from './types.js';
import { evaluateFailed2 } from './strategy-modules/failed2.module.js';
import { evaluateORB } from './strategy-modules/orb.module.js';

/**
 * Deterministic strategy router.
 * Evaluates all strategy modules and returns the highest-confidence candidate.
 * No portfolio logic. No execution logic.
 */
export function strategyRouter(signal: UDCSignal): StrategyCandidate | null {
  const candidates: StrategyCandidate[] = [
    evaluateFailed2(signal),
    evaluateORB(signal),
  ].filter((c): c is StrategyCandidate => c !== null);

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.confidence - a.confidence);

  return candidates[0];
}
