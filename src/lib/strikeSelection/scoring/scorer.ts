import type { OptionContract, StrikeSelectionInput } from '../types.js';
import { SCORING_WEIGHTS } from '../../shared/constants.js';
import { getSpreadPercent } from '../filters/liquidityFilter.js';
import { gammaPenaltyFactor, thetaSurvivabilityScore, vegaPenaltyFactor } from '../filters/greeksFilter.js';

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreLiquidity(contract: OptionContract, setupType: StrikeSelectionInput['setupType']): number {
  const spread = getSpreadPercent(contract);
  const spreadScore = clampScore(100 - spread * 4);
  const oiScore = clampScore(Math.min(100, (contract.openInterest / (setupType === 'SCALP_GUARDED' ? 1000 : 300)) * 100));
  const volumeScore = clampScore(Math.min(100, (contract.volume / (setupType === 'SCALP_GUARDED' ? 500 : 100)) * 100));
  return clampScore((spreadScore + oiScore + volumeScore) / 3);
}

function scoreGreeksStability(contract: OptionContract, input: StrikeSelectionInput): number {
  const delta = Math.abs(contract.greeks.delta);
  const deltaTarget = input.setupType === 'SCALP_GUARDED' ? 0.55 : input.setupType === 'SWING' ? 0.325 : input.setupType === 'POSITION' ? 0.275 : 0.225;
  const deltaScore = clampScore(100 - Math.abs(delta - deltaTarget) * 200);
  const gammaFactor = gammaPenaltyFactor(contract.greeks.gamma, input.setupType);
  return clampScore(deltaScore * gammaFactor);
}

function scoreVegaAlignment(contract: OptionContract, ivPercentile: number): number {
  const vegaFactor = vegaPenaltyFactor(contract.greeks.vega, ivPercentile);
  return clampScore(100 * vegaFactor);
}

function scoreCostEfficiency(contract: OptionContract, input: StrikeSelectionInput): number {
  const cost = contract.mid;
  const maxPremium = input.riskBudget.maxPremiumLoss;
  if (!maxPremium) return 50;
  const ratio = Math.min(1, maxPremium / Math.max(cost, 0.01));
  return clampScore(ratio * 100);
}

function scoreGexSuitability(input: StrikeSelectionInput): number {
  if (input.gexState === 'POSITIVE_HIGH' && input.direction === 'CALL') {
    return 40;
  }
  if (input.gexState === 'NEGATIVE_HIGH' && input.direction === 'PUT') {
    return 40;
  }
  if (input.gexState === 'NEUTRAL') {
    return 80;
  }
  return 60;
}

export function scoreContract(contract: OptionContract, input: StrikeSelectionInput): {
  overall: number;
  breakdown: {
    liquidityFitness: number;
    greeksStability: number;
    thetaSurvivability: number;
    vegaIVAlignment: number;
    costEfficiency: number;
    gexSuitability: number;
  };
} {
  const weights = SCORING_WEIGHTS[input.setupType];
  const breakdown = {
    liquidityFitness: scoreLiquidity(contract, input.setupType),
    greeksStability: scoreGreeksStability(contract, input),
    thetaSurvivability: thetaSurvivabilityScore(
      contract.greeks.theta,
      contract.mid,
      input.expectedHoldTime,
      input.setupType
    ),
    vegaIVAlignment: scoreVegaAlignment(contract, input.ivPercentile),
    costEfficiency: scoreCostEfficiency(contract, input),
    gexSuitability: scoreGexSuitability(input),
  };

  const weightedScore = Object.entries(breakdown).reduce((total, [key, score]) => {
    return total + score * weights[key as keyof typeof breakdown];
  }, 0);

  return {
    overall: clampScore(weightedScore),
    breakdown,
  };
}
