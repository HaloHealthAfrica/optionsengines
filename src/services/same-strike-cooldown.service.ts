/**
 * Same-Strike Cooldown Service
 *
 * Blocks new orders for the same strike within a cooldown window UNLESS:
 * - Different decision engine (A vs B)
 * - Different webhook source (e.g. STRAT vs ORB vs TREND)
 *
 * Reduces duplicate trades from multiple timeframes/sources hitting the same strike.
 */

import { db } from './database.service.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

/** Extract normalized webhook source from raw payload (matches webhook detectIndicatorSource) */
export function extractWebhookSource(rawPayload: Record<string, unknown> | null | undefined): string {
  if (!rawPayload || typeof rawPayload !== 'object') return 'UNKNOWN';
  const meta = rawPayload.meta as Record<string, unknown> | undefined;
  const journal = rawPayload.journal as Record<string, unknown> | undefined;
  const metaEngine = meta?.engine;
  const journalEngine = journal?.engine;
  if (metaEngine === 'SATY_PO') return 'SATY_PHASE';
  if (journalEngine === 'STRAT_V6_FULL') return 'STRAT';
  if (
    rawPayload.timeframes != null &&
    rawPayload.bias != null &&
    rawPayload.ticker != null
  )
    return 'TREND';
  const indicator = rawPayload.indicator;
  if (
    typeof indicator === 'string' &&
    ['ORB', 'Stretch', 'BHCH', 'EMA'].includes(indicator)
  )
    return 'ORB';
  if (
    rawPayload.trend != null &&
    typeof (rawPayload as Record<string, unknown>).score === 'number' &&
    rawPayload.signal != null
  )
    return 'SIGNALS';
  const source = rawPayload.source ?? rawPayload.strategy ?? rawPayload.indicator;
  if (typeof source === 'string') return source;
  return 'UNKNOWN';
}

export interface SameStrikeCooldownParams {
  optionSymbol: string;
  engine: 'A' | 'B';
  webhookSource: string;
  isTest?: boolean;
}

/**
 * Returns true if we should BLOCK (skip) this order due to same-strike cooldown.
 * Block when: recent filled order for same strike + same engine + same source.
 * Allow when: different engine OR different source.
 */
export async function shouldBlockSameStrike(params: SameStrikeCooldownParams): Promise<boolean> {
  if (!config.enableSameStrikeCooldown) return false;
  const cooldownMinutes = config.cooldownMinutesSameStrike;
  if (cooldownMinutes <= 0) return false;

  const { optionSymbol, engine, webhookSource, isTest = false } = params;

  const cutoff = new Date(Date.now() - cooldownMinutes * 60 * 1000);

  try {
    // Check both filled trades AND pending/unfilled orders to prevent burst duplicates
    const [filledResult, pendingResult] = await Promise.all([
      db.query<{ engine: string; raw_payload: unknown }>(
        `SELECT o.engine, s.raw_payload
         FROM orders o
         JOIN signals s ON s.signal_id = o.signal_id
         JOIN trades t ON t.order_id = o.order_id
         WHERE o.option_symbol = $1
           AND o.status = 'filled'
           AND t.fill_timestamp > $2
           AND COALESCE(o.is_test, false) = $3
         ORDER BY t.fill_timestamp DESC
         LIMIT 20`,
        [optionSymbol, cutoff, isTest]
      ),
      db.query<{ engine: string; raw_payload: unknown }>(
        `SELECT o.engine, s.raw_payload
         FROM orders o
         JOIN signals s ON s.signal_id = o.signal_id
         WHERE o.option_symbol = $1
           AND o.status IN ('pending_execution', 'pending')
           AND o.created_at > $2
           AND COALESCE(o.is_test, false) = $3
         ORDER BY o.created_at DESC
         LIMIT 20`,
        [optionSymbol, cutoff, isTest]
      ),
    ]);

    const allRows = [...filledResult.rows, ...pendingResult.rows];
    for (const row of allRows) {
      const prevEngine = (row.engine ?? 'A') as 'A' | 'B';
      const prevPayload =
        typeof row.raw_payload === 'object' && row.raw_payload != null
          ? (row.raw_payload as Record<string, unknown>)
          : {};
      const prevSource = extractWebhookSource(prevPayload);

      if (prevEngine === engine && prevSource === webhookSource) {
        logger.info('Same-strike cooldown: blocking duplicate', {
          optionSymbol,
          engine,
          webhookSource,
          prevEngine,
          prevSource,
        });
        return true;
      }
    }

    return false;
  } catch (error) {
    logger.warn('Same-strike cooldown check failed, allowing order', {
      optionSymbol,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
