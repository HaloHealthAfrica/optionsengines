/**
 * Gamma Merge Service
 * Consumes gamma_context_stream, persists via MarketStateWriter,
 * publishes MARKET_STATE_UPDATED to market_state_stream for downstream consumers.
 */

import { mtfBiasStreamService, MTF_BIAS_STREAMS } from '../mtf-bias-stream.service.js';
import { marketStateWriter } from './market-state-writer.service.js';
import { getSymbolMarketState } from './mtf-bias-state.service.js';
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
      await marketStateWriter.upsertFromGammaContext(gammaPayload);

      const state = await getSymbolMarketState(symbol);
      if (state) {
        await mtfBiasStreamService.publishMarketState({
          event_type: EVENT_TYPE,
          symbol: state.symbol,
          event_id: `gamma-${state.symbol}-${Date.now()}`,
          state: state,
          timestamp: Date.now(),
        });
      }

      processed++;
    } catch (error) {
      logger.error('Gamma merge failed', { id, symbol, error });
    }

    await mtfBiasStreamService.ack(MTF_BIAS_STREAMS.GAMMA_CONTEXT, id);
  }

  return processed;
}
