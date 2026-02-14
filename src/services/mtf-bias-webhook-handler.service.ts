/**
 * MTF Bias Webhook Handler - shared logic for /webhook and /api/webhooks/mtf-bias
 */

import crypto from 'crypto';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { db } from '../services/database.service.js';
import { mtfBiasStreamService } from '../services/mtf-bias-stream.service.js';
import { parseMTFBiasWebhook } from '../lib/mtfBias/schemas.js';

export function isMTFBiasPayload(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return b.event_type === 'BIAS_SNAPSHOT' && typeof b.event_id_raw === 'string';
}

function computeEventId(eventIdRaw: string): string {
  return crypto.createHash('sha256').update(eventIdRaw).digest('hex');
}

export type MTFBiasHandlerResult =
  | { ok: true; status: 'accepted' | 'duplicate_dropped'; eventId: string; symbol: string }
  | { ok: false; status: 422; error: string; details: unknown }
  | { ok: false; status: 500; error: string };

export async function handleMTFBiasWebhook(body: unknown): Promise<MTFBiasHandlerResult> {
  const parsed = parseMTFBiasWebhook(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 422,
      error: 'Invalid payload',
      details: parsed.error.errors,
    };
  }

  const data = parsed.data;
  const eventId = computeEventId(data.event_id_raw);
  const symbol = data.symbol.toUpperCase();

  try {
    const existing = await db.query(
      'SELECT event_id FROM mtf_bias_events WHERE event_id = $1 LIMIT 1',
      [eventId]
    );

    if (existing.rows.length > 0) {
      logger.info('MTF bias webhook duplicate dropped', { event_id: eventId, symbol });
      return { ok: true, status: 'duplicate_dropped', eventId, symbol };
    }

    await db.query(
      `INSERT INTO mtf_bias_events (event_id, event_id_raw, symbol, schema_version, payload)
       VALUES ($1, $2, $3, '1', $4)`,
      [eventId, data.event_id_raw, symbol, JSON.stringify(body)]
    );

    logger.info('MTF bias webhook received', {
      event_id: eventId,
      symbol,
      event_type: data.event_type,
      bias_consensus: data.mtf.consensus.bias_consensus,
      confidence: data.mtf.consensus.confidence_score,
    });

    if (config.redisUrl) {
      await mtfBiasStreamService.connect();
      const streamPayload = {
        event_id: eventId,
        event_id_raw: data.event_id_raw,
        symbol,
        event_type: data.event_type,
        event_ts_ms: data.event_ts_ms,
        payload: data,
        received_at: Date.now(),
      };
      const msgId = await mtfBiasStreamService.publishMTFBias(streamPayload);
      if (!msgId) {
        logger.warn('MTF bias stream publish failed', { event_id: eventId });
      }
    }

    return { ok: true, status: 'accepted', eventId, symbol };
  } catch (error) {
    logger.error('MTF bias webhook processing failed', error, { event_id: eventId, symbol });
    return { ok: false, status: 500, error: 'Processing failed' };
  }
}
