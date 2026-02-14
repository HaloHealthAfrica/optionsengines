/**
 * MTF Bias State Aggregator
 * Consumes mtf_bias_stream, updates symbol_market_state, archives to market_state_history,
 * emits MARKET_STATE_UPDATED to market_state_stream.
 */

import { db } from '../database.service.js';
import { mtfBiasStreamService, MTF_BIAS_STREAMS } from '../mtf-bias-stream.service.js';
import { logger } from '../../utils/logger.js';
import type { MTFBiasWebhookPayloadV1 } from '../../lib/mtfBias/schemas.js';
import type { SymbolMarketState } from '../../lib/mtfBias/types.js';

const VOL_STATE_DEFAULT = 'UNKNOWN';

const PRICE_BIAS_MAP: Record<string, 'BULLISH' | 'BEARISH' | 'NEUTRAL'> = {
  BULLISH: 'BULLISH',
  BEARISH: 'BEARISH',
  NEUTRAL: 'NEUTRAL',
  HOLD: 'NEUTRAL',
};

function payloadToState(
  eventId: string,
  symbol: string,
  payload: MTFBiasWebhookPayloadV1
): Omit<SymbolMarketState, 'last_updated_at'> & { latest_price_payload: Record<string, unknown> } {
  const c = payload.mtf.consensus;
  const r = payload.mtf.regime;
  const inv = payload.risk_context.invalidation?.level;

  return {
    symbol,
    last_event_id: eventId,
    bias_consensus: c.bias_consensus,
    bias_score: c.bias_score,
    confidence_score: c.confidence_score,
    alignment_score: c.alignment_score,
    conflict_score: c.conflict_score,
    regime_type: r.type,
    chop_score: r.chop_score,
    vol_state: VOL_STATE_DEFAULT,
    entry_mode_hint: payload.risk_context.entry_mode_hint,
    invalidation_level: inv ?? null,
    resolved_bias: c.bias_consensus,
    resolved_confidence: c.confidence_score,
    resolved_source: 'MTF_BIAS_ENGINE_V1',
    resolution_trace: null,
    full_mtf_json: { mtf: payload.mtf, levels: payload.levels } as unknown as Record<string, unknown>,
    latest_price_payload: payload as unknown as Record<string, unknown>,
  };
}

export async function processMTFBiasEvent(
  eventId: string,
  symbol: string,
  payload: MTFBiasWebhookPayloadV1
): Promise<SymbolMarketState | null> {
  const eventTsMs = payload.event_ts_ms ?? Date.now();

  try {
    const existing = await db.query(
      'SELECT 1 FROM market_state_history WHERE event_id = $1 LIMIT 1',
      [eventId]
    );
    if (existing.rows.length > 0) {
      return null;
    }
  } catch {
    /* continue */
  }

  const state = payloadToState(eventId, symbol, payload);
  const priceBiasConsensus = PRICE_BIAS_MAP[state.bias_consensus] ?? 'NEUTRAL';

  try {
    await db.transaction(async (client) => {
      await client.query(
      `INSERT INTO symbol_market_state (
        symbol, last_event_id, last_event_ts_ms, bias_consensus, bias_score, confidence_score,
        price_bias_consensus, price_bias_score, price_confidence_score,
        alignment_score, conflict_score, regime_type, chop_score, vol_state,
        entry_mode_hint, invalidation_level, resolved_bias, resolved_confidence,
        resolved_source, resolution_trace, full_mtf_json, latest_price_payload, last_updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW())
      ON CONFLICT (symbol) DO UPDATE SET
        last_event_id = EXCLUDED.last_event_id,
        last_event_ts_ms = EXCLUDED.last_event_ts_ms,
        bias_consensus = EXCLUDED.bias_consensus,
        bias_score = EXCLUDED.bias_score,
        confidence_score = EXCLUDED.confidence_score,
        price_bias_consensus = EXCLUDED.price_bias_consensus,
        price_bias_score = EXCLUDED.price_bias_score,
        price_confidence_score = EXCLUDED.price_confidence_score,
        alignment_score = EXCLUDED.alignment_score,
        conflict_score = EXCLUDED.conflict_score,
        regime_type = EXCLUDED.regime_type,
        chop_score = EXCLUDED.chop_score,
        vol_state = EXCLUDED.vol_state,
        entry_mode_hint = EXCLUDED.entry_mode_hint,
        invalidation_level = EXCLUDED.invalidation_level,
        resolved_bias = EXCLUDED.resolved_bias,
        resolved_confidence = EXCLUDED.resolved_confidence,
        resolved_source = EXCLUDED.resolved_source,
        resolution_trace = EXCLUDED.resolution_trace,
        full_mtf_json = EXCLUDED.full_mtf_json,
        latest_price_payload = EXCLUDED.latest_price_payload,
        last_updated_at = NOW()`,
      [
        state.symbol,
        state.last_event_id,
        eventTsMs,
        state.bias_consensus,
        state.bias_score,
        state.confidence_score,
        priceBiasConsensus,
        Math.round(state.bias_score),
        state.confidence_score,
        state.alignment_score,
        state.conflict_score,
        state.regime_type,
        state.chop_score,
        state.vol_state,
        state.entry_mode_hint,
        state.invalidation_level,
        state.resolved_bias,
        state.resolved_confidence,
        state.resolved_source,
        state.resolution_trace ? JSON.stringify(state.resolution_trace) : null,
        JSON.stringify(state.full_mtf_json),
        JSON.stringify(state.latest_price_payload),
      ]
    );

    await client.query(
      `INSERT INTO market_state_history (symbol, event_id, event_type, event_ts_ms, source, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [symbol, eventId, 'MTF_BIAS_UPDATED', eventTsMs, 'MTF_BIAS_ENGINE_V1', JSON.stringify(state)]
    );
    });

    const updated: SymbolMarketState = {
      ...state,
      last_updated_at: new Date(),
    };

    await mtfBiasStreamService.publishMarketState({
      event_type: 'MARKET_STATE_UPDATED',
      symbol,
      event_id: eventId,
      state: updated,
      timestamp: Date.now(),
    });

    logger.info('MTF bias state updated', {
      symbol,
      event_id: eventId,
      bias_consensus: state.bias_consensus,
      confidence_score: state.confidence_score,
      regime_type: state.regime_type,
    });

    return updated;
  } catch (error) {
    logger.error('MTF bias state aggregator failed', error, { symbol, event_id: eventId });
    return null;
  }
}

export async function pollAndProcessMTFBiasStream(): Promise<number> {
  const messages = await mtfBiasStreamService.read(MTF_BIAS_STREAMS.MTF_BIAS, 2000);
  let processed = 0;

  for (const { id, payload } of messages) {
    const eventId = payload.event_id as string;
    const symbol = (payload.symbol as string)?.toUpperCase();
    const data = payload.payload as MTFBiasWebhookPayloadV1;

    if (!eventId || !symbol || !data?.mtf) {
      await mtfBiasStreamService.ack(MTF_BIAS_STREAMS.MTF_BIAS, id);
      continue;
    }

    const result = await processMTFBiasEvent(eventId, symbol, data);
    if (result) {
      processed++;
    }
    await mtfBiasStreamService.ack(MTF_BIAS_STREAMS.MTF_BIAS, id);
  }

  return processed;
}
