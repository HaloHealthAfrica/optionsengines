import type { GEXState, LiquidityState, SetupType } from './types.js';

export const ENTRY_MIN_CONFIDENCE: Record<SetupType, number> = {
  SCALP_GUARDED: 65,
  SWING: 60,
  POSITION: 55,
  LEAPS: 50,
};

export const ENTRY_VOLATILITY_BANDS: Record<SetupType, { minIvPercentile: number; maxIvPercentile: number }> = {
  SCALP_GUARDED: { minIvPercentile: 25, maxIvPercentile: 80 },
  SWING: { minIvPercentile: 20, maxIvPercentile: 85 },
  POSITION: { minIvPercentile: 15, maxIvPercentile: 90 },
  LEAPS: { minIvPercentile: 10, maxIvPercentile: 95 },
};

export const ENTRY_LIQUIDITY_ALLOWED: Record<SetupType, LiquidityState[]> = {
  SCALP_GUARDED: ['HIGH', 'NORMAL'],
  SWING: ['HIGH', 'NORMAL', 'LOW'],
  POSITION: ['HIGH', 'NORMAL', 'LOW'],
  LEAPS: ['HIGH', 'NORMAL', 'LOW'],
};

export const PORTFOLIO_GUARDRAILS = {
  maxOpenTrades: 8,
  maxDailyLoss: -750,
  maxAbsDelta: 400,
  maxAbsTheta: 250,
};

export const DTE_POLICY: Record<SetupType, { min: number; max: number; preferred?: [number, number] }> = {
  SCALP_GUARDED: { min: 3, max: 14 },
  SWING: { min: 21, max: 90, preferred: [30, 60] },
  POSITION: { min: 90, max: 180 },
  LEAPS: { min: 180, max: 720, preferred: [270, 540] },
};

export const LIQUIDITY_GATES: Record<
  SetupType,
  { maxSpreadPercent: number; minOpenInterest: number; minVolume: number }
> = {
  SCALP_GUARDED: { maxSpreadPercent: 8, minOpenInterest: 1000, minVolume: 500 },
  SWING: { maxSpreadPercent: 12, minOpenInterest: 300, minVolume: 100 },
  POSITION: { maxSpreadPercent: 15, minOpenInterest: 300, minVolume: 100 },
  LEAPS: { maxSpreadPercent: 10, minOpenInterest: 200, minVolume: 50 },
};

export const DELTA_RANGES: Record<SetupType, { min: number; max: number }> = {
  SCALP_GUARDED: { min: 0.45, max: 0.65 },
  SWING: { min: 0.25, max: 0.4 },
  POSITION: { min: 0.2, max: 0.35 },
  LEAPS: { min: 0.15, max: 0.3 },
};

export const SCORING_WEIGHTS: Record<
  SetupType,
  {
    liquidityFitness: number;
    greeksStability: number;
    thetaSurvivability: number;
    vegaIVAlignment: number;
    costEfficiency: number;
    gexSuitability: number;
  }
> = {
  SCALP_GUARDED: {
    liquidityFitness: 0.3,
    greeksStability: 0.2,
    thetaSurvivability: 0.15,
    vegaIVAlignment: 0.1,
    costEfficiency: 0.15,
    gexSuitability: 0.1,
  },
  SWING: {
    liquidityFitness: 0.2,
    greeksStability: 0.25,
    thetaSurvivability: 0.25,
    vegaIVAlignment: 0.15,
    costEfficiency: 0.1,
    gexSuitability: 0.05,
  },
  POSITION: {
    liquidityFitness: 0.15,
    greeksStability: 0.3,
    thetaSurvivability: 0.3,
    vegaIVAlignment: 0.15,
    costEfficiency: 0.05,
    gexSuitability: 0.05,
  },
  LEAPS: {
    liquidityFitness: 0.1,
    greeksStability: 0.25,
    thetaSurvivability: 0.35,
    vegaIVAlignment: 0.2,
    costEfficiency: 0.05,
    gexSuitability: 0.05,
  },
};

export const GEX_DELAY_STATES: Record<GEXState, { delayCalls: boolean; delayPuts: boolean }> = {
  POSITIVE_HIGH: { delayCalls: true, delayPuts: false },
  POSITIVE_LOW: { delayCalls: false, delayPuts: false },
  NEUTRAL: { delayCalls: false, delayPuts: false },
  NEGATIVE_LOW: { delayCalls: false, delayPuts: false },
  NEGATIVE_HIGH: { delayCalls: false, delayPuts: true },
};
