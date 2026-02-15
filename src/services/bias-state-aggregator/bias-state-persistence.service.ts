/**
 * Bias State Persistence Service - Worker consumes stream, persists to DB.
 */

import { db } from '../database.service.js';
import { mtfBiasStreamService, MTF_BIAS_STREAMS } from '../mtf-bias-stream.service.js';
import { logger } from '../../utils/logger.js';

/** Poll bias_state_persist_stream and persist to bias_state_current + bias_state_history */
export async function pollAndPersistBiasState(): Promise<number> {
  const messages = await mtfBiasStreamService.read(MTF_BIAS_STREAMS.BIAS_STATE_PERSIST, 2000);
  let persisted = 0;

  for (const { id, payload } of messages) {
    const eventId = payload.event_id as string;
    const eventIdRaw = payload.event_id_raw as string;
    const symbol = (payload.symbol as string)?.toUpperCase();
    const eventTsMs = payload.event_ts_ms as number;
    const source = (payload.source as string) ?? 'MTF_BIAS_ENGINE_V3';
    const eventType = payload.event_type as string | undefined;
    const stateJson = payload.state_json as Record<string, unknown>;

    if (!eventId || !eventIdRaw || !symbol || !stateJson) {
      await mtfBiasStreamService.ack(MTF_BIAS_STREAMS.BIAS_STATE_PERSIST, id);
      continue;
    }

    try {
      await db.transaction(async (client) => {
        await client.query(
          `INSERT INTO bias_state_history (symbol, event_id_raw, event_ts_ms, event_id, source, event_type, state_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (event_id_raw) DO NOTHING`,
          [symbol, eventIdRaw, eventTsMs, eventId, source, eventType ?? null, JSON.stringify(stateJson)]
        );

        await client.query(
          `INSERT INTO bias_state_current (symbol, updated_at_ms, source, state_json, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (symbol) DO UPDATE SET
             updated_at_ms = EXCLUDED.updated_at_ms,
             source = EXCLUDED.source,
             state_json = EXCLUDED.state_json,
             updated_at = NOW()`,
          [symbol, stateJson.updatedAtMs ?? eventTsMs, source, JSON.stringify(stateJson)]
        );
      });
      persisted++;
    } catch (err) {
      logger.error('Bias state persistence failed', { symbol, event_id: eventId, error: err });
    }

    await mtfBiasStreamService.ack(MTF_BIAS_STREAMS.BIAS_STATE_PERSIST, id);
  }

  return persisted;
}
