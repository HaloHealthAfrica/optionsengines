/**
 * Advanced Stability & Chaos Testing - Non-linear market behavior.
 * Oscillation, modifier compounding, edge cases, portfolio pressure.
 */

import type { UnifiedBiasState } from '../lib/mtfBias/types-v3.js';
import type { BiasValueV3, RegimeTypeV3, MacroClassValue } from '../lib/mtfBias/constants-v3.js';
import { calculatePositionSize, DEFAULT_RISK_CONFIG } from '../services/bias-state-aggregator/risk-model-integration.service.js';
import { evaluateExposure, type OpenPosition } from '../services/bias-state-aggregator/portfolio-guard-integration.service.js';
import { validateEntry } from '../services/bias-state-aggregator/setup-validator-integration.service.js';
import type { ModifierContributionBreakdown } from '../services/bias-state-aggregator/risk-model-integration.service.js';

const BASE_STATE: Omit<UnifiedBiasState, 'symbol'> = {
  updatedAtMs: Date.now(),
  source: 'SIMULATION',
  chartTf: '15m',
  session: 'RTH',
  bias: 'BULLISH',
  biasScore: 70,
  confidence: 0.78,
  alignmentScore: 80,
  conflictScore: 10,
  regimeType: 'TREND',
  chopScore: 45,
  macroClass: 'MACRO_TREND_UP',
  macroConfidence: 0.82,
  macroSupport1: null,
  macroResistance1: null,
  macroMeasuredMoveTarget: null,
  intentType: 'PULLBACK',
  intentConfidence: 0.75,
  regimeTransition: false,
  trendPhase: 'MID',
  levels: {} as UnifiedBiasState['levels'],
  trigger: { barType: '2_UP', pattern: '2-1-2_UP', triggered: true },
  liquidity: { sweepHigh: false, sweepLow: false, reclaim: true, equalHighCluster: false, equalLowCluster: false },
  space: { roomToResistance: 'HIGH', roomToSupport: 'MEDIUM' },
  riskContext: { invalidation: { level: 500, method: 'M15_PIVOT_LOW' }, entryModeHint: 'PULLBACK' },
  transitions: { biasFlip: false, regimeFlip: false, macroFlip: false, intentChange: false, liquidityEvent: false, expansionEvent: false, compressionEvent: false },
  effective: { tradeSuppressed: false, effectiveBiasScore: 70, effectiveConfidence: 0.78, riskMultiplier: 1.0, notes: [] },
};

function makeState(overrides: Partial<UnifiedBiasState> & { symbol?: string }): UnifiedBiasState {
  return { ...BASE_STATE, symbol: 'SPY', ...overrides } as UnifiedBiasState;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function countFlips<T>(arr: T[], key: (v: T) => string): number {
  let flips = 0;
  for (let i = 1; i < arr.length; i++) {
    if (key(arr[i]) !== key(arr[i - 1])) flips++;
  }
  return flips;
}

export interface AdvancedScenarioReport {
  scenarioName: string;
  riskChanges: { step: number; finalRiskMultiplier: number; modifiers: Record<string, number>; contribution?: ModifierContributionBreakdown }[];
  exposureDecisions: { step: number; result: string; reasons: string[] }[];
  setupValidatorBlocks: { step: number; valid: boolean; rejectReasons: string[] }[];
  anomaliesDetected: string[];
  passed: boolean;
  metrics: {
    riskStdDev: number;
    exposureFlipCount: number;
    suppressionFlipCount: number;
    modifierContributionVariance?: Record<string, number>;
    blockRate?: number;
    riskDistributionHistogram?: Record<string, number>;
  };
}

async function runScenarioD(): Promise<AdvancedScenarioReport> {
  const anomalies: string[] = [];
  const riskChanges: AdvancedScenarioReport['riskChanges'] = [];
  const exposureDecisions: AdvancedScenarioReport['exposureDecisions'] = [];
  const setupValidatorBlocks: AdvancedScenarioReport['setupValidatorBlocks'] = [];

  const biases: BiasValueV3[] = ['BULLISH', 'BEARISH', 'BULLISH', 'BEARISH', 'BULLISH', 'BEARISH', 'BULLISH'];
  const regimes: RegimeTypeV3[] = ['TREND', 'RANGE', 'TREND', 'RANGE', 'TREND', 'RANGE', 'TREND'];
  const macroDrifts = [0.14, 0.18, 0.15, 0.17, 0.14, 0.16, 0.15];

  const seq: UnifiedBiasState[] = biases.map((bias, i) =>
    makeState({
      bias,
      biasScore: bias === 'BULLISH' ? 70 : -70,
      regimeType: regimes[i],
      chopScore: regimes[i] === 'RANGE' ? 60 : 45,
      acceleration: { stateStrengthDelta: 0, intentMomentumDelta: 0, macroDriftScore: macroDrifts[i] },
      transitions: { ...BASE_STATE.transitions!, macroFlip: macroDrifts[i] > 0.15 },
    })
  );

  for (let i = 0; i < seq.length; i++) {
    const state = seq[i];
    const riskOut = await calculatePositionSize({
      accountSize: 100_000,
      baseRiskPercent: 1,
      direction: 'long',
      marketState: state,
      simulationConfig: DEFAULT_RISK_CONFIG,
    });
    riskChanges.push({
      step: i,
      finalRiskMultiplier: riskOut.finalRiskMultiplier,
      modifiers: { ...riskOut.modifiers },
      contribution: riskOut.modifierContributionBreakdown,
    });

    const expOut = await evaluateExposure({
      openPositions: [],
      newTrade: { symbol: 'SPY', direction: 'long', strategyType: 'SWING' },
      marketState: state,
    });
    exposureDecisions.push({ step: i, result: expOut.result, reasons: expOut.reasons });

    const setupOut = validateEntry(
      {
        entryModeHint: state.riskContext.entryModeHint,
        intentType: state.intentType,
        trigger: state.trigger,
        space: state.space,
        liquidity: state.liquidity,
        regimeType: state.regimeType,
        direction: 'long',
      },
      state
    );
    setupValidatorBlocks.push({ step: i, valid: setupOut.valid, rejectReasons: setupOut.rejectReasons });
  }

  const riskMults = riskChanges.map((r) => r.finalRiskMultiplier);
  const riskStdDev = stdDev(riskMults);
  const exposureFlipCount = countFlips(exposureDecisions, (e) => e.result);
  const suppressionFlipCount = countFlips(setupValidatorBlocks, (s) => (s.valid ? 'valid' : 'block'));

  if (riskStdDev > 0.4) anomalies.push('D: Risk variance exceeds 0.4 swing');
  if (exposureFlipCount > 6) anomalies.push('D: Too many exposure flips in sequence');
  const riskSwing = Math.max(...riskMults) - Math.min(...riskMults);
  if (riskSwing > 0.5) anomalies.push('D: Risk swing too large');

  return {
    scenarioName: 'D_OSCILLATION_STRESS',
    riskChanges,
    exposureDecisions,
    setupValidatorBlocks,
    anomaliesDetected: anomalies,
    passed: anomalies.length === 0,
    metrics: {
      riskStdDev,
      exposureFlipCount,
      suppressionFlipCount,
    },
  };
}

async function runScenarioE(): Promise<AdvancedScenarioReport> {
  const anomalies: string[] = [];
  const riskChanges: AdvancedScenarioReport['riskChanges'] = [];
  const exposureDecisions: AdvancedScenarioReport['exposureDecisions'] = [];
  const setupValidatorBlocks: AdvancedScenarioReport['setupValidatorBlocks'] = [];

  const deltas = [25, 10, 5, -5, -15];
  const seq: UnifiedBiasState[] = deltas.map((d) =>
    makeState({
      macroClass: 'MACRO_TREND_UP',
      regimeType: 'TREND',
      acceleration: { stateStrengthDelta: d, intentMomentumDelta: 0, macroDriftScore: 0.05 },
    })
  );

  for (let i = 0; i < seq.length; i++) {
    const state = seq[i];
    const riskOut = await calculatePositionSize({
      accountSize: 100_000,
      baseRiskPercent: 1,
      direction: 'long',
      marketState: state,
      simulationConfig: DEFAULT_RISK_CONFIG,
    });
    riskChanges.push({
      step: i,
      finalRiskMultiplier: riskOut.finalRiskMultiplier,
      modifiers: { ...riskOut.modifiers },
      contribution: riskOut.modifierContributionBreakdown,
    });

    const expOut = await evaluateExposure({
      openPositions: [],
      newTrade: { symbol: 'SPY', direction: 'long' },
      marketState: state,
    });
    exposureDecisions.push({ step: i, result: expOut.result, reasons: expOut.reasons });

    const setupOut = validateEntry(
      {
        entryModeHint: state.riskContext.entryModeHint,
        intentType: state.intentType,
        trigger: state.trigger,
        space: state.space,
        liquidity: state.liquidity,
        regimeType: state.regimeType,
        direction: 'long',
      },
      state
    );
    setupValidatorBlocks.push({ step: i, valid: setupOut.valid, rejectReasons: setupOut.rejectReasons });
  }

  for (let i = 1; i < riskChanges.length; i++) {
    const prev = riskChanges[i - 1].finalRiskMultiplier;
    const curr = riskChanges[i].finalRiskMultiplier;
    const drop = (prev - curr) / prev;
    if (drop > 0.3) {
      anomalies.push(`E: Sudden drop >30% at step ${i} without macro flip`);
    }
  }

  return {
    scenarioName: 'E_ACCELERATION_DECAY',
    riskChanges,
    exposureDecisions,
    setupValidatorBlocks,
    anomaliesDetected: anomalies,
    passed: anomalies.length === 0,
    metrics: {
      riskStdDev: stdDev(riskChanges.map((r) => r.finalRiskMultiplier)),
      exposureFlipCount: countFlips(exposureDecisions, (e) => e.result),
      suppressionFlipCount: countFlips(setupValidatorBlocks, (s) => (s.valid ? 'valid' : 'block')),
    },
  };
}

async function runScenarioF(): Promise<AdvancedScenarioReport> {
  const anomalies: string[] = [];
  const riskChanges: AdvancedScenarioReport['riskChanges'] = [];
  const exposureDecisions: AdvancedScenarioReport['exposureDecisions'] = [];
  const setupValidatorBlocks: AdvancedScenarioReport['setupValidatorBlocks'] = [];

  const openPositions: OpenPosition[] = [
    { position_id: '1', symbol: 'SPY', type: 'call', quantity: 1, entry_price: 500 },
    { position_id: '2', symbol: 'QQQ', type: 'call', quantity: 1, entry_price: 400 },
    { position_id: '3', symbol: 'IWM', type: 'call', quantity: 1, entry_price: 200 },
  ];

  const macroDrifts = [0.1, 0.14, 0.18, 0.22];
  const regimes: RegimeTypeV3[] = ['TREND', 'TREND', 'RANGE', 'RANGE'];
  const gammaEnvs = ['NEUTRAL', 'NEUTRAL', 'NEGATIVE', 'NEGATIVE'] as const;

  const seq: UnifiedBiasState[] = macroDrifts.map((drift, i) =>
    makeState({
      macroClass: 'MACRO_TREND_UP',
      regimeType: regimes[i],
      chopScore: regimes[i] === 'RANGE' ? 75 : 45,
      acceleration: { stateStrengthDelta: 0, intentMomentumDelta: 0, macroDriftScore: drift },
      gamma: {
        gammaEnvironment: gammaEnvs[i],
        gammaMagnitude: 'MEDIUM',
        gammaFlipLevel: null,
        distanceToFlip: null,
        callWall: null,
        putWall: null,
        volRegimeBias: 'NEUTRAL',
        gammaUpdatedAtMs: Date.now(),
      },
    })
  );

  const expResults: string[] = [];
  for (let i = 0; i < seq.length; i++) {
    const state = seq[i];
    const riskOut = await calculatePositionSize({
      accountSize: 100_000,
      baseRiskPercent: 1,
      direction: 'long',
      marketState: state,
      simulationConfig: DEFAULT_RISK_CONFIG,
    });
    riskChanges.push({
      step: i,
      finalRiskMultiplier: riskOut.finalRiskMultiplier,
      modifiers: { ...riskOut.modifiers },
    });

    const expOut = await evaluateExposure({
      openPositions,
      newTrade: { symbol: 'SPY', direction: 'long' },
      marketState: state,
    });
    exposureDecisions.push({ step: i, result: expOut.result, reasons: expOut.reasons });
    expResults.push(expOut.result);

    const setupOut = validateEntry(
      {
        entryModeHint: state.riskContext.entryModeHint,
        intentType: state.intentType,
        trigger: state.trigger,
        space: state.space,
        liquidity: state.liquidity,
        regimeType: state.regimeType,
        direction: 'long',
      },
      state
    );
    setupValidatorBlocks.push({ step: i, valid: setupOut.valid, rejectReasons: setupOut.rejectReasons });
  }

  const exposureFlipCount = countFlips(exposureDecisions, (e) => e.result);
  if (exposureFlipCount > 2) anomalies.push('F: Inconsistent allow/block toggles under portfolio pressure');

  const lastExp = exposureDecisions[exposureDecisions.length - 1];
  if (lastExp.result === 'ALLOW' && lastExp.reasons.length === 0 && macroDrifts[3] > 0.15) {
    anomalies.push('F: Should restrict exposure when macro drift high with 3 longs');
  }

  return {
    scenarioName: 'F_PORTFOLIO_PRESSURE',
    riskChanges,
    exposureDecisions,
    setupValidatorBlocks,
    anomaliesDetected: anomalies,
    passed: anomalies.length === 0,
    metrics: {
      riskStdDev: stdDev(riskChanges.map((r) => r.finalRiskMultiplier)),
      exposureFlipCount,
      suppressionFlipCount: countFlips(setupValidatorBlocks, (s) => (s.valid ? 'valid' : 'block')),
    },
  };
}

async function runScenarioG(): Promise<AdvancedScenarioReport> {
  const anomalies: string[] = [];
  const riskChanges: AdvancedScenarioReport['riskChanges'] = [];
  const exposureDecisions: AdvancedScenarioReport['exposureDecisions'] = [];
  const setupValidatorBlocks: AdvancedScenarioReport['setupValidatorBlocks'] = [];

  const state = makeState({
    isStale: true,
    acceleration: { stateStrengthDelta: 25, intentMomentumDelta: 5, macroDriftScore: 0.05 },
    macroClass: 'MACRO_TREND_UP',
  });

  const riskOut = await calculatePositionSize({
    accountSize: 100_000,
    baseRiskPercent: 1,
    direction: 'long',
    marketState: state,
    simulationConfig: DEFAULT_RISK_CONFIG,
  });

  riskChanges.push({
    step: 0,
    finalRiskMultiplier: riskOut.finalRiskMultiplier,
    modifiers: { ...riskOut.modifiers },
    contribution: riskOut.modifierContributionBreakdown,
  });

  const expOut = await evaluateExposure({
    openPositions: [],
    newTrade: { symbol: 'SPY', direction: 'long' },
    marketState: state,
  });
  exposureDecisions.push({ step: 0, result: expOut.result, reasons: expOut.reasons });

  const setupOut = validateEntry(
    {
      entryModeHint: state.riskContext.entryModeHint,
      intentType: state.intentType,
      trigger: state.trigger,
      space: state.space,
      liquidity: state.liquidity,
      regimeType: state.regimeType,
      direction: 'long',
    },
    state
  );
  setupValidatorBlocks.push({ step: 0, valid: setupOut.valid, rejectReasons: setupOut.rejectReasons });

  const expectedWithStalenessDominant = 1.15 * 1.1 * 1.1 * 0.7;
  if (riskOut.finalRiskMultiplier > expectedWithStalenessDominant * 1.05) {
    anomalies.push('G: Acceleration boost overrode staleness reduction');
  }
  const contrib = riskOut.modifierContributionBreakdown;
  if (contrib && contrib.staleness !== 0.7) {
    anomalies.push('G: Staleness must be applied (0.7) when state is stale');
  }

  return {
    scenarioName: 'G_STALENESS_ACCELERATION_CONFLICT',
    riskChanges,
    exposureDecisions,
    setupValidatorBlocks,
    anomaliesDetected: anomalies,
    passed: anomalies.length === 0,
    metrics: {
      riskStdDev: 0,
      exposureFlipCount: 0,
      suppressionFlipCount: 0,
    },
  };
}

async function runScenarioH(): Promise<AdvancedScenarioReport> {
  const anomalies: string[] = [];
  const riskChanges: AdvancedScenarioReport['riskChanges'] = [];
  const exposureDecisions: AdvancedScenarioReport['exposureDecisions'] = [];
  const setupValidatorBlocks: AdvancedScenarioReport['setupValidatorBlocks'] = [];

  const allPositive = makeState({
    macroClass: 'MACRO_TREND_UP',
    regimeType: 'TREND',
    alignmentScore: 85,
    acceleration: { stateStrengthDelta: 25, intentMomentumDelta: 5, macroDriftScore: 0.05 },
    trendPhase: 'MID',
    effective: { ...BASE_STATE.effective!, riskMultiplier: 1.2 },
  });

  const allNegative = makeState({
    macroClass: 'MACRO_BREAKDOWN_CONFIRMED',
    regimeType: 'RANGE',
    alignmentScore: 50,
    acceleration: { stateStrengthDelta: -25, intentMomentumDelta: -5, macroDriftScore: 0.22 },
    trendPhase: 'LATE',
    effective: { ...BASE_STATE.effective!, riskMultiplier: 0.8 },
    riskContext: { ...BASE_STATE.riskContext, entryModeHint: 'BREAKOUT' },
  });

  const testCases: [string, UnifiedBiasState, 'long' | 'short'][] = [
    ['all_positive', allPositive, 'long'],
    ['all_negative', allNegative, 'long'],
    ['all_negative_short', allNegative, 'short'],
  ];
  for (const [name, s, dir] of testCases) {
    const riskOut = await calculatePositionSize({
      accountSize: 100_000,
      baseRiskPercent: 1,
      direction: dir,
      marketState: s,
      strategyType: name.includes('negative') ? 'BREAKOUT' : 'SWING',
      simulationConfig: DEFAULT_RISK_CONFIG,
    });

    if (riskOut.finalRiskMultiplier > 1.5) {
      anomalies.push(`H: Risk exceeded 1.5x (${riskOut.finalRiskMultiplier})`);
    }
    if (riskOut.finalRiskMultiplier < 0.25) {
      anomalies.push(`H: Risk below 0.25x (${riskOut.finalRiskMultiplier})`);
    }

    riskChanges.push({
      step: riskChanges.length,
      finalRiskMultiplier: riskOut.finalRiskMultiplier,
      modifiers: { ...riskOut.modifiers },
    });

    const expOut = await evaluateExposure({
      openPositions: [],
      newTrade: { symbol: 'SPY', direction: dir, strategyType: 'SWING' },
      marketState: s,
    });
    exposureDecisions.push({ step: exposureDecisions.length, result: expOut.result, reasons: expOut.reasons });

    const setupOut = validateEntry(
      {
        entryModeHint: s.riskContext.entryModeHint,
        intentType: s.intentType,
        trigger: s.trigger,
        space: s.space,
        liquidity: s.liquidity,
        regimeType: s.regimeType,
        strategyType: 'SWING',
        direction: dir,
      },
      s
    );
    setupValidatorBlocks.push({ step: setupValidatorBlocks.length, valid: setupOut.valid, rejectReasons: setupOut.rejectReasons });
  }

  return {
    scenarioName: 'H_RISK_FLOOR_CEILING',
    riskChanges,
    exposureDecisions,
    setupValidatorBlocks,
    anomaliesDetected: anomalies,
    passed: anomalies.length === 0,
    metrics: {
      riskStdDev: stdDev(riskChanges.map((r) => r.finalRiskMultiplier)),
      exposureFlipCount: countFlips(exposureDecisions, (e) => e.result),
      suppressionFlipCount: countFlips(setupValidatorBlocks, (s) => (s.valid ? 'valid' : 'block')),
    },
  };
}

async function runModifierAudit(): Promise<{ modifierContributionVariance: Record<string, number> }> {
  const contributions: ModifierContributionBreakdown[] = [];
  const BIAS_VALS: BiasValueV3[] = ['BULLISH', 'BEARISH', 'NEUTRAL'];
  const REGIMES: RegimeTypeV3[] = ['TREND', 'RANGE'];
  const MACROS: MacroClassValue[] = ['MACRO_TREND_UP', 'MACRO_TREND_DOWN', 'MACRO_BREAKDOWN_CONFIRMED', 'MACRO_REVERSAL_RISK'];
  const deltas = [-25, -10, 0, 10, 25];
  const macroDrifts = [0.05, 0.12, 0.18, 0.25];

  for (let n = 0; n < 100; n++) {
    const bias = BIAS_VALS[n % BIAS_VALS.length];
    const regime = REGIMES[n % REGIMES.length];
    const macro = MACROS[n % MACROS.length];
    const delta = deltas[n % deltas.length];
    const drift = macroDrifts[n % macroDrifts.length];

    const state = makeState({
      bias,
      biasScore: bias === 'BULLISH' ? 70 : bias === 'BEARISH' ? -70 : 0,
      regimeType: regime,
      chopScore: regime === 'RANGE' ? 60 + (n % 30) : 30 + (n % 30),
      macroClass: macro,
      acceleration: { stateStrengthDelta: delta, intentMomentumDelta: 0, macroDriftScore: drift },
      trendPhase: n % 4 === 0 ? 'LATE' : 'MID',
      isStale: n % 10 === 0,
    });

    const riskOut = await calculatePositionSize({
      accountSize: 100_000,
      baseRiskPercent: 1,
      direction: 'long',
      marketState: state,
      strategyType: regime === 'RANGE' && n % 2 === 0 ? 'BREAKOUT' : 'SWING',
      simulationConfig: DEFAULT_RISK_CONFIG,
    });

    if (riskOut.modifierContributionBreakdown) {
      contributions.push(riskOut.modifierContributionBreakdown);
    }
  }

  const keys: (keyof ModifierContributionBreakdown)[] = ['macro', 'regime', 'acceleration', 'latePhase', 'staleness'];
  const variance: Record<string, number> = {};
  for (const k of keys) {
    const vals = contributions.map((c) => c[k]);
    variance[k] = stdDev(vals);
  }
  return { modifierContributionVariance: variance };
}

function buildHistogram(mults: number[], bins: number[]): Record<string, number> {
  const hist: Record<string, number> = {};
  for (let i = 0; i < bins.length - 1; i++) {
    hist[`${bins[i].toFixed(2)}-${bins[i + 1].toFixed(2)}`] = 0;
  }
  for (const m of mults) {
    for (let i = 0; i < bins.length - 1; i++) {
      if (m >= bins[i] && m < bins[i + 1]) {
        hist[`${bins[i].toFixed(2)}-${bins[i + 1].toFixed(2)}`]++;
        break;
      }
    }
  }
  return hist;
}

async function runMonteCarlo(): Promise<{
  blockRate: number;
  meanRiskMultiplier: number;
  exposureCapFrequency: number;
  suppressionReasonsDistribution: Record<string, number>;
  riskDistributionHistogram: Record<string, number>;
  riskStdDev: number;
}> {
  const riskMults: number[] = [];
  let blocked = 0;
  let exposureCapped = 0;
  const suppressionReasons: Record<string, number> = {};

  const BIAS_VALS: BiasValueV3[] = ['BULLISH', 'BEARISH', 'NEUTRAL'];
  const REGIMES: RegimeTypeV3[] = ['TREND', 'RANGE'];
  const MACROS: MacroClassValue[] = ['MACRO_TREND_UP', 'MACRO_TREND_DOWN', 'MACRO_BREAKDOWN_CONFIRMED', 'MACRO_REVERSAL_RISK', 'MACRO_RANGE'];
  const INTENTS: import('../lib/mtfBias/constants-v3.js').IntentTypeValue[] = ['BREAKOUT', 'PULLBACK', 'MEAN_REVERT', 'NEUTRAL'];
  const SPACES = ['HIGH', 'MEDIUM', 'LOW'] as const;

  for (let n = 0; n < 500; n++) {
    const bias = BIAS_VALS[n % BIAS_VALS.length];
    const regime = REGIMES[Math.floor(Math.random() * REGIMES.length)];
    const macro = MACROS[Math.floor(Math.random() * MACROS.length)];
    const intent = INTENTS[Math.floor(Math.random() * INTENTS.length)];
    const space = SPACES[Math.floor(Math.random() * SPACES.length)];

    const state = makeState({
      bias,
      biasScore: (Math.random() - 0.5) * 140,
      regimeType: regime,
      chopScore: 30 + Math.random() * 60,
      macroClass: macro,
      intentType: intent,
      riskContext: {
        ...BASE_STATE.riskContext,
        entryModeHint: intent === 'NEUTRAL' ? 'NO_TRADE' : (intent as 'BREAKOUT' | 'PULLBACK' | 'MEAN_REVERT'),
      },
      space: { roomToResistance: space, roomToSupport: 'MEDIUM' },
      acceleration: {
        stateStrengthDelta: (Math.random() - 0.5) * 50,
        intentMomentumDelta: (Math.random() - 0.5) * 10,
        macroDriftScore: Math.random() * 0.3,
      },
      trigger: { barType: '2_UP', pattern: '2-1-2_UP', triggered: Math.random() > 0.2 },
      liquidity: {
        sweepHigh: Math.random() > 0.9,
        sweepLow: false,
        reclaim: Math.random() > 0.5,
        equalHighCluster: false,
        equalLowCluster: false,
      },
    });

    const riskOut = await calculatePositionSize({
      accountSize: 100_000,
      baseRiskPercent: 1,
      direction: 'long',
      marketState: state,
      strategyType: intent === 'MEAN_REVERT' ? 'MEAN_REVERT' : intent === 'BREAKOUT' ? 'BREAKOUT' : 'PULLBACK',
      simulationConfig: DEFAULT_RISK_CONFIG,
    });
    riskMults.push(riskOut.finalRiskMultiplier);

    const expOut = await evaluateExposure({
      openPositions: [],
      newTrade: { symbol: 'SPY', direction: 'long', strategyType: intent === 'BREAKOUT' ? 'BREAKOUT' : intent === 'MEAN_REVERT' ? 'MEAN_REVERT' : 'PULLBACK' },
      marketState: state,
    });
    const setupOut = validateEntry(
      {
        entryModeHint: intent === 'NEUTRAL' ? 'NO_TRADE' : intent,
        intentType: intent,
        trigger: state.trigger,
        space: state.space,
        liquidity: state.liquidity,
        regimeType: regime,
        strategyType: intent === 'MEAN_REVERT' ? 'MEAN_REVERT' : intent === 'BREAKOUT' ? 'BREAKOUT' : 'PULLBACK',
        direction: 'long',
      },
      state
    );

    if (expOut.result === 'BLOCK' || !setupOut.valid) blocked++;
    if (expOut.result !== 'ALLOW') exposureCapped++;
    for (const r of expOut.reasons) {
      suppressionReasons[r] = (suppressionReasons[r] ?? 0) + 1;
    }
    for (const r of setupOut.rejectReasons) {
      suppressionReasons[`setup:${r}`] = (suppressionReasons[`setup:${r}`] ?? 0) + 1;
    }
  }

  const blockRate = blocked / 500;
  const meanRisk = riskMults.reduce((a, b) => a + b, 0) / riskMults.length;
  const bins = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

  return {
    blockRate,
    meanRiskMultiplier: meanRisk,
    exposureCapFrequency: exposureCapped / 500,
    suppressionReasonsDistribution: suppressionReasons,
    riskDistributionHistogram: buildHistogram(riskMults, bins),
    riskStdDev: stdDev(riskMults),
  };
}

export async function runAdvancedStabilitySimulation(): Promise<{
  reports: AdvancedScenarioReport[];
  modifierAudit: { modifierContributionVariance: Record<string, number> };
  monteCarlo: Awaited<ReturnType<typeof runMonteCarlo>>;
  summary: {
    allPassed: boolean;
    riskStdDev: number[];
    exposureFlipCount: number[];
    blockRate: number;
    blockRateInRange: boolean;
    anomaliesFound: string[];
  };
}> {
  const reports: AdvancedScenarioReport[] = [];
  reports.push(await runScenarioD());
  reports.push(await runScenarioE());
  reports.push(await runScenarioF());
  reports.push(await runScenarioG());
  reports.push(await runScenarioH());

  const modifierAudit = await runModifierAudit();
  const monteCarlo = await runMonteCarlo();

  const anomaliesFound = reports.flatMap((r) => r.anomaliesDetected);
  const blockRateInRange = monteCarlo.blockRate >= 0.15 && monteCarlo.blockRate <= 0.65;
  if (!blockRateInRange) {
    anomaliesFound.push(`Monte Carlo block rate ${(monteCarlo.blockRate * 100).toFixed(1)}% outside 15-65%`);
  }

  return {
    reports,
    modifierAudit,
    monteCarlo,
    summary: {
      allPassed: reports.every((r) => r.passed) && blockRateInRange,
      riskStdDev: reports.map((r) => r.metrics.riskStdDev),
      exposureFlipCount: reports.map((r) => r.metrics.exposureFlipCount),
      blockRate: monteCarlo.blockRate,
      blockRateInRange,
      anomaliesFound,
    },
  };
}
