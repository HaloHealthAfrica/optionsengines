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
}

export async function getSymbolMarketState(symbol: string): Promise<SymbolMarketState | null> {
  const result = await db.query(
    `SELECT symbol, last_event_id, bias_consensus, bias_score, confidence_score,
            alignment_score, conflict_score, regime_type, chop_score, vol_state,
            entry_mode_hint, invalidation_level, resolved_bias, resolved_confidence,
            resolved_source, resolution_trace, full_mtf_json, last_updated_at
     FROM symbol_market_state
     WHERE symbol = $1`,
    [symbol.toUpperCase()]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    symbol: row.symbol,
    last_event_id: row.last_event_id,
    bias_consensus: row.bias_consensus,
    bias_score: Number(row.bias_score),
    confidence_score: Number(row.confidence_score),
    alignment_score: Number(row.alignment_score),
    conflict_score: Number(row.conflict_score),
    regime_type: row.regime_type,
    chop_score: Number(row.chop_score),
    vol_state: row.vol_state,
    entry_mode_hint: row.entry_mode_hint,
    invalidation_level: row.invalidation_level != null ? Number(row.invalidation_level) : null,
    resolved_bias: row.resolved_bias,
    resolved_confidence: row.resolved_confidence != null ? Number(row.resolved_confidence) : null,
    resolved_source: row.resolved_source,
    resolution_trace: row.resolution_trace,
    full_mtf_json: row.full_mtf_json ?? {},
    last_updated_at: row.last_updated_at,
  };
}

/** Structured input for Engine A & B. Returns null if no bias state → HOLD. */
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
  };
}
