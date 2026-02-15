/**
 * MTF Bias v3 - UnifiedBiasState and related types.
 * Canonical contract for Engines A/B and downstream modules.
 */

import type {
  BiasValueV3,
  RegimeTypeV3,
  MacroClassValue,
  IntentTypeValue,
  TrendPhaseValue,
  SpaceBucketValue,
  EntryModeHintV3,
  VwapPositionV3,
  OrbStateV3,
} from './constants-v3.js';

/** Transition flags detected by aggregator */
export interface BiasTransitions {
  biasFlip: boolean;
  regimeFlip: boolean;
  macroFlip: boolean;
  intentChange: boolean;
  liquidityEvent: boolean;
  expansionEvent: boolean;
  compressionEvent: boolean;
}

/** Acceleration deltas (optional) */
export interface BiasAcceleration {
  stateStrengthDelta: number;
  intentMomentumDelta: number;
  macroDriftScore: number;
}

/** VWAP level (normalized) */
export interface UnifiedVwapLevel {
  enabled: boolean;
  value: number | null;
  position: VwapPositionV3;
  distAtr: number | null;
}

/** ORB level (normalized) */
export interface UnifiedOrbLevel {
  enabled: boolean;
  windowMin: number;
  high: number | null;
  low: number | null;
  mid: number | null;
  state: OrbStateV3;
  ageMin: number | null;
}

/** Swing pivots */
export interface UnifiedSwings {
  h1LastPivotHigh: number | null;
  h1LastPivotLow: number | null;
  m15LastPivotHigh: number | null;
  m15LastPivotLow: number | null;
  distToResAtr: number | null;
  distToSupAtr: number | null;
}

/** Levels block */
export interface UnifiedLevels {
  vwap: UnifiedVwapLevel;
  orb: UnifiedOrbLevel;
  swings: UnifiedSwings;
}

/** Liquidity flags */
export interface UnifiedLiquidity {
  sweepHigh: boolean;
  sweepLow: boolean;
  reclaim: boolean;
  equalHighCluster: boolean;
  equalLowCluster: boolean;
}

/** Space buckets */
export interface UnifiedSpace {
  roomToResistance: SpaceBucketValue;
  roomToSupport: SpaceBucketValue;
}

/** Trigger state */
export interface UnifiedTrigger {
  barType: string;
  pattern: string;
  triggered: boolean;
}

/** Intent state */
export interface UnifiedIntent {
  type: IntentTypeValue;
  confidence: number;
  regimeTransition: boolean;
  trendPhase: TrendPhaseValue;
}

/** Invalidation */
export interface UnifiedInvalidation {
  level: number | null;
  method: string;
}

/** Risk context */
export interface UnifiedRiskContext {
  invalidation: UnifiedInvalidation;
  entryModeHint: EntryModeHintV3;
}

/** Macro state */
export interface UnifiedMacroState {
  macroClass: MacroClassValue;
  macroConfidence: number;
  macroSupport1: number | null;
  macroResistance1: number | null;
  macroMeasuredMoveTarget: number | null;
}

/** Gamma context (merged from Gamma Metrics Service) */
export interface UnifiedGammaContext {
  gammaEnvironment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  gammaMagnitude: 'LOW' | 'MEDIUM' | 'HIGH';
  gammaFlipLevel: number | null;
  distanceToFlip: number | null;
  callWall: number | null;
  putWall: number | null;
  volRegimeBias: 'EXPANSION_LIKELY' | 'COMPRESSION_LIKELY' | 'NEUTRAL';
  gammaUpdatedAtMs: number | null;
}

/** Effective gating outputs (computed by aggregator) */
export interface EffectiveGating {
  tradeSuppressed: boolean;
  effectiveBiasScore: number;
  effectiveConfidence: number;
  riskMultiplier: number;
  notes: string[];
}

/** Canonical unified state - engines consume this only */
export interface UnifiedBiasState {
  symbol: string;
  updatedAtMs: number;
  source: string;
  chartTf: string;
  session: string;

  /** Consensus bias */
  bias: BiasValueV3;
  biasScore: number;
  confidence: number;
  alignmentScore: number;
  conflictScore: number;

  /** Regime */
  regimeType: RegimeTypeV3;
  chopScore: number;
  adx15m?: number;
  atrState15m?: string;

  /** Macro */
  macroClass: MacroClassValue;
  macroConfidence: number;
  macroSupport1: number | null;
  macroResistance1: number | null;
  macroMeasuredMoveTarget: number | null;

  /** Intent */
  intentType: IntentTypeValue;
  intentConfidence: number;
  regimeTransition: boolean;
  trendPhase: TrendPhaseValue;

  /** Levels */
  levels: UnifiedLevels;

  /** Trigger */
  trigger: UnifiedTrigger;

  /** Liquidity */
  liquidity: UnifiedLiquidity;

  /** Space */
  space: UnifiedSpace;

  /** Risk */
  riskContext: UnifiedRiskContext;

  /** Gamma (merged from Gamma Metrics Service) */
  gamma?: UnifiedGammaContext;

  /** Transitions (computed) */
  transitions: BiasTransitions;

  /** Effective gating (computed) */
  effective: EffectiveGating;

  /** Acceleration (optional) */
  acceleration?: BiasAcceleration;

  /** Staleness */
  isStale?: boolean;
  lastEventId?: string;
  eventType?: string;
}
