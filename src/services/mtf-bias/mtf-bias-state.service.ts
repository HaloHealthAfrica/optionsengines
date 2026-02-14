/**
 * MTF Bias State Service
 * Source of truth for current market bias per symbol.
 * Engine A/B MUST have bias state for entry decisions - missing → HOLD.
 */

import { db } from '../database.service.js';
import type { SymbolMarketState } from '../../lib/mtfBias/types.js';

export interface MTFBiasContext {
  resolved_bias: string;
  confidence_score: number;
  regime_type: string;
  chop_score: number;
  alignment_score: number;
  conflict_score: number;
  vol_state: string;
  space_to_move: number | null;
  invalidation_level: number | null;
  entry_mode_hint: string;
  vwap?: { value: number; position: string };
  orb?: { high: number; low: number; state: string };
  /** Phase 1: price-derived bias (Pine MTF) */
  price_bias_score?: number | null;
  price_confidence_score?: number | null;
  price_bias_consensus?: string | null;
  /** Phase 1: gamma context (merged) */
  gamma_environment?: string | null;
  gamma_magnitude?: string | null;
  gamma_flip_level?: number | null;
  distance_to_flip?: number | null;
  call_wall?: number | null;
  put_wall?: number | null;
  vol_regime_bias?: string | null;
  gamma_updated_at?: Date | null;
}

export async function getSymbolMarketState(symbol: string): Promise<SymbolMarketState | null> {
  const result = await db.query(
    `SELECT symbol, last_event_id, bias_consensus, bias_score, confidence_score,
            alignment_score, conflict_score, regime_type, chop_score, vol_state,
            entry_mode_hint, invalidation_level, resolved_bias, resolved_confidence,
            resolved_source, resolution_trace, full_mtf_json, last_updated_at,
            price_bias_consensus, price_bias_score, price_confidence_score,
            gamma_environment, gamma_magnitude, gamma_flip_level, distance_to_flip,
            call_wall, put_wall, gamma_updated_at, vol_regime_bias
     FROM symbol_market_state
     WHERE symbol = $1`,
    [symbol.toUpperCase()]
  );

  const row = result.rows[0];
  if (!row) return null;

  return rowToSymbolMarketState(row);
}

function rowToSymbolMarketState(row: Record<string, unknown>): SymbolMarketState {
  return {
    symbol: row.symbol as string,
    last_event_id: row.last_event_id as string,
    bias_consensus: row.bias_consensus as unknown as SymbolMarketState['bias_consensus'],
    bias_score: Number(row.bias_score),
    confidence_score: Number(row.confidence_score),
    alignment_score: Number(row.alignment_score),
    conflict_score: Number(row.conflict_score),
    regime_type: row.regime_type as unknown as SymbolMarketState['regime_type'],
    chop_score: Number(row.chop_score),
    vol_state: row.vol_state as string,
    entry_mode_hint: row.entry_mode_hint as unknown as SymbolMarketState['entry_mode_hint'],
    invalidation_level: row.invalidation_level != null ? Number(row.invalidation_level) : null,
    resolved_bias: row.resolved_bias as unknown as SymbolMarketState['resolved_bias'],
    resolved_confidence: row.resolved_confidence != null ? Number(row.resolved_confidence) : null,
    resolved_source: row.resolved_source as string | null,
    resolution_trace: row.resolution_trace as Record<string, unknown> | null,
    full_mtf_json: (row.full_mtf_json ?? {}) as Record<string, unknown>,
    last_updated_at: row.last_updated_at as Date,
    price_bias_consensus: row.price_bias_consensus as string | null | undefined,
    price_bias_score: row.price_bias_score != null ? Number(row.price_bias_score) : null,
    price_confidence_score: row.price_confidence_score != null ? Number(row.price_confidence_score) : null,
    gamma_environment: row.gamma_environment as unknown as SymbolMarketState['gamma_environment'],
    gamma_magnitude: row.gamma_magnitude as unknown as SymbolMarketState['gamma_magnitude'],
    gamma_flip_level: row.gamma_flip_level != null ? Number(row.gamma_flip_level) : null,
    distance_to_flip: row.distance_to_flip != null ? Number(row.distance_to_flip) : null,
    call_wall: row.call_wall != null ? Number(row.call_wall) : null,
    put_wall: row.put_wall != null ? Number(row.put_wall) : null,
    gamma_updated_at: row.gamma_updated_at as Date | null | undefined,
    vol_regime_bias: row.vol_regime_bias as unknown as SymbolMarketState['vol_regime_bias'],
  };
}

/** Structured input for Engine A & B. Returns null if no bias state → HOLD. Includes merged gamma context when available. */
export async function getMTFBiasContext(symbol: string): Promise<MTFBiasContext | null> {
  const state = await getSymbolMarketState(symbol);
  if (!state) return null;

  const full = state.full_mtf_json as Record<string, unknown>;
  const levels = full?.levels as Record<string, unknown> | undefined;

  return {
    resolved_bias: state.resolved_bias ?? state.bias_consensus,
    confidence_score: state.confidence_score,
    regime_type: state.regime_type,
    chop_score: state.chop_score,
    alignment_score: state.alignment_score,
    conflict_score: state.conflict_score,
    vol_state: state.vol_state,
    space_to_move: null,
    invalidation_level: state.invalidation_level,
    entry_mode_hint: state.entry_mode_hint,
    vwap: levels?.vwap as MTFBiasContext['vwap'],
    orb: levels?.orb as MTFBiasContext['orb'],
    price_bias_score: state.price_bias_score ?? null,
    price_confidence_score: state.price_confidence_score ?? null,
    price_bias_consensus: state.price_bias_consensus ?? null,
    gamma_environment: state.gamma_environment ?? null,
    gamma_magnitude: state.gamma_magnitude ?? null,
    gamma_flip_level: state.gamma_flip_level ?? null,
    distance_to_flip: state.distance_to_flip ?? null,
    call_wall: state.call_wall ?? null,
    put_wall: state.put_wall ?? null,
    vol_regime_bias: state.vol_regime_bias ?? null,
    gamma_updated_at: state.gamma_updated_at ?? null,
  };
}
