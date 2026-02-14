/**
 * MTF Bias types - Schema v1.
 */

import type { BiasValue, RegimeType, EntryModeHint, VwapPosition, OrbState } from './constants.js';

export interface MTFTimeframe {
  tf: string;
  bias: BiasValue;
  strength: number;
}

export interface MTFConsensus {
  bias_consensus: BiasValue;
  bias_score: number;
  confidence_score: number;
  alignment_score: number;
  conflict_score: number;
}

export interface MTFRegime {
  type: RegimeType;
  chop_score: number;
}

export interface MTFBlock {
  timeframes: MTFTimeframe[];
  consensus: MTFConsensus;
  regime: MTFRegime;
}

export interface VwapLevel {
  value: number;
  position: VwapPosition;
}

export interface OrbLevel {
  high: number;
  low: number;
  state: OrbState;
}

export interface LevelsBlock {
  vwap: VwapLevel;
  orb: OrbLevel;
}

export interface InvalidationLevel {
  level: number;
}

export interface RiskContextBlock {
  invalidation: InvalidationLevel;
  entry_mode_hint: EntryModeHint;
}

export interface BarBlock {
  time_ms: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MTFBiasWebhookPayload {
  event_type: string;
  event_ts_ms: number;
  event_id_raw: string;
  symbol: string;
  exchange?: string;
  session?: string;
  source?: string;
  chart_tf: string;
  bar?: BarBlock;
  mtf: MTFBlock;
  levels: LevelsBlock;
  risk_context: RiskContextBlock;
}

export interface SymbolMarketState {
  symbol: string;
  last_event_id: string;
  bias_consensus: BiasValue;
  bias_score: number;
  confidence_score: number;
  alignment_score: number;
  conflict_score: number;
  regime_type: RegimeType;
  chop_score: number;
  vol_state: string;
  entry_mode_hint: EntryModeHint;
  invalidation_level: number | null;
  resolved_bias: BiasValue | null;
  resolved_confidence: number | null;
  resolved_source: string | null;
  resolution_trace: Record<string, unknown> | null;
  full_mtf_json: Record<string, unknown>;
  last_updated_at: Date;
}

export interface MarketStateUpdatedEvent {
  event_type: 'MARKET_STATE_UPDATED';
  symbol: string;
  event_id: string;
  state: SymbolMarketState;
  timestamp: number;
}
