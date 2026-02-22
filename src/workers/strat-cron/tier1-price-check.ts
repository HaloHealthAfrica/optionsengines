/**
 * Tier 1: Price Check & Score Re-evaluation (Every 5 Minutes)
 * Lightweight loop: re-evaluates active alerts with fresh price data.
 * Does NOT scan for new patterns.
 */

import { db } from '../../services/database.service.js';
import { marketData } from '../../services/market-data.js';
import {
  recalculateScore,
  buildScoreSnapshot,
  getCurrentScoringWeights,
} from './score-recalculation.js';
import { appendScoreHistory, updateDerivedFields } from './score-history.js';
import { checkTriggerAndInvalidation } from './trigger-invalidation.js';
import { checkScoreAlerts } from './score-alerts.js';
import { publishStratScoresUpdated } from '../../services/realtime-updates.service.js';
import { isMarketOpen, isPreMarket } from '../../utils/market-hours.js';
import { logger } from '../../utils/logger.js';
import type { StratAlertRow } from './types.js';
import * as Sentry from '@sentry/node';

export interface Tier1Result {
  alertCount: number;
  triggers: number;
  invalidations: number;
  integrityBroken: number;
}

function parseAlertRow(row: Record<string, unknown>): StratAlertRow {
  const sh = row.score_history;
  return {
    alert_id: row.alert_id as string,
    symbol: row.symbol as string,
    direction: row.direction as string,
    timeframe: row.timeframe as string,
    setup: row.setup as string,
    entry: row.entry as string | number,
    target: row.target as string | number,
    stop: row.stop as string | number,
    score: Number(row.score ?? 0),
    current_score: row.current_score != null ? Number(row.current_score) : null,
    initial_score: row.initial_score != null ? Number(row.initial_score) : null,
    score_trend: row.score_trend as string | null,
    peak_score: row.peak_score != null ? Number(row.peak_score) : null,
    score_history: Array.isArray(sh) ? (sh as StratAlertRow['score_history']) : [],
    c1_type: row.c1_type as string | null,
    c2_type: row.c2_type as string | null,
    c1_high: row.c1_high != null ? Number(row.c1_high) : null,
    c1_low: row.c1_low != null ? Number(row.c1_low) : null,
    c2_high: row.c2_high != null ? Number(row.c2_high) : null,
    c2_low: row.c2_low != null ? Number(row.c2_low) : null,
    tf_confluence: row.tf_confluence as Record<string, unknown> | null,
    tf_confluence_count: row.tf_confluence_count != null ? Number(row.tf_confluence_count) : null,
    rvol: row.rvol as string | null,
    pattern_quality_score: row.pattern_quality_score != null ? Number(row.pattern_quality_score) : null,
    candle_shape_score: row.candle_shape_score != null ? Number(row.candle_shape_score) : null,
    flow_alignment_score: row.flow_alignment_score != null ? Number(row.flow_alignment_score) : null,
    flow_sentiment: row.flow_sentiment as string | null,
    status: row.status as string,
    created_at: row.created_at as Date | string,
    expires_at: row.expires_at as Date | string | null,
  };
}

export async function runTier1PriceCheck(): Promise<Tier1Result> {
  const result: Tier1Result = {
    alertCount: 0,
    triggers: 0,
    invalidations: 0,
    integrityBroken: 0,
  };

  try {
  if (!isMarketOpen() && !isPreMarket()) {
    logger.debug('Tier 1: outside trading window, skipping');
    return result;
  }

  const alertsResult = await db.query(
    `SELECT alert_id, symbol, direction, timeframe, setup, entry, target, stop,
            score, current_score, initial_score, score_trend, peak_score, score_history,
            c1_type, c2_type, c1_high, c1_low, c2_high, c2_low,
            tf_confluence, tf_confluence_count, rvol,
            pattern_quality_score, candle_shape_score, flow_alignment_score, flow_sentiment,
            status, created_at, expires_at
     FROM strat_alerts
     WHERE status IN ('pending', 'triggered', 'watching')
     ORDER BY created_at DESC`
  );

  const activeAlerts = alertsResult.rows.map(parseAlertRow);
  if (activeAlerts.length === 0) {
    return result;
  }

  result.alertCount = activeAlerts.length;

  const symbols = [...new Set(activeAlerts.map((a) => a.symbol))];
  const prices = await marketData.getStockPrices(symbols);
  const weights = await getCurrentScoringWeights();

  for (const alert of activeAlerts) {
    const currentPrice = prices[alert.symbol];
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) continue;

    // Skip if already triggered/invalidated/archived (from previous iteration)
    if (['triggered', 'invalidated', 'archived'].includes(alert.status)) continue;

    // Expire if past expires_at
    if (alert.expires_at && new Date() > new Date(alert.expires_at)) {
      await db.query(
        `UPDATE strat_alerts SET status = 'expired' WHERE alert_id = $1`,
        [alert.alert_id]
      );
      continue;
    }

    const { score: newScore, factors } = recalculateScore(alert, currentPrice, weights);
    const snapshot = buildScoreSnapshot(
      alert,
      newScore,
      currentPrice,
      factors,
      'tier1'
    );

    const updatedHistory = await appendScoreHistory(alert.alert_id, snapshot);
    await updateDerivedFields(alert.alert_id, newScore, updatedHistory);

    const tiResult = await checkTriggerAndInvalidation(
      { ...alert, current_score: newScore, score_history: updatedHistory },
      currentPrice
    );
    result.triggers += tiResult.triggered;
    result.invalidations += tiResult.invalidated;
    result.integrityBroken += tiResult.integrityBroken;

    if (tiResult.triggered > 0 || tiResult.invalidated > 0) continue;

    await checkScoreAlerts(
      { ...alert, current_score: newScore, score_history: updatedHistory },
      newScore,
      updatedHistory
    );
  }

  publishStratScoresUpdated({
    timestamp: new Date().toISOString(),
    alertCount: result.alertCount,
  });

  logger.info('Tier 1 price check complete', result);
  return result;
  } catch (err) {
    logger.error('Tier 1 price check failed', err);
    Sentry.captureException(err, { tags: { worker: 'strat-cron', tier: 'tier1' } });
    return result;
  }
}
