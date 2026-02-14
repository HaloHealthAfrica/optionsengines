/**
 * MTF Bias Strike Selection Adapter
 * Maps MTF state to delta/DTE bands:
 * - High confidence trend → 0.60–0.70 delta
 * - Medium → 0.45–0.55 delta
 * - Low → debit spreads
 * DTE: Intraday 0–3, Swing 7–21, High vol → extend
 */

import type { SymbolMarketState } from '../../lib/mtfBias/types.js';

export interface StrikeSelectionHint {
  deltaMin: number;
  deltaMax: number;
  dteMin: number;
  dteMax: number;
  structure: 'single' | 'spread';
}

export function getStrikeSelectionHint(state: SymbolMarketState): StrikeSelectionHint {
  const conf = state.confidence_score;
  const regime = state.regime_type;

  if (conf >= 0.7 && regime === 'TREND') {
    return {
      deltaMin: 0.6,
      deltaMax: 0.7,
      dteMin: 7,
      dteMax: 21,
      structure: 'single',
    };
  }

  if (conf >= 0.55) {
    return {
      deltaMin: 0.45,
      deltaMax: 0.55,
      dteMin: 7,
      dteMax: 21,
      structure: 'single',
    };
  }

  return {
    deltaMin: 0.4,
    deltaMax: 0.5,
    dteMin: 3,
    dteMax: 14,
    structure: 'spread',
  };
}
