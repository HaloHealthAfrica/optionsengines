/**
 * MTF Bias Schema v3 - Constants for MTF_BIAS_ENGINE_V3.
 * Used by Bias State Aggregator.
 */

export const MTF_BIAS_SCHEMA_VERSION_V3 = '3';

export const BIAS_VALUES_V3 = ['BULLISH', 'BEARISH', 'NEUTRAL'] as const;
export type BiasValueV3 = (typeof BIAS_VALUES_V3)[number];

export const REGIME_TYPES_V3 = ['TREND', 'RANGE'] as const;
export type RegimeTypeV3 = (typeof REGIME_TYPES_V3)[number];

export const STRUCTURE_VALUES = ['HH_HL', 'LH_LL', 'RANGE'] as const;
export type StructureValue = (typeof STRUCTURE_VALUES)[number];

export const MOMENTUM_VALUES = ['IMPULSE_UP', 'IMPULSE_DOWN', 'DRIFT'] as const;
export type MomentumValue = (typeof MOMENTUM_VALUES)[number];

export const VOLATILITY_VALUES = ['EXPANDING', 'CONTRACTING', 'NORMAL'] as const;
export type VolatilityValue = (typeof VOLATILITY_VALUES)[number];

export const ATR_STATE_VALUES = ['EXPANDING', 'CONTRACTING', 'NORMAL'] as const;
export type AtrStateValue = (typeof ATR_STATE_VALUES)[number];

export const MACRO_CLASS_VALUES = [
  'MACRO_BREAKDOWN_CONFIRMED',
  'MACRO_REVERSAL_RISK',
  'MACRO_TREND_UP',
  'MACRO_TREND_DOWN',
  'MACRO_RANGE',
] as const;
export type MacroClassValue = (typeof MACRO_CLASS_VALUES)[number];

export const VWAP_POSITIONS_V3 = ['ABOVE', 'BELOW', 'CROSSING', 'NA'] as const;
export type VwapPositionV3 = (typeof VWAP_POSITIONS_V3)[number];

export const ORB_STATES_V3 = ['BROKE_UP', 'BROKE_DOWN', 'INSIDE', 'NA'] as const;
export type OrbStateV3 = (typeof ORB_STATES_V3)[number];

export const SPACE_BUCKET_VALUES = ['HIGH', 'MEDIUM', 'LOW', 'NA'] as const;
export type SpaceBucketValue = (typeof SPACE_BUCKET_VALUES)[number];

export const INTENT_TYPES = [
  'REVERSAL',
  'FAKEOUT',
  'COMPRESSION',
  'BREAKOUT',
  'PULLBACK',
  'MEAN_REVERT',
  'NEUTRAL',
] as const;
export type IntentTypeValue = (typeof INTENT_TYPES)[number];

export const TREND_PHASE_VALUES = ['EARLY', 'MID', 'LATE', 'RANGE'] as const;
export type TrendPhaseValue = (typeof TREND_PHASE_VALUES)[number];

export const BAR_TYPE_VALUES = ['1', '2_UP', '2_DOWN', '3', 'NA'] as const;
export type BarTypeValue = (typeof BAR_TYPE_VALUES)[number];

export const PATTERN_VALUES = [
  '2-1-2_UP',
  '2-1-2_DOWN',
  '3-2_REVERSAL_UP',
  '3-2_REVERSAL_DOWN',
  'NA',
] as const;
export type PatternValue = (typeof PATTERN_VALUES)[number];

export const ENTRY_MODE_HINTS_V3 = ['BREAKOUT', 'PULLBACK', 'MEAN_REVERT', 'NO_TRADE'] as const;
export type EntryModeHintV3 = (typeof ENTRY_MODE_HINTS_V3)[number];

export const INVALIDATION_METHOD_VALUES = [
  'M15_PIVOT_LOW',
  'M15_PIVOT_HIGH',
  'ORB_LOW',
  'ORB_HIGH',
  'NA',
] as const;
export type InvalidationMethodValue = (typeof INVALIDATION_METHOD_VALUES)[number];

export const EVENT_TYPES_V3 = ['BIAS_SNAPSHOT', 'BIAS_CHANGE', 'ORB_UPDATE'] as const;
export type EventTypeV3 = (typeof EVENT_TYPES_V3)[number];

export const SESSION_VALUES = ['RTH', 'ETH'] as const;
export type SessionValue = (typeof SESSION_VALUES)[number];
