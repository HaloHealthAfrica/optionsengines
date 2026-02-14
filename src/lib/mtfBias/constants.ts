/**
 * MTF Bias Schema v1 - Locked constants.
 * No drift without versioning.
 */

export const MTF_BIAS_SCHEMA_VERSION = '1';

export const BIAS_VALUES = ['BULLISH', 'BEARISH', 'NEUTRAL', 'HOLD'] as const;
export type BiasValue = (typeof BIAS_VALUES)[number];

export const REGIME_TYPES = ['TREND', 'RANGE', 'BREAKOUT', 'BREAKDOWN'] as const;
export type RegimeType = (typeof REGIME_TYPES)[number];

export const ENTRY_MODE_HINTS = ['BREAKOUT', 'PULLBACK', 'MEAN_REVERT'] as const;
export type EntryModeHint = (typeof ENTRY_MODE_HINTS)[number];

export const VWAP_POSITIONS = ['ABOVE', 'BELOW', 'AT'] as const;
export type VwapPosition = (typeof VWAP_POSITIONS)[number];

export const ORB_STATES = ['INSIDE', 'ABOVE', 'BELOW', 'BREAK_UP', 'BREAK_DOWN'] as const;
export type OrbState = (typeof ORB_STATES)[number];
