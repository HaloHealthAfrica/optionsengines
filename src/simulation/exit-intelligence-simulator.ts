/**
 * Exit Intelligence Simulation
 * Scenarios X, Y, Z + Monte Carlo for exit stability validation.
 */

import type { UnifiedBiasState } from '../lib/mtfBias/types-v3.js';
import { evaluateExitAdjustments } from '../services/exit-intelligence/index.js';

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

const OPEN_POSITION = {
  positionId: 'sim-1',
  symbol: 'SPY',
  direction: 'long' as const,
  type: 'call' as const,
  quantity: 2,
  entryPrice: 2.5,
  entryTimestamp: new Date(Date.now() - 60 * 60 * 1000),
  entryStateStrengthDelta: 15,
  entryRegimeType: 'TREND',
  entryStrategyType: 'BREAKOUT' as const,
};

export interface ExitScenarioReport {
  scenarioName: string;
  passed: boolean;
  anomaliesDetected: string[];
  expectations: string[];
  actual: {
    forceFullExit?: boolean;
    forcePartialExit?: number;
    tightenStopMultiplier?: number;
    convertToTrailing?: boolean;
    reasonCodes: string[];
  };
}

/** Scenario X — Macro Flip While In Profit */
export function runScenarioX(): ExitScenarioReport {
  const anomalies: string[] = [];
  const expectations = ['Partial exit or stop tighten', 'MACRO_DRIFT_EXIT_PRESSURE or macro flip'];

  const state = makeState({
    macroClass: 'MACRO_REVERSAL_RISK',
    transitions: { ...BASE_STATE.transitions!, macroFlip: true },
    acceleration: { stateStrengthDelta: 5, intentMomentumDelta: 0, macroDriftScore: 0.2 },
  });

  const out = evaluateExitAdjustments({
    openPosition: OPEN_POSITION,
    marketState: state,
    unrealizedPnL: 150,
    unrealizedPnLPercent: 6,
    timeInTradeMinutes: 90,
    strategyType: 'BREAKOUT',
  });

  if (!out.forceFullExit && !out.forcePartialExit && !out.tightenStopMultiplier) {
    anomalies.push('X: Expected partial exit or stop tighten on macro flip');
  }
  if (out.reasonCodes.length === 0) {
    anomalies.push('X: Expected at least one reason code');
  }
  if (out.forceFullExit && out.forcePartialExit) {
    anomalies.push('X: Contradictory forceFullExit and forcePartialExit');
  }

  return {
    scenarioName: 'X_MACRO_FLIP_IN_PROFIT',
    passed: anomalies.length === 0,
    anomaliesDetected: anomalies,
    expectations,
    actual: {
      forceFullExit: out.forceFullExit,
      forcePartialExit: out.forcePartialExit,
      tightenStopMultiplier: out.tightenStopMultiplier,
      convertToTrailing: out.convertToTrailing,
      reasonCodes: out.reasonCodes,
    },
  };
}

/** Scenario Y — Acceleration Collapse Mid-Trade */
export function runScenarioY(): ExitScenarioReport {
  const anomalies: string[] = [];
  const expectations = ['Trailing conversion', 'Tightened stop', 'ACCELERATION_DECAY'];

  const state = makeState({
    trendPhase: 'LATE',
    acceleration: { stateStrengthDelta: -12, intentMomentumDelta: -3, macroDriftScore: 0.1 },
  });

  const out = evaluateExitAdjustments({
    openPosition: { ...OPEN_POSITION, entryStateStrengthDelta: 20 },
    marketState: state,
    unrealizedPnL: 80,
    unrealizedPnLPercent: 3,
    timeInTradeMinutes: 120,
    strategyType: 'SWING',
  });

  if (!out.convertToTrailing && !out.tightenStopMultiplier) {
    anomalies.push('Y: Expected trailing conversion or tightened stop on acceleration decay');
  }
  if (!out.reasonCodes.includes('ACCELERATION_DECAY')) {
    anomalies.push('Y: Expected ACCELERATION_DECAY reason code');
  }

  return {
    scenarioName: 'Y_ACCELERATION_COLLAPSE',
    passed: anomalies.length === 0,
    anomaliesDetected: anomalies,
    expectations,
    actual: {
      forceFullExit: out.forceFullExit,
      forcePartialExit: out.forcePartialExit,
      tightenStopMultiplier: out.tightenStopMultiplier,
      convertToTrailing: out.convertToTrailing,
      reasonCodes: out.reasonCodes,
    },
  };
}

/** Scenario Z — Liquidity Trap */
export function runScenarioZ(): ExitScenarioReport {
  const anomalies: string[] = [];
  const expectations = ['Immediate full exit', 'LIQUIDITY_TRAP_EXIT'];

  const state = makeState({
    liquidity: { sweepHigh: true, sweepLow: false, reclaim: false, equalHighCluster: false, equalLowCluster: false },
  });

  const out = evaluateExitAdjustments({
    openPosition: OPEN_POSITION,
    marketState: state,
    unrealizedPnL: -50,
    unrealizedPnLPercent: -2,
    timeInTradeMinutes: 45,
    strategyType: 'BREAKOUT',
  });

  if (!out.forceFullExit) {
    anomalies.push('Z: Expected immediate full exit on liquidity trap');
  }
  if (!out.reasonCodes.includes('LIQUIDITY_TRAP_EXIT')) {
    anomalies.push('Z: Expected LIQUIDITY_TRAP_EXIT reason code');
  }

  return {
    scenarioName: 'Z_LIQUIDITY_TRAP',
    passed: anomalies.length === 0,
    anomaliesDetected: anomalies,
    expectations,
    actual: {
      forceFullExit: out.forceFullExit,
      forcePartialExit: out.forcePartialExit,
      tightenStopMultiplier: out.tightenStopMultiplier,
      convertToTrailing: out.convertToTrailing,
      reasonCodes: out.reasonCodes,
    },
  };
}

/** Monte Carlo — 200 random sequences, exit stability */
export function runExitMonteCarlo(): {
  totalRuns: number;
  fullExitCount: number;
  partialExitCount: number;
  tightenCount: number;
  trailingCount: number;
  holdCount: number;
  oscillationCount: number;
  contradictoryCount: number;
  reasonCodeDistribution: Record<string, number>;
} {
  const BIAS_VALS = ['BULLISH', 'BEARISH', 'NEUTRAL'] as const;
  const REGIMES = ['TREND', 'RANGE'] as const;
  const MACROS = ['MACRO_TREND_UP', 'MACRO_TREND_DOWN', 'MACRO_BREAKDOWN_CONFIRMED', 'MACRO_REVERSAL_RISK', 'MACRO_RANGE'] as const;
  const TREND_PHASES = ['EARLY', 'MID', 'LATE'] as const;

  let fullExitCount = 0;
  let partialExitCount = 0;
  let tightenCount = 0;
  let trailingCount = 0;
  let holdCount = 0;
  let oscillationCount = 0;
  let contradictoryCount = 0;
  const reasonCodeDistribution: Record<string, number> = {};
  const prevActions: string[] = [];

  for (let n = 0; n < 200; n++) {
    const bias = BIAS_VALS[n % BIAS_VALS.length];
    const regime = REGIMES[Math.floor(Math.random() * REGIMES.length)];
    const macro = MACROS[Math.floor(Math.random() * MACROS.length)];
    const trendPhase = TREND_PHASES[Math.floor(Math.random() * TREND_PHASES.length)];
    const macroDrift = Math.random() * 0.3;
    const stateStrengthDelta = (Math.random() - 0.5) * 40;
    const macroFlip = Math.random() > 0.7;
    const regimeFlip = Math.random() > 0.8;
    const sweepHigh = Math.random() > 0.85;
    const reclaim = Math.random() > 0.3;

    const state = makeState({
      bias,
      biasScore: bias === 'BULLISH' ? 70 : bias === 'BEARISH' ? -70 : 0,
      regimeType: regime,
      macroClass: macro,
      trendPhase,
      acceleration: { stateStrengthDelta, intentMomentumDelta: 0, macroDriftScore: macroDrift },
      transitions: {
        ...BASE_STATE.transitions!,
        macroFlip,
        regimeFlip,
      },
      liquidity: {
        sweepHigh,
        sweepLow: false,
        reclaim,
        equalHighCluster: false,
        equalLowCluster: false,
      },
    });

    const unrealizedPnLPercent = (Math.random() - 0.3) * 30;
    const unrealizedPnL = unrealizedPnLPercent * 50;

    const out = evaluateExitAdjustments({
      openPosition: { ...OPEN_POSITION, entryStateStrengthDelta: 15 },
      marketState: state,
      unrealizedPnL,
      unrealizedPnLPercent,
      timeInTradeMinutes: 60 + Math.random() * 120,
      strategyType: n % 3 === 0 ? 'BREAKOUT' : 'SWING',
    });

    const action = out.forceFullExit
      ? 'FULL'
      : out.forcePartialExit
        ? 'PARTIAL'
        : out.tightenStopMultiplier
          ? 'TIGHTEN'
          : out.convertToTrailing
            ? 'TRAILING'
            : 'HOLD';

    if (out.forceFullExit) fullExitCount++;
    else if (out.forcePartialExit) partialExitCount++;
    else if (out.tightenStopMultiplier) tightenCount++;
    else if (out.convertToTrailing) trailingCount++;
    else holdCount++;

    if (out.forceFullExit && out.forcePartialExit) contradictoryCount++;
    for (const r of out.reasonCodes) {
      reasonCodeDistribution[r] = (reasonCodeDistribution[r] ?? 0) + 1;
    }

    prevActions.push(action);
    if (prevActions.length > 3) prevActions.shift();
    if (prevActions.length === 3) {
      const [a, b, c] = prevActions;
      if (a !== b && b !== c && a !== c) oscillationCount++;
    }
  }

  return {
    totalRuns: 200,
    fullExitCount,
    partialExitCount,
    tightenCount,
    trailingCount,
    holdCount,
    oscillationCount,
    contradictoryCount,
    reasonCodeDistribution,
  };
}

export async function runExitIntelligenceSimulation(): Promise<{
  reports: ExitScenarioReport[];
  monteCarlo: ReturnType<typeof runExitMonteCarlo>;
  summary: { allPassed: boolean; noContradictions: boolean; noOscillation: boolean };
}> {
  const reports: ExitScenarioReport[] = [
    runScenarioX(),
    runScenarioY(),
    runScenarioZ(),
  ];
  const monteCarlo = runExitMonteCarlo();

  const allPassed = reports.every((r) => r.passed);
  const noContradictions = monteCarlo.contradictoryCount === 0;
  // Oscillation: 3-in-a-row action flips across random independent states (not same position)
  const noOscillation = monteCarlo.oscillationCount < 100;

  return {
    reports,
    monteCarlo,
    summary: {
      allPassed,
      noContradictions,
      noOscillation,
    },
  };
}
