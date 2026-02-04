import type { Greeks, SetupType } from '../shared/types.js';
import type { RuleResult } from './types.js';

export function checkDeltaDecay(deltaAtEntry: number, deltaNow: number, setupType: SetupType): RuleResult | null {
  if (!deltaAtEntry) return null;
  const decayPercent = ((deltaAtEntry - deltaNow) / deltaAtEntry) * 100;
  const thresholds: Record<SetupType, number> = {
    SCALP_GUARDED: 20,
    SWING: 30,
    POSITION: 40,
    LEAPS: 50,
  };
  if (decayPercent >= thresholds[setupType]) {
    return {
      tier: 4,
      rule: 'DELTA_DECAY',
      triggered: true,
      message: `Delta decayed ${decayPercent.toFixed(1)}%`,
    };
  }
  return null;
}

export function checkGammaStall(gammaAtEntry: number, gammaNow: number, setupType: SetupType): RuleResult | null {
  if (setupType !== 'SCALP_GUARDED' && setupType !== 'SWING') {
    return null;
  }
  if (!gammaAtEntry) return null;
  const gammaDropPercent = ((gammaAtEntry - gammaNow) / gammaAtEntry) * 100;
  if (gammaDropPercent >= 50) {
    return {
      tier: 4,
      rule: 'GAMMA_STALL',
      triggered: true,
      message: `Gamma dropped ${gammaDropPercent.toFixed(1)}%`,
    };
  }
  return null;
}

export function checkThetaAcceleration(
  thetaAtEntry: number,
  thetaNow: number,
  dteAtEntry: number,
  dteNow: number
): RuleResult | null {
  if (!dteAtEntry) return null;
  const expectedTheta = thetaAtEntry * (dteNow / dteAtEntry);
  const actualTheta = Math.abs(thetaNow);
  const expectedThetaAbs = Math.abs(expectedTheta);
  if (actualTheta > expectedThetaAbs * 1.5) {
    return {
      tier: 4,
      rule: 'THETA_ACCELERATION',
      triggered: true,
      message: `Theta accelerating: ${actualTheta.toFixed(3)} vs expected ${expectedThetaAbs.toFixed(3)}`,
    };
  }
  return null;
}

export function checkVegaIVShock(
  vegaNow: number,
  ivAtEntry: number,
  ivNow: number
): RuleResult | null {
  if (!ivAtEntry) return null;
  const ivDropPercent = ((ivAtEntry - ivNow) / ivAtEntry) * 100;
  if (ivDropPercent >= 30 && vegaNow >= 0.15) {
    return {
      tier: 4,
      rule: 'VEGA_IV_SHOCK',
      triggered: true,
      message: `IV dropped ${ivDropPercent.toFixed(1)}% with high vega`,
    };
  }

  const ivSpikePercent = ((ivNow - ivAtEntry) / ivAtEntry) * 100;
  if (ivSpikePercent >= 50) {
    return {
      tier: 3,
      rule: 'VEGA_IV_SPIKE',
      triggered: true,
      message: `IV increased ${ivSpikePercent.toFixed(1)}%`,
    };
  }
  return null;
}

export function analyzeGreeks(
  greeksAtEntry: Greeks,
  greeksNow: Greeks,
  dteAtEntry: number,
  dteNow: number,
  setupType: SetupType,
  ivAtEntry: number,
  ivNow: number
): RuleResult[] {
  const rules = [
    checkDeltaDecay(greeksAtEntry.delta, greeksNow.delta, setupType),
    checkGammaStall(greeksAtEntry.gamma, greeksNow.gamma, setupType),
    checkThetaAcceleration(greeksAtEntry.theta, greeksNow.theta, dteAtEntry, dteNow),
    checkVegaIVShock(greeksNow.vega, ivAtEntry, ivNow),
  ];
  return rules.filter((rule): rule is RuleResult => Boolean(rule));
}
