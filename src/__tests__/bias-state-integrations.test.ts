/**
 * Bias State Integrations - Unit tests for risk model, portfolio guard, setup validator, conflict resolver.
 */

import { db } from '../services/database.service.js';

jest.mock('../services/database.service.js', () => ({
  db: {
    query: jest.fn(),
  },
}));

import type { UnifiedBiasState } from '../lib/mtfBias/types-v3.js';
import {
  calculatePositionSize,
  getRiskMultiplierFromState,
} from '../services/bias-state-aggregator/risk-model-integration.service.js';
import {
  evaluateExposure,
  type OpenPosition,
} from '../services/bias-state-aggregator/portfolio-guard-integration.service.js';
import { validateEntry } from '../services/bias-state-aggregator/setup-validator-integration.service.js';
import {
  mergeStatesBySource,
  MTF_SOURCE,
  GAMMA_SOURCE,
  type StatesBySource,
} from '../services/bias-state-aggregator/conflict-resolver.js';

function makeBaseState(overrides: Partial<UnifiedBiasState> = {}): UnifiedBiasState {
  return {
    symbol: 'SPY',
    updatedAtMs: Date.now(),
    source: MTF_SOURCE,
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
    ...overrides,
  };
}

describe('Risk Model Integration', () => {
  beforeEach(() => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
  });

  it('applies base risk and aggregator multiplier', async () => {
    const state = makeBaseState({ effective: { ...makeBaseState().effective!, riskMultiplier: 0.8 } });
    const out = await calculatePositionSize({
      accountSize: 100_000,
      baseRiskPercent: 1,
      direction: 'long',
      marketState: state,
    });
    expect(out.modifiers.aggregatorMultiplier).toBe(0.8);
    expect(out.finalRiskMultiplier).toBeLessThanOrEqual(1.5);
    expect(out.finalRiskMultiplier).toBeGreaterThanOrEqual(0.25);
  });

  it('reduces risk for MACRO_BREAKDOWN_CONFIRMED + long', async () => {
    const state = makeBaseState({ macroClass: 'MACRO_BREAKDOWN_CONFIRMED' });
    const out = await calculatePositionSize({
      accountSize: 100_000,
      baseRiskPercent: 1,
      direction: 'long',
      marketState: state,
    });
    expect(out.modifiers.macroModifier).toBe(0.5);
  });

  it('boosts risk for MACRO_TREND_UP + long', async () => {
    const state = makeBaseState({ macroClass: 'MACRO_TREND_UP' });
    const out = await calculatePositionSize({
      accountSize: 100_000,
      baseRiskPercent: 1,
      direction: 'long',
      marketState: state,
    });
    expect(out.modifiers.macroModifier).toBe(1.15);
  });

  it('reduces risk for RANGE + BREAKOUT', async () => {
    const state = makeBaseState({ regimeType: 'RANGE' });
    const out = await calculatePositionSize({
      accountSize: 100_000,
      baseRiskPercent: 1,
      direction: 'long',
      marketState: state,
      strategyType: 'BREAKOUT',
    });
    expect(out.modifiers.regimeModifier).toBe(0.7);
  });

  it('boosts risk for TREND + alignmentScore > 75', async () => {
    const state = makeBaseState({ regimeType: 'TREND', alignmentScore: 85 });
    const out = await calculatePositionSize({
      accountSize: 100_000,
      baseRiskPercent: 1,
      direction: 'long',
      marketState: state,
    });
    expect(out.modifiers.regimeModifier).toBe(1.1);
  });

  it('applies acceleration modifiers - stateStrengthDelta > 15', async () => {
    const state = makeBaseState({
      acceleration: { stateStrengthDelta: 20, intentMomentumDelta: 0, macroDriftScore: 0 },
    });
    const out = await calculatePositionSize({
      accountSize: 100_000,
      baseRiskPercent: 1,
      direction: 'long',
      marketState: state,
    });
    expect(out.modifiers.accelerationModifier).toBeGreaterThan(1);
  });

  it('applies acceleration modifiers - stateStrengthDelta < -20', async () => {
    const state = makeBaseState({
      acceleration: { stateStrengthDelta: -25, intentMomentumDelta: 0, macroDriftScore: 0 },
    });
    const out = await calculatePositionSize({
      accountSize: 100_000,
      baseRiskPercent: 1,
      direction: 'long',
      marketState: state,
    });
    expect(out.modifiers.accelerationModifier).toBeLessThan(1);
  });

  it('applies late phase guard when trendPhase LATE and delta negative', async () => {
    const state = makeBaseState({
      trendPhase: 'LATE',
      acceleration: { stateStrengthDelta: -5, intentMomentumDelta: 0, macroDriftScore: 0 },
    });
    const out = await calculatePositionSize({
      accountSize: 100_000,
      baseRiskPercent: 1,
      direction: 'long',
      marketState: state,
    });
    expect(out.modifiers.latePhaseModifier).toBe(0.75);
  });

  it('getRiskMultiplierFromState returns capped multiplier', async () => {
    const state = makeBaseState();
    const mult = await getRiskMultiplierFromState(state, 'long', 'SWING');
    expect(mult).toBeGreaterThanOrEqual(0.25);
    expect(mult).toBeLessThanOrEqual(1.5);
  });
});

describe('Portfolio Guard Integration', () => {
  it('blocks when macro drift high', async () => {
    const state = makeBaseState({
      acceleration: { stateStrengthDelta: 0, intentMomentumDelta: 0, macroDriftScore: 0.2 },
      transitions: { ...makeBaseState().transitions!, macroFlip: true },
    });
    const result = await evaluateExposure({
      openPositions: [],
      newTrade: { symbol: 'SPY', direction: 'long' },
      marketState: state,
    });
    expect(result.reasons).toContain('MACRO_DRIFT_GUARD');
    expect(result.metrics.definedRiskOnly).toBe(true);
  });

  it('blocks breakout in RANGE + chop > 70', async () => {
    const state = makeBaseState({ regimeType: 'RANGE', chopScore: 75 });
    const result = await evaluateExposure({
      openPositions: [],
      newTrade: { symbol: 'SPY', direction: 'long', strategyType: 'BREAKOUT' },
      marketState: state,
    });
    expect(result.result).toBe('BLOCK');
    expect(result.reasons).toContain('RANGE_BREAKOUT_BLOCKED');
  });

  it('blocks when macro bias cluster >= 3', async () => {
    const state = makeBaseState({ macroClass: 'MACRO_BREAKDOWN_CONFIRMED' });
    const positions: OpenPosition[] = [
      { position_id: '1', symbol: 'SPY', type: 'call', quantity: 1, entry_price: 500 },
      { position_id: '2', symbol: 'QQQ', type: 'call', quantity: 1, entry_price: 400 },
      { position_id: '3', symbol: 'IWM', type: 'call', quantity: 1, entry_price: 200 },
    ];
    const result = await evaluateExposure({
      openPositions: positions,
      newTrade: { symbol: 'SPY', direction: 'long' },
      marketState: state,
    });
    expect(result.result).toBe('BLOCK');
    expect(result.reasons).toContain('MACRO_BIAS_CLUSTER');
  });

  it('allows when no guards triggered', async () => {
    const state = makeBaseState();
    const result = await evaluateExposure({
      openPositions: [],
      newTrade: { symbol: 'SPY', direction: 'long' },
      marketState: state,
    });
    expect(result.result).toBe('ALLOW');
  });
});

describe('Integration: Macro flip + negative acceleration', () => {
  beforeEach(() => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
  });

  it('reduces risk and blocks exposure when macro flip + negative acceleration', async () => {
    const state = makeBaseState({
      transitions: { ...makeBaseState().transitions!, macroFlip: true },
      acceleration: { stateStrengthDelta: -25, intentMomentumDelta: -5, macroDriftScore: 0.2 },
    });

    const riskOut = await calculatePositionSize({
      accountSize: 100_000,
      baseRiskPercent: 1,
      direction: 'long',
      marketState: state,
    });
    expect(riskOut.finalRiskMultiplier).toBeLessThan(1);
    expect(riskOut.modifiers.accelerationModifier).toBeLessThan(1);

    const exposureResult = await evaluateExposure({
      openPositions: [],
      newTrade: { symbol: 'SPY', direction: 'long' },
      marketState: state,
    });
    expect(exposureResult.reasons).toContain('MACRO_DRIFT_GUARD');
    expect(exposureResult.metrics.definedRiskOnly).toBe(true);
  });
});

describe('Setup Validator Integration', () => {
  it('rejects breakout without space', () => {
    const result = validateEntry(
      {
        entryModeHint: 'BREAKOUT',
        intentType: 'BREAKOUT',
        trigger: { triggered: true },
        space: { roomToResistance: 'LOW', roomToSupport: 'MEDIUM' },
        liquidity: { sweepHigh: false, sweepLow: false, reclaim: false },
        regimeType: 'TREND',
        strategyType: 'BREAKOUT',
      },
      null
    );
    expect(result.valid).toBe(false);
    expect(result.rejectReasons).toContain('BREAKOUT_WITHOUT_SPACE');
  });

  it('rejects when trigger not confirmed', () => {
    const result = validateEntry(
      {
        entryModeHint: 'BREAKOUT',
        intentType: 'BREAKOUT',
        trigger: { triggered: false },
        space: { roomToResistance: 'HIGH', roomToSupport: 'MEDIUM' },
        liquidity: { sweepHigh: false, sweepLow: false, reclaim: false },
        regimeType: 'TREND',
        allowAnticipatoryEntry: false,
      },
      null
    );
    expect(result.valid).toBe(false);
    expect(result.rejectReasons).toContain('NO_TRIGGER_CONFIRMATION');
  });

  it('rejects liquidity trap - sweep high, no reclaim, long', () => {
    const result = validateEntry(
      {
        entryModeHint: 'PULLBACK',
        intentType: 'PULLBACK',
        trigger: { triggered: true },
        space: { roomToResistance: 'HIGH', roomToSupport: 'MEDIUM' },
        liquidity: { sweepHigh: true, sweepLow: false, reclaim: false },
        regimeType: 'TREND',
        direction: 'long',
      },
      null
    );
    expect(result.valid).toBe(false);
    expect(result.rejectReasons).toContain('LIQUIDITY_TRAP_CONTINUATION');
  });

  it('rejects RANGE + non-MEAN_REVERT', () => {
    const result = validateEntry(
      {
        entryModeHint: 'BREAKOUT',
        intentType: 'BREAKOUT',
        trigger: { triggered: true },
        space: { roomToResistance: 'HIGH', roomToSupport: 'MEDIUM' },
        liquidity: { sweepHigh: false, sweepLow: false, reclaim: false },
        regimeType: 'RANGE',
        strategyType: 'BREAKOUT',
      },
      null
    );
    expect(result.valid).toBe(false);
    expect(result.rejectReasons).toContain('RANGE_SUPPRESSION_NON_MEAN_REVERT');
  });

  it('allows valid entry', () => {
    const result = validateEntry(
      {
        entryModeHint: 'PULLBACK',
        intentType: 'PULLBACK',
        trigger: { triggered: true },
        space: { roomToResistance: 'HIGH', roomToSupport: 'MEDIUM' },
        liquidity: { sweepHigh: false, sweepLow: false, reclaim: true },
        regimeType: 'TREND',
        strategyType: 'PULLBACK',
      },
      null
    );
    expect(result.valid).toBe(true);
    expect(result.rejectReasons).toHaveLength(0);
  });
});

describe('Conflict Resolver', () => {
  it('returns single source when only one', () => {
    const states: StatesBySource = {
      [MTF_SOURCE]: makeBaseState({ biasScore: 60 }),
    };
    const merged = mergeStatesBySource(states);
    expect(merged).not.toBeNull();
    expect(merged!.biasScore).toBe(60);
  });

  it('applies weighted merge when MTF + gamma', () => {
    const mtf = makeBaseState({ biasScore: 60 });
    const gammaState = makeBaseState({
      source: GAMMA_SOURCE,
      biasScore: 100,
      gamma: { gammaEnvironment: 'POSITIVE', gammaMagnitude: 'MEDIUM', gammaFlipLevel: null, distanceToFlip: null, callWall: null, putWall: null, volRegimeBias: 'NEUTRAL', gammaUpdatedAtMs: null },
    });
    const states: StatesBySource = {
      [MTF_SOURCE]: mtf,
      [GAMMA_SOURCE]: gammaState,
    };
    const merged = mergeStatesBySource(states);
    expect(merged).not.toBeNull();
    const expected = 60 * 0.7 + 100 * 0.3;
    expect(merged!.biasScore).toBeCloseTo(expected, 1);
  });

  it('uses configurable weights', () => {
    const mtf = makeBaseState({ biasScore: 50 });
    const gammaState = makeBaseState({
      source: GAMMA_SOURCE,
      biasScore: -70,
      gamma: { gammaEnvironment: 'NEGATIVE', gammaMagnitude: 'HIGH', gammaFlipLevel: null, distanceToFlip: null, callWall: null, putWall: null, volRegimeBias: 'NEUTRAL', gammaUpdatedAtMs: null },
    });
    const states: StatesBySource = { [MTF_SOURCE]: mtf, [GAMMA_SOURCE]: gammaState };
    const merged = mergeStatesBySource(states, { mtfWeight: 0.9, gammaWeight: 0.1 });
    expect(merged).not.toBeNull();
    const expected = 50 * 0.9 + (-70) * 0.1;
    expect(merged!.biasScore).toBeCloseTo(expected, 1);
  });
});
