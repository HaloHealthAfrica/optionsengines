/**
 * Trade Audit Service - Runs diagnostic queries and generates recommendations.
 * Uses refactored_positions (not legacy positions table).
 */

import { db } from './database.service.js';
import { logger } from '../utils/logger.js';

export interface AuditTrailRow {
  event_id: string;
  webhook_time: string;
  signal_id: string;
  symbol: string;
  direction: string;
  timeframe: string;
  variant: string;
  net_gex: number | null;
  zero_gamma_level: number | null;
  entry_market_price: number | null;
  rec_engine: string | null;
  rec_strike: number | null;
  rec_expiration: string | null;
  rec_quantity: number | null;
  rec_confidence: string | null;
  order_type: string | null;
  option_symbol: string | null;
  fill_price: number | null;
  fill_quantity: number | null;
  fill_timestamp: string | null;
  unrealized_pnl: number | null;
  realized_pnl: number | null;
  position_status: string | null;
  webhook_to_fill_seconds: number | null;
}

export interface ViolationRow {
  signal_id: string;
  symbol: string;
  direction: string;
  option_symbol: string | null;
  fill_price: number | null;
  net_gex: number | null;
  zero_gamma_level: number | null;
  current_price: number | null;
  violations: string[];
}

export interface AuditResult {
  auditTrail: AuditTrailRow[];
  violations: ViolationRow[];
  violationSummary: Record<string, number>;
  recommendations: string[];
  runAt: string;
  dateFilter: string;
}

function buildRecommendations(
  auditTrail: AuditTrailRow[],
  _violations: ViolationRow[],
  violationSummary: Record<string, number>
): string[] {
  const recs: string[] = [];

  const noGexCount = violationSummary['NO_GEX_DATA'] ?? 0;
  if (noGexCount > 0) {
    recs.push(
      `GEX data missing for ${noGexCount} trade(s). Enable ENABLE_DEALER_UW_GAMMA or verify MarketData.app/Unusual Whales GEX sources.`
    );
  }

  const shortGammaOversized = violationSummary['SHORT_GAMMA_OVERSIZED'] ?? 0;
  if (shortGammaOversized > 0) {
    recs.push(
      `${shortGammaOversized} trade(s) oversized in short gamma regime. Consider reducing position size when dealer is short gamma.`
    );
  }

  const longBelowZero = violationSummary['LONG_BELOW_ZERO_GAMMA'] ?? 0;
  const shortAboveZero = violationSummary['SHORT_ABOVE_ZERO_GAMMA'] ?? 0;
  if (longBelowZero > 0 || shortAboveZero > 0) {
    recs.push(
      `${longBelowZero + shortAboveZero} trade(s) against zero gamma level. Review strike selection and gamma regime alignment.`
    );
  }

  const flowContradicts =
    (violationSummary['LONG_AGAINST_BEARISH_FLOW'] ?? 0) +
    (violationSummary['SHORT_AGAINST_BULLISH_FLOW'] ?? 0);
  if (flowContradicts > 0) {
    recs.push(
      `${flowContradicts} trade(s) contradict options flow. Consider raising CONFLUENCE_MIN_THRESHOLD or reviewing flow alignment.`
    );
  }

  const engineBCount = auditTrail.filter((r) => r.variant === 'B').length;
  const engineBFilled = auditTrail.filter(
    (r) => r.variant === 'B' && r.fill_price != null
  ).length;
  if (engineBCount > 0 && engineBFilled === 0) {
    recs.push(
      `Engine B had ${engineBCount} signal(s) but 0 fills. Check logs for "Engine B returned no recommendation" or "Engine B signal not trading".`
    );
  }

  const allZeros = auditTrail.filter(
    (r) => r.net_gex === 0 && r.zero_gamma_level == null
  ).length;
  if (allZeros > 0 && auditTrail.length > 0) {
    recs.push(
      `${allZeros} trade(s) had zero GEX. Ensure Unusual Whales gamma fallback is enabled when MarketData.app returns zeros.`
    );
  }

  if (recs.length === 0 && auditTrail.length > 0) {
    recs.push('No critical issues detected. Audit passed.');
  } else if (auditTrail.length === 0) {
    recs.push('No trades found for the selected date. Run audit after market activity.');
  }

  return recs;
}

export async function runTradeAudit(dateFilter: string = 'CURRENT_DATE'): Promise<AuditResult> {
  const runAt = new Date().toISOString();

  let auditTrail: AuditTrailRow[] = [];
  let violations: ViolationRow[] = [];
  const violationSummary: Record<string, number> = {};

  const useCurrentDate = dateFilter === 'CURRENT_DATE' || !dateFilter;
  const dateParam = useCurrentDate ? null : dateFilter;

  try {
    const trailResult = await db.query(
      `SELECT
         we.event_id,
         we.created_at AS webhook_time,
         s.signal_id,
         s.symbol,
         s.direction,
         s.timeframe,
         e.variant,
         gs.net_gex,
         gs.zero_gamma_level,
         mc.current_price AS entry_market_price,
         dr.engine AS rec_engine,
         dr.strike AS rec_strike,
         dr.expiration AS rec_expiration,
         dr.quantity AS rec_quantity,
         dr.rationale->>'confidence' AS rec_confidence,
         o.order_type,
         o.option_symbol,
         t.fill_price,
         t.fill_quantity,
         t.fill_timestamp,
         p.unrealized_pnl,
         p.realized_pnl,
         p.status AS position_status,
         EXTRACT(EPOCH FROM (t.fill_timestamp - we.created_at)) AS webhook_to_fill_seconds
       FROM webhook_events we
       JOIN signals s ON s.signal_id = we.signal_id
       LEFT JOIN experiments e ON e.experiment_id = COALESCE(we.experiment_id, s.experiment_id)
       LEFT JOIN LATERAL (
         SELECT net_gex, zero_gamma_level FROM gex_snapshots gs
         WHERE gs.symbol = s.symbol
           AND gs.created_at BETWEEN s.created_at - INTERVAL '5 minutes' AND s.created_at + INTERVAL '10 minutes'
         ORDER BY gs.created_at DESC LIMIT 1
       ) gs ON true
       LEFT JOIN LATERAL (
         SELECT current_price FROM market_contexts mc
         WHERE mc.signal_id = s.signal_id ORDER BY created_at DESC LIMIT 1
       ) mc ON true
       LEFT JOIN decision_recommendations dr ON dr.signal_id = s.signal_id
       LEFT JOIN orders o ON o.signal_id = s.signal_id
       LEFT JOIN trades t ON t.order_id = o.order_id
       LEFT JOIN LATERAL (
         SELECT rp.unrealized_pnl, rp.realized_pnl, rp.status
         FROM refactored_positions rp
         WHERE rp.option_symbol = o.option_symbol
         ORDER BY rp.entry_timestamp DESC
         LIMIT 1
       ) p ON true
       WHERE we.created_at >= ${useCurrentDate ? 'CURRENT_DATE' : '$1::date'}
         AND COALESCE(we.is_test, false) = false
         AND we.status = 'processed'
       ORDER BY we.created_at`,
      dateParam ? [dateParam] : []
    );
    auditTrail = trailResult.rows as AuditTrailRow[];

    const violationsResult = await db.query(
      `SELECT
         s.signal_id,
         s.symbol,
         s.direction,
         o.option_symbol,
         t.fill_price,
         gs.net_gex,
         gs.zero_gamma_level,
         mc.current_price,
         ARRAY_REMOVE(ARRAY[
           CASE WHEN gs.net_gex IS NULL THEN 'NO_GEX_DATA' END,
           CASE WHEN gs.net_gex < 0 AND dr.rationale->>'sizeMultiplier' IS NULL THEN 'SHORT_GAMMA_NO_SIZE_REDUCTION' END,
           CASE WHEN gs.net_gex < 0 AND (dr.quantity)::int > 1 THEN 'SHORT_GAMMA_OVERSIZED' END,
           CASE WHEN mc.current_price < gs.zero_gamma_level AND s.direction = 'long' THEN 'LONG_BELOW_ZERO_GAMMA' END,
           CASE WHEN mc.current_price > gs.zero_gamma_level AND s.direction = 'short' THEN 'SHORT_ABOVE_ZERO_GAMMA' END,
           CASE WHEN (rs.enriched_data->>'putCallRatio')::float > 1.3 AND s.direction = 'long' THEN 'LONG_AGAINST_BEARISH_FLOW' END,
           CASE WHEN (rs.enriched_data->>'putCallRatio')::float < 0.7 AND s.direction = 'short' THEN 'SHORT_AGAINST_BULLISH_FLOW' END,
           CASE WHEN dr.strike IS NULL THEN 'NO_STRIKE_SELECTED' END,
           CASE WHEN dr.expiration IS NULL THEN 'NO_EXPIRATION_SELECTED' END,
           CASE WHEN t.fill_price IS NULL THEN 'NEVER_FILLED' END
         ], NULL) AS violations
       FROM signals s
       JOIN orders o ON o.signal_id = s.signal_id
       LEFT JOIN trades t ON t.order_id = o.order_id
       LEFT JOIN decision_recommendations dr ON dr.signal_id = s.signal_id
       LEFT JOIN LATERAL (
         SELECT net_gex, zero_gamma_level FROM gex_snapshots gs
         WHERE gs.symbol = s.symbol
           AND gs.created_at BETWEEN s.created_at - INTERVAL '5 minutes' AND s.created_at + INTERVAL '10 minutes'
         ORDER BY gs.created_at DESC LIMIT 1
       ) gs ON true
       LEFT JOIN LATERAL (
         SELECT current_price FROM market_contexts mc
         WHERE mc.signal_id = s.signal_id ORDER BY created_at DESC LIMIT 1
       ) mc ON true
       LEFT JOIN LATERAL (
         SELECT enriched_data FROM refactored_signals rs
         WHERE rs.signal_id = s.signal_id ORDER BY processed_at DESC LIMIT 1
       ) rs ON true
       WHERE s.created_at >= ${useCurrentDate ? 'CURRENT_DATE' : '$1::date'}
         AND COALESCE(s.is_test, false) = false
       ORDER BY s.created_at`,
      dateParam ? [dateParam] : []
    );
    violations = violationsResult.rows as ViolationRow[];

    for (const v of violations) {
      const arr = v.violations || [];
      for (const vtype of arr) {
        if (vtype) violationSummary[vtype] = (violationSummary[vtype] ?? 0) + 1;
      }
    }

    const recommendations = buildRecommendations(auditTrail, violations, violationSummary);

    logger.info('Trade audit completed', {
      trailCount: auditTrail.length,
      violationCount: violations.length,
      dateFilter,
    });

    return {
      auditTrail,
      violations,
      violationSummary,
      recommendations,
      runAt,
      dateFilter,
    };
  } catch (error) {
    logger.error('Trade audit failed', { error, dateFilter });
    throw error;
  }
}
