/**
 * Bias State Aggregator - Canonical stateful market bias system.
 * Validates, normalizes, detects transitions, computes effective gating, persists.
 */

import crypto from 'crypto';
import { db } from '../database.service.js';
import { logger } from '../../utils/logger.js';
import { parseMTFBiasWebhookV3, isV3Payload } from '../../lib/mtfBias/schemas-v3.js';
import type { UnifiedBiasState } from '../../lib/mtfBias/types-v3.js';
import { normalizePayloadToState } from './normalizer.js';
import { detectTransitions } from './transition-detector.js';
import { computeEffectiveGating } from './effective-gating.js';
import { computeAcceleration } from './acceleration.js';
import { mergeGammaIntoState } from './gamma-merge.service.js';
import { fetchLatestGamma } from './gamma-fetch.service.js';
import { biasRedisService } from './bias-redis.service.js';
import { mtfBiasStreamService, MTF_BIAS_STREAMS } from '../mtf-bias-stream.service.js';
import { evaluateMarketSession } from '../../utils/market-session.js';

const IDEMPOTENCY_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
const STALENESS_RTH_MINUTES = 10;
const STALENESS_DAILY_MINUTES = 60;

function eventIdHash(eventIdRaw: string): string {
  return crypto.createHash('sha256').update(eventIdRaw).digest('hex');
}

/** Store invalid payload for debugging */
async function storeInvalidPayload(
  eventIdRaw: string,
  symbol: string,
  source: string,
  rawPayload: unknown,
  validationError: string
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO bias_webhook_events (event_id_raw, symbol, source, raw_payload, validation_status, validation_error, created_at)
       VALUES ($1, $2, $3, $4, 'INVALID', $5, NOW())
       ON CONFLICT (event_id_raw) DO UPDATE SET validation_error = EXCLUDED.validation_error`,
      [eventIdRaw, symbol?.toString().toUpperCase() ?? 'UNKNOWN', source ?? 'unknown', JSON.stringify(rawPayload), validationError]
    );
  } catch (err) {
    logger.error('Failed to store invalid bias webhook', { eventIdRaw, error: err });
  }
}

/** Check idempotency. Returns true if duplicate. */
async function isDuplicate(eventIdRaw: string): Promise<boolean> {
  const hash = eventIdHash(eventIdRaw);
  const newlySet = await biasRedisService.setIdempotency(hash, IDEMPOTENCY_TTL_SEC);
  if (newlySet) return false;
  try {
    const r = await db.query(
      'SELECT 1 FROM bias_state_history WHERE event_id_raw = $1 LIMIT 1',
      [eventIdRaw]
    );
    return r.rows.length > 0;
  } catch {
    return true;
  }
}

/** Mark event as seen for idempotency (call after setIdempotency succeeds to extend TTL) */
async function markSeen(eventIdRaw: string): Promise<void> {
  await biasRedisService.markIdempotency(eventIdHash(eventIdRaw), IDEMPOTENCY_TTL_SEC);
}

/** Compute isStale based on session */
function computeStaleness(updatedAtMs: number, session: string): boolean {
  const now = Date.now();
  const ageMinutes = (now - updatedAtMs) / 60_000;
  const sessionEval = evaluateMarketSession({
    timestamp: new Date(now),
    allowPremarket: true,
    allowAfterhours: true,
    gracePeriodMinutes: 0,
  });
  const isRth = sessionEval.sessionLabel === 'RTH' || session === 'RTH';
  const threshold = isRth ? STALENESS_RTH_MINUTES : STALENESS_DAILY_MINUTES;
  return ageMinutes > threshold;
}

export type BiasAggregatorUpdateResult =
  | { ok: true; status: 'accepted' | 'duplicate' | 'out_of_order'; state: UnifiedBiasState; eventId: string }
  | { ok: false; status: 400; error: string; details?: unknown }
  | { ok: false; status: 422; error: string; details?: unknown }
  | { ok: false; status: 500; error: string };

/**
 * Update canonical bias state from V3 webhook payload.
 * Sync: validate, Redis lock, compute, write Redis, publish stream. Worker persists to DB.
 */
export async function update(input: unknown): Promise<BiasAggregatorUpdateResult> {
  const parsed = parseMTFBiasWebhookV3(input);
  if (!parsed.success) {
    const b = input as Record<string, unknown>;
    const eventIdRaw = typeof b?.event_id_raw === 'string' ? b.event_id_raw : 'unknown';
    const symbol = typeof b?.symbol === 'string' ? b.symbol : 'UNKNOWN';
    const source = typeof b?.source === 'string' ? b.source : 'unknown';
    await storeInvalidPayload(
      eventIdRaw,
      symbol,
      source,
      input,
      parsed.error.message
    );
    return {
      ok: false,
      status: 422,
      error: 'Invalid payload',
      details: parsed.error.errors,
    };
  }

  const payload = parsed.data;
  const eventId = eventIdHash(payload.event_id_raw);
  const symbol = payload.symbol.toUpperCase();

  const duplicate = await isDuplicate(payload.event_id_raw);
  if (duplicate) {
    logger.info('Bias webhook duplicate ignored', { event_id_raw: payload.event_id_raw, symbol });
    const existing = await biasRedisService.getCurrent(symbol);
    return {
      ok: true,
      status: 'duplicate',
      state: existing ?? ({} as UnifiedBiasState),
      eventId,
    };
  }

  await markSeen(payload.event_id_raw);

  const acquired = await biasRedisService.acquireLock(symbol);
  if (!acquired) {
    logger.warn('Bias aggregator lock not acquired, skipping', { symbol });
    return {
      ok: false,
      status: 500,
      error: 'Could not acquire lock',
    };
  }

  try {
    const prev = await biasRedisService.getCurrent(symbol);

    if (prev && payload.event_ts_ms <= prev.updatedAtMs) {
      logger.info('Bias webhook out-of-order, not overwriting', {
        event_ts_ms: payload.event_ts_ms,
        current_updated: prev.updatedAtMs,
        symbol,
      });
      return {
        ok: true,
        status: 'out_of_order',
        state: prev,
        eventId,
      };
    }

    const normalized = normalizePayloadToState(payload, eventId);
    const transitions = detectTransitions({ prev, curr: normalized as UnifiedBiasState });
    const effective = await computeEffectiveGating({
      ...normalized,
      transitions,
      effective: normalized.effective,
    } as UnifiedBiasState);
    const acceleration = computeAcceleration(prev, normalized as UnifiedBiasState, transitions.macroFlip);

    let state: UnifiedBiasState = {
      ...normalized,
      transitions,
      effective,
      acceleration,
      isStale: computeStaleness(payload.event_ts_ms, payload.session),
    } as UnifiedBiasState;

    const gamma = await fetchLatestGamma(symbol);
    if (gamma) {
      state = mergeGammaIntoState(state, gamma);
    }

    await biasRedisService.setCurrent(symbol, state);
    await biasRedisService.pushHistory(symbol, state);

    await mtfBiasStreamService.publish(MTF_BIAS_STREAMS.BIAS_STATE_PERSIST, {
      event_id: eventId,
      event_id_raw: payload.event_id_raw,
      symbol,
      event_ts_ms: payload.event_ts_ms,
      source: payload.source,
      event_type: payload.event_type,
      state_json: state,
      created_at: new Date().toISOString(),
    });

    logger.info('Bias state updated', {
      symbol,
      event_id: eventId,
      bias: state.bias,
      confidence: state.confidence,
      tradeSuppressed: state.effective.tradeSuppressed,
      transitions: Object.entries(transitions).filter(([, v]) => v).map(([k]) => k),
    });

    return { ok: true, status: 'accepted', state, eventId };
  } finally {
    await biasRedisService.releaseLock(symbol);
  }
}

/** Get current unified state (Redis first, then DB) */
export async function getCurrentState(symbol: string): Promise<UnifiedBiasState | null> {
  const sym = symbol.toUpperCase();
  const fromRedis = await biasRedisService.getCurrent(sym);
  if (fromRedis) return fromRedis;

  try {
    const r = await db.query(
      `SELECT state_json, updated_at_ms FROM bias_state_current WHERE symbol = $1`,
      [sym]
    );
    const row = r.rows[0];
    if (!row?.state_json) return null;
    const state = row.state_json as UnifiedBiasState;
    state.isStale = computeStaleness(row.updated_at_ms ?? state.updatedAtMs, state.session ?? 'RTH');
    return state;
  } catch {
    return null;
  }
}

/** Get history (Redis first, then DB) */
export async function getHistory(symbol: string, limit: number = 50): Promise<UnifiedBiasState[]> {
  const sym = symbol.toUpperCase();
  const fromRedis = await biasRedisService.getHistory(sym, limit);
  if (fromRedis.length > 0) return fromRedis;

  try {
    const r = await db.query(
      `SELECT state_json FROM bias_state_history WHERE symbol = $1 ORDER BY event_ts_ms DESC LIMIT $2`,
      [sym, limit]
    );
    return r.rows.map((row) => row.state_json as UnifiedBiasState);
  } catch {
    return [];
  }
}

/** Check if payload should route to V3 pipeline */
export function shouldRouteToV3(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  if (p.source === 'MTF_BIAS_ENGINE_V3') return true;
  return isV3Payload(payload);
}
