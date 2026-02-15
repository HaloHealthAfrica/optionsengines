/**
 * Gamma Merge Service
 * Consumes gamma_context_stream, inserts into gamma_context,
 * merges into bias_state_current (Bias State Aggregator) when MTF state exists.
 * Legacy: also updates symbol_market_state for backward compatibility.
 */

import { mtfBiasStreamService, MTF_BIAS_STREAMS } from '../mtf-bias-stream.service.js';
import { marketStateWriter } from './market-state-writer.service.js';
import { parseGammaContextNormalized } from '../../lib/gammaContext/schemas.js';
import { getCurrentState } from '../bias-state-aggregator/bias-state-aggregator.service.js';
import { mergeGammaIntoState } from '../bias-state-aggregator/gamma-merge.service.js';
import { biasRedisService } from '../bias-state-aggregator/bias-redis.service.js';
import { logger } from '../../utils/logger.js';

const EVENT_TYPE = 'MARKET_STATE_UPDATED';

export async function pollAndProcessGammaContextStream(): Promise<number> {
  const messages = await mtfBiasStreamService.read(
    MTF_BIAS_STREAMS.GAMMA_CONTEXT,
    2000
  );

  let processed = 0;

  for (const { id, payload } of messages) {
    const gammaPayload = (payload.gamma ?? payload) as Record<string, unknown>;

    const symbol = gammaPayload?.symbol as string | undefined;
    if (!symbol) {
      logger.warn('Gamma merge: invalid payload missing symbol', { id });
      await mtfBiasStreamService.ack(MTF_BIAS_STREAMS.GAMMA_CONTEXT, id);
      continue;
    }

    try {
      const parsed = parseGammaContextNormalized(gammaPayload);
      if (!parsed.success) {
        logger.warn('Gamma merge: invalid payload', { id, symbol, error: parsed.error.message });
        await mtfBiasStreamService.ack(MTF_BIAS_STREAMS.GAMMA_CONTEXT, id);
        continue;
      }

      await marketStateWriter.upsertFromGammaContext(gammaPayload);

      const data = parsed.data;
      const biasState = await getCurrentState(symbol);
      if (biasState) {
        const acquired = await biasRedisService.acquireLock(symbol);
        if (acquired) {
          try {
            const merged = mergeGammaIntoState(biasState, data);
            await biasRedisService.setCurrent(symbol, merged);
            await biasRedisService.pushHistory(symbol, merged);

            await mtfBiasStreamService.publish(MTF_BIAS_STREAMS.BIAS_STATE_PERSIST, {
              event_id: `gamma-${symbol}-${data.as_of_ts_ms}`,
              event_id_raw: `gamma-${symbol}-${data.as_of_ts_ms}`,
              symbol,
              event_ts_ms: data.as_of_ts_ms,
              source: 'GAMMA_METRICS_SERVICE',
              event_type: 'GAMMA_CONTEXT_UPDATED',
              state_json: merged,
              created_at: new Date().toISOString(),
            });

            await mtfBiasStreamService.publishMarketState({
              event_type: EVENT_TYPE,
              symbol,
              event_id: `gamma-${symbol}-${Date.now()}`,
              state: merged,
              timestamp: Date.now(),
            });
          } finally {
            await biasRedisService.releaseLock(symbol);
          }
        }
      }

      processed++;
    } catch (error) {
      logger.error('Gamma merge failed', { id, symbol, error });
    }

    await mtfBiasStreamService.ack(MTF_BIAS_STREAMS.GAMMA_CONTEXT, id);
  }

  return processed;
}
