import type { OptionContract, StrikeSelectionInput } from '../types.js';
import { DELTA_RANGES } from '../../shared/constants.js';

function thetaSurvivable(theta: number, premium: number, holdMinutes: number, setupType: StrikeSelectionInput['setupType']): boolean {
  const holdDays = Math.max(1, holdMinutes / (60 * 24));
  const dailyDecay = Math.abs(theta);
  const totalDecay = dailyDecay * holdDays;
  const decayPercent = premium ? (totalDecay / premium) * 100 : 100;

  const tolerance: Record<StrikeSelectionInput['setupType'], number> = {
    SCALP_GUARDED: 20,
    SWING: 30,
    POSITION: 40,
    LEAPS: 50,
  };

  return decayPercent <= tolerance[setupType];
}

export function filterByGreeks(input: StrikeSelectionInput, contracts: OptionContract[]): OptionContract[] {
  const deltaRange = DELTA_RANGES[input.setupType];
  return contracts.filter((contract) => {
    const delta = Math.abs(contract.greeks.delta);
    if (delta < deltaRange.min || delta > deltaRange.max) {
      return false;
    }
    if (!thetaSurvivable(contract.greeks.theta, contract.mid, input.expectedHoldTime, input.setupType)) {
      return false;
    }
    return true;
  });
}

export function gammaPenaltyFactor(gamma: number, setupType: StrikeSelectionInput['setupType']): number {
  if (setupType === 'SCALP_GUARDED') {
    return gamma <= 0.05 ? 1 : 0.6;
  }
  return gamma <= 0.02 ? 1 : 0.6;
}

export function vegaPenaltyFactor(vega: number, ivPercentile: number): number {
  if (ivPercentile > 70) {
    return vega <= 0.15 ? 1 : 0.6;
  }
  return 1;
}

export function thetaSurvivabilityScore(
  theta: number,
  premium: number,
  holdMinutes: number,
  setupType: StrikeSelectionInput['setupType']
): number {
  const holdDays = Math.max(1, holdMinutes / (60 * 24));
  const dailyDecay = Math.abs(theta);
  const totalDecay = dailyDecay * holdDays;
  const decayPercent = premium ? (totalDecay / premium) * 100 : 100;

  const tolerance: Record<StrikeSelectionInput['setupType'], number> = {
    SCALP_GUARDED: 20,
    SWING: 30,
    POSITION: 40,
    LEAPS: 50,
  };

  const maxTolerance = tolerance[setupType];
  const score = Math.max(0, 100 - (decayPercent / maxTolerance) * 100);
  return Math.min(100, Math.round(score));
}
