/**
 * Bias Control Simulator - Replay synthetic UnifiedBiasState sequences.
 * No trades executed. Validates behavioral correctness under stress.
 */

import type { UnifiedBiasState } from '../lib/mtfBias/types-v3.js';
import { calculatePositionSize, DEFAULT_RISK_CONFIG } from '../services/bias-state-aggregator/risk-model-integration.service.js';
import { evaluateExposure } from '../services/bias-state-aggregator/portfolio-guard-integration.service.js';
import { validateEntry } from '../services/bias-state-aggregator/setup-validator-integration.service.js';

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

export interface ScenarioReport {
  scenarioName: string;
  riskChanges: { step: number; finalRiskMultiplier: number; modifiers: Record<string, number> }[];
  exposureDecisions: { step: number; result: string; reasons: string[] }[];
  setupValidatorBlocks: { step: number; valid: boolean; rejectReasons: string[] }[];
  anomaliesDetected: string[];
  passed: boolean;
}

async function runScenarioA(): Promise<ScenarioReport> {
  const anomalies: string[] = [];
  const riskChanges: ScenarioReport['riskChanges'] = [];
  const exposureDecisions: ScenarioReport['exposureDecisions'] = [];
  const setupValidatorBlocks: ScenarioReport['setupValidatorBlocks'] = [];

  const seq: UnifiedBiasState[] = [
    ...Array(5).fill(null).map((_, i) =>
      makeState({
        biasScore: 70 + i * 2,
        macroClass: 'MACRO_TREND_UP',
        regimeType: 'TREND',
        transitions: { ...BASE_STATE.transitions!, macroFlip: false },
        acceleration: { stateStrengthDelta: 5, intentMomentumDelta: 0, macroDriftScore: 0.05 },
      })
    ),
    makeState({
      macroClass: 'MACRO_REVERSAL_RISK',
      transitions: { ...BASE_STATE.transitions!, macroFlip: true },
      acceleration: { stateStrengthDelta: -15, intentMomentumDelta: -5, macroDriftScore: 0.22 },
    }),
  ];

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
        strategyType: 'SWING',
        direction: 'long',
      },
      state
    );
    setupValidatorBlocks.push({ step: i, valid: setupOut.valid, rejectReasons: setupOut.rejectReasons });
  }

  const lastRisk = riskChanges[riskChanges.length - 1];
  const firstRisk = riskChanges[0];
  if (lastRisk.finalRiskMultiplier >= firstRisk.finalRiskMultiplier) {
    anomalies.push('Scenario A: Risk did not reduce after macro reversal');
  }
  const lastExp = exposureDecisions[exposureDecisions.length - 1];
  if (!lastExp.reasons.includes('MACRO_DRIFT_GUARD') && lastExp.result === 'ALLOW') {
    anomalies.push('Scenario A: Portfolio exposure not capped after macro flip');
  }
  const newLongBlocked = lastExp.result === 'BLOCK' || lastExp.reasons.length > 0;
  if (!newLongBlocked && lastExp.result === 'ALLOW' && lastExp.reasons.length === 0) {
    anomalies.push('Scenario A: New longs should be restricted (defined-risk or blocked)');
  }

  return {
    scenarioName: 'A_MACRO_REVERSAL_SHOCK',
    riskChanges,
    exposureDecisions,
    setupValidatorBlocks,
    anomaliesDetected: anomalies,
    passed: anomalies.length === 0,
  };
}

async function runScenarioB(): Promise<ScenarioReport> {
  const anomalies: string[] = [];
  const riskChanges: ScenarioReport['riskChanges'] = [];
  const exposureDecisions: ScenarioReport['exposureDecisions'] = [];
  const setupValidatorBlocks: ScenarioReport['setupValidatorBlocks'] = [];

  const seq: UnifiedBiasState[] = [
    makeState({ biasScore: 65, acceleration: { stateStrengthDelta: 10, intentMomentumDelta: 0, macroDriftScore: 0.05 } }),
    makeState({ biasScore: 72, acceleration: { stateStrengthDelta: 18, intentMomentumDelta: 2, macroDriftScore: 0.05 } }),
    makeState({ biasScore: 80, acceleration: { stateStrengthDelta: 25, intentMomentumDelta: 5, macroDriftScore: 0.03 } }),
  ];

  for (let i = 0; i < seq.length; i++) {
    const state = seq[i] as UnifiedBiasState;
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

  const lastRisk = riskChanges[riskChanges.length - 1];
  if (lastRisk.finalRiskMultiplier > 1.5) {
    anomalies.push('Scenario B: Risk over-amplified beyond hard cap 1.5');
  }
  const lastExp = exposureDecisions[exposureDecisions.length - 1];
  if (lastExp.result === 'BLOCK') {
    anomalies.push('Scenario B: Trade should not be suppressed in acceleration expansion');
  }
  const lastSetup = setupValidatorBlocks[setupValidatorBlocks.length - 1];
  if (!lastSetup.valid) {
    anomalies.push('Scenario B: Setup should not be blocked');
  }

  return {
    scenarioName: 'B_ACCELERATION_EXPANSION',
    riskChanges,
    exposureDecisions,
    setupValidatorBlocks,
    anomaliesDetected: anomalies,
    passed: anomalies.length === 0,
  };
}

async function runScenarioC(): Promise<ScenarioReport> {
  const anomalies: string[] = [];
  const riskChanges: ScenarioReport['riskChanges'] = [];
  const exposureDecisions: ScenarioReport['exposureDecisions'] = [];
  const setupValidatorBlocks: ScenarioReport['setupValidatorBlocks'] = [];

  const state = makeState({
    regimeType: 'RANGE',
    chopScore: 85,
    intentType: 'BREAKOUT',
    riskContext: { ...BASE_STATE.riskContext, entryModeHint: 'BREAKOUT' },
    space: { roomToResistance: 'LOW', roomToSupport: 'MEDIUM' },
  });

    const riskOut = await calculatePositionSize({
      accountSize: 100_000,
      baseRiskPercent: 1,
      direction: 'long',
      marketState: state,
      strategyType: 'BREAKOUT',
      simulationConfig: DEFAULT_RISK_CONFIG,
    });
  riskChanges.push({ step: 0, finalRiskMultiplier: riskOut.finalRiskMultiplier, modifiers: { ...riskOut.modifiers } });

  const expOut = await evaluateExposure({
    openPositions: [],
    newTrade: { symbol: 'SPY', direction: 'long', strategyType: 'BREAKOUT' },
    marketState: state,
  });
  exposureDecisions.push({ step: 0, result: expOut.result, reasons: expOut.reasons });

  const setupOut = validateEntry(
    {
      entryModeHint: 'BREAKOUT',
      intentType: 'BREAKOUT',
      trigger: state.trigger,
      space: state.space,
      liquidity: state.liquidity,
      regimeType: 'RANGE',
      strategyType: 'BREAKOUT',
      direction: 'long',
    },
    state
  );
  setupValidatorBlocks.push({ step: 0, valid: setupOut.valid, rejectReasons: setupOut.rejectReasons });

  if (expOut.result !== 'BLOCK' || !expOut.reasons.includes('RANGE_BREAKOUT_BLOCKED')) {
    anomalies.push('Scenario C: Breakout should be blocked in range chop');
  }
  if (riskOut.finalRiskMultiplier > 1) {
    anomalies.push('Scenario C: Risk should be reduced for range breakout');
  }
  if (!setupOut.rejectReasons.some((r) => r.includes('BREAKOUT') || r.includes('RANGE'))) {
    anomalies.push('Scenario C: Setup validator should block breakout in range');
  }

  return {
    scenarioName: 'C_CHOP_RANGE_TRAP',
    riskChanges,
    exposureDecisions,
    setupValidatorBlocks,
    anomaliesDetected: anomalies,
    passed: anomalies.length === 0,
  };
}

export async function runBiasControlSimulation(): Promise<{
  reports: ScenarioReport[];
  summary: {
    allPassed: boolean;
    riskModifierDistribution: { scenario: string; min: number; max: number; mean: number }[];
    anomaliesFound: string[];
  };
}> {
  const reports: ScenarioReport[] = [];
  reports.push(await runScenarioA());
  reports.push(await runScenarioB());
  reports.push(await runScenarioC());

  const allModifiers: { scenario: string; mult: number }[] = [];
  for (const r of reports) {
    for (const rc of r.riskChanges) {
      allModifiers.push({ scenario: r.scenarioName, mult: rc.finalRiskMultiplier });
    }
  }

  const riskModifierDistribution = reports.map((r) => {
    const mults = r.riskChanges.map((c) => c.finalRiskMultiplier);
    return {
      scenario: r.scenarioName,
      min: Math.min(...mults),
      max: Math.max(...mults),
      mean: mults.reduce((a, b) => a + b, 0) / mults.length,
    };
  });

  const anomaliesFound = reports.flatMap((r) => r.anomaliesDetected);

  return {
    reports,
    summary: {
      allPassed: reports.every((r) => r.passed),
      riskModifierDistribution,
      anomaliesFound,
    },
  };
}
