/**
 * Market State Writer - Phase 1 Data + Persistence
 * Idempotent upserts for MTF Bias and Gamma Context into symbol_market_state.
 * Does not compute effective (gamma-adjusted) fields.
 */

import { createHash } from 'crypto';
import { db } from '../database.service.js';
import { logger } from '../../utils/logger.js';
import { parseMTFBiasWebhook } from '../../lib/mtfBias/schemas.js';
import { parseGammaContextNormalized } from '../../lib/gammaContext/schemas.js';

const SOURCE_MTF_BIAS = 'MTF_BIAS_ENGINE_V1';
const EVENT_TYPE_MTF = 'MTF_BIAS_UPDATED';
const EVENT_TYPE_GAMMA = 'GAMMA_CONTEXT_UPDATED';

function computeEventId(eventIdRaw: string): string {
  return createHash('sha256').update(eventIdRaw).digest('hex');
}

export const marketStateWriter = {
  /**
   * Upsert symbol_market_state from Pine MTF Bias payload.
   * Idempotent: no-op if event_id already in market_state_history.
   */
  async upsertFromMtfBias(payload: unknown): Promise<{ updated: boolean; event_id: string }> {
    const parsed = parseMTFBiasWebhook(payload);
    if (!parsed.success) {
      const errMsg = parsed.error.issues?.map((i) => i.message).join('; ') ?? parsed.error.message;
      logger.warn('MarketStateWriter: invalid MTF payload', { error: errMsg });
      throw new Error(`Invalid MTF Bias payload: ${errMsg}`);
    }

    const data = parsed.data;
    const eventId = computeEventId(data.event_id_raw);
    const symbol = data.symbol.toUpperCase();

    const result = await db.transaction(async (client) => {
      const existing = await client.query(
        'SELECT 1 FROM market_state_history WHERE event_id = $1',
        [eventId]
      );
      if (existing.rows.length > 0) {
        return { updated: false, event_id: eventId };
      }

      const c = data.mtf.consensus;
      const r = data.mtf.regime;
      const inv = data.risk_context.invalidation?.level ?? null;

      const priceBiasConsensus = mapBiasToPriceConsensus(c.bias_consensus);

      await client.query(
        `INSERT INTO symbol_market_state (
          symbol, last_event_id, last_event_ts_ms,
          bias_consensus, bias_score, confidence_score,
          price_bias_consensus, price_bias_score, price_confidence_score,
          alignment_score, conflict_score, regime_type, chop_score,
          vol_state, entry_mode_hint, invalidation_level,
          resolved_bias, resolved_confidence, resolved_source,
          resolution_trace, full_mtf_json, latest_price_payload,
          last_updated_at
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
          symbol,
          eventId,
          data.event_ts_ms,
          c.bias_consensus,
          c.bias_score,
          c.confidence_score,
          priceBiasConsensus,
          Math.round(c.bias_score),
          c.confidence_score,
          c.alignment_score,
          c.conflict_score,
          r.type,
          r.chop_score,
          'UNKNOWN',
          data.risk_context.entry_mode_hint,
          inv,
          c.bias_consensus,
          c.confidence_score,
          SOURCE_MTF_BIAS,
          null,
          JSON.stringify({ mtf: data.mtf, levels: data.levels, risk_context: data.risk_context }),
          JSON.stringify(payload),
        ]
      );

      const historyPayload = {
        symbol,
        event_id: eventId,
        event_type: EVENT_TYPE_MTF,
        event_ts_ms: data.event_ts_ms,
        source: SOURCE_MTF_BIAS,
        payload: payload,
      };

      await client.query(
        `INSERT INTO market_state_history (symbol, event_id, event_type, event_ts_ms, source, snapshot)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          symbol,
          eventId,
          EVENT_TYPE_MTF,
          data.event_ts_ms,
          SOURCE_MTF_BIAS,
          JSON.stringify(historyPayload),
        ]
      );

      return { updated: true, event_id: eventId };
    });

    if (result.updated) {
      logger.info('MarketStateWriter: MTF bias upserted', {
        symbol,
        event_id: eventId,
        price_bias_score: data.mtf.consensus.bias_score,
      });
    }

    return result;
  },

  /**
   * Upsert gamma context: append to gamma_context, update symbol_market_state gamma fields,
   * record GAMMA_CONTEXT_UPDATED in market_state_history.
   */
  async upsertFromGammaContext(gamma: unknown): Promise<{ updated: boolean; symbol: string }> {
    const parsed = parseGammaContextNormalized(gamma);
    if (!parsed.success) {
      const errMsg = parsed.error.issues?.map((i) => i.message).join('; ') ?? parsed.error.message;
      logger.warn('MarketStateWriter: invalid gamma payload', { error: errMsg });
      throw new Error(`Invalid Gamma Context payload: ${errMsg}`);
    }

    const data = parsed.data;
    const symbol = data.symbol;
    const eventId = `gamma-${symbol}-${data.as_of_ts_ms}`;

    await db.transaction(async (client) => {
      await client.query(
        `INSERT INTO gamma_context (
          symbol, as_of_ts_ms, net_gex, total_gex,
          gamma_environment, gamma_magnitude,
          gamma_flip_level, distance_to_flip,
          call_wall, put_wall, wall_method,
          zero_dte_gamma_ratio, vol_regime_bias,
          raw_provider_payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          symbol,
          data.as_of_ts_ms,
          data.net_gex,
          data.total_gex,
          data.gamma_environment,
          data.gamma_magnitude,
          data.gamma_flip_level,
          data.distance_to_flip,
          data.call_wall,
          data.put_wall,
          data.wall_method,
          data.zero_dte_gamma_ratio,
          data.vol_regime_bias,
          data.raw_provider_payload ? JSON.stringify(data.raw_provider_payload) : null,
        ]
      );

      const gammaUpdatedAt = new Date(data.as_of_ts_ms);

      await client.query(
        `UPDATE symbol_market_state SET
          gamma_environment = $1,
          gamma_magnitude = $2,
          gamma_flip_level = $3,
          distance_to_flip = $4,
          call_wall = $5,
          put_wall = $6,
          wall_method = $7,
          gamma_updated_at = $8,
          vol_regime_bias = $9,
          latest_gamma_payload = $10,
          last_updated_at = NOW()
         WHERE symbol = $11`,
        [
          data.gamma_environment,
          data.gamma_magnitude,
          data.gamma_flip_level,
          data.distance_to_flip,
          data.call_wall,
          data.put_wall,
          data.wall_method,
          gammaUpdatedAt,
          data.vol_regime_bias,
          JSON.stringify(gamma),
          symbol,
        ]
      );

      await client.query(
        `INSERT INTO market_state_history (symbol, event_id, event_type, event_ts_ms, source, snapshot)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          symbol,
          eventId,
          EVENT_TYPE_GAMMA,
          data.as_of_ts_ms,
          'GAMMA_METRICS_SERVICE',
          JSON.stringify({ event_type: EVENT_TYPE_GAMMA, symbol, gamma: data }),
        ]
      );
    });

    logger.info('MarketStateWriter: gamma context upserted', {
      symbol,
      gamma_environment: data.gamma_environment,
      gamma_magnitude: data.gamma_magnitude,
    });

    return { updated: true, symbol };
  },
};

function mapBiasToPriceConsensus(
  bias: string
): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  if (bias === 'BULLISH') return 'BULLISH';
  if (bias === 'BEARISH') return 'BEARISH';
  return 'NEUTRAL';
}
