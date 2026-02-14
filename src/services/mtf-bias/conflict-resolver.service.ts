/**
 * MTF Bias Conflict Resolver
 * Consumes market_state_stream. When multiple indicators publish for same symbol:
 * - Highest confidence_score wins
 * - Tie: prefer TREND regime
 * - Tie: prefer highest timeframe alignment
 * - Tie: HOLD
 * For v1 single source: pass-through with resolution trace.
 */

import { db } from '../database.service.js';
import { mtfBiasStreamService, MTF_BIAS_STREAMS } from '../mtf-bias-stream.service.js';
import { logger } from '../../utils/logger.js';
import type { SymbolMarketState } from '../../lib/mtfBias/types.js';
import { REGIME_TYPES } from '../../lib/mtfBias/constants.js';

const TREND_REGIME = REGIME_TYPES[0];

function resolveConflict(
  candidates: Array<{ state: SymbolMarketState; source: string }>
): { state: SymbolMarketState; source: string; trace: Record<string, unknown> } {
  if (candidates.length === 0) {
    throw new Error('No candidates to resolve');
  }
  if (candidates.length === 1) {
    const c = candidates[0];
    return {
      state: c.state,
      source: c.source,
      trace: { single_source: c.source, resolved_at: Date.now() },
    };
  }

  const sorted = [...candidates].sort((a, b) => {
    const sa = a.state;
    const sb = b.state;
    if (sb.resolved_confidence !== sa.resolved_confidence) {
      return (sb.resolved_confidence ?? 0) - (sa.resolved_confidence ?? 0);
    }
    const aTrend = sa.regime_type === TREND_REGIME ? 1 : 0;
    const bTrend = sb.regime_type === TREND_REGIME ? 1 : 0;
    if (bTrend !== aTrend) return bTrend - aTrend;
    const aAlign = sa.alignment_score;
    const bAlign = sb.alignment_score;
    if (bAlign !== aAlign) return bAlign - aAlign;
    return 0;
  });

  const winner = sorted[0];
  return {
    state: winner.state,
    source: winner.source,
    trace: {
      candidates: candidates.length,
      winner_source: winner.source,
      winner_confidence: winner.state.resolved_confidence,
      winner_regime: winner.state.regime_type,
      resolved_at: Date.now(),
    },
  };
}

export async function processMarketStateUpdate(
  payload: Record<string, unknown>
): Promise<boolean> {
  const eventType = payload.event_type as string;
  const symbol = (payload.symbol as string)?.toUpperCase();
  const state = payload.state as SymbolMarketState;

  if (eventType !== 'MARKET_STATE_UPDATED' || !symbol || !state) {
    return false;
  }

  const source = state.resolved_source ?? 'MTF_BIAS_ENGINE_V1';
  const candidates = [{ state, source }];

  const { state: resolvedState, source: resolvedSource, trace } = resolveConflict(candidates);

  try {
    await db.query(
      `UPDATE symbol_market_state SET
        resolved_bias = $1,
        resolved_confidence = $2,
        resolved_source = $3,
        resolution_trace = $4,
        last_updated_at = NOW()
       WHERE symbol = $5`,
      [
        resolvedState.resolved_bias ?? resolvedState.bias_consensus,
        resolvedState.resolved_confidence ?? resolvedState.confidence_score,
        resolvedSource,
        JSON.stringify(trace),
        symbol,
      ]
    );
  } catch (error) {
    logger.error('Conflict resolver DB update failed', error, { symbol });
    return false;
  }

  await mtfBiasStreamService.publishSetupValidation({
    event_type: 'SETUP_VALIDATION_INPUT',
    symbol,
    state: { ...resolvedState, resolution_trace: trace },
    timestamp: Date.now(),
  });

  logger.info('MTF bias conflict resolved', { symbol, source: resolvedSource });
  return true;
}

export async function pollAndProcessMarketStateStream(): Promise<number> {
  const messages = await mtfBiasStreamService.read(
    MTF_BIAS_STREAMS.MARKET_STATE,
    2000
  );
  let processed = 0;

  for (const { id, payload } of messages) {
    const ok = await processMarketStateUpdate(payload);
    if (ok) processed++;
    await mtfBiasStreamService.ack(MTF_BIAS_STREAMS.MARKET_STATE, id);
  }

  return processed;
}
