/**
 * Phase 5: Enrichment coverage audit service.
 * Used by cron route and npm run audit:enrichment.
 */
import { db } from './database.service.js';

export interface EnrichmentAuditResult {
  pass: boolean;
  total: number;
  enriched: number;
  missing: number;
  missingPct: number;
  thresholdPct: number;
  hours: number;
  sampleMissing: Array<{ event_id: string; signal_id: string; symbol: string; created_at: string }>;
}

export async function runEnrichmentAudit(
  hours = 24,
  thresholdPct = 1
): Promise<EnrichmentAuditResult> {
  const summary = await db.query(
    `SELECT 
      COUNT(*)::int AS signals_with_webhook,
      COUNT(r.refactored_signal_id)::int AS enriched,
      COUNT(*)::int - COUNT(r.refactored_signal_id)::int AS missing
    FROM webhook_events we
    JOIN signals s ON we.signal_id = s.signal_id
    LEFT JOIN refactored_signals r ON s.signal_id = r.signal_id
    WHERE we.created_at >= NOW() - ($1::int || ' hours')::interval
      AND we.status = 'accepted'
      AND COALESCE(we.is_test, false) = false
      AND we.signal_id IS NOT NULL`,
    [hours]
  );

  const missing = await db.query(
    `SELECT we.event_id, we.signal_id, we.symbol, we.created_at
     FROM webhook_events we
     JOIN signals s ON we.signal_id = s.signal_id
     LEFT JOIN refactored_signals r ON s.signal_id = r.signal_id
     WHERE we.created_at >= NOW() - ($1::int || ' hours')::interval
       AND we.status = 'accepted'
       AND COALESCE(we.is_test, false) = false
       AND we.signal_id IS NOT NULL
       AND r.refactored_signal_id IS NULL
     ORDER BY we.created_at DESC
     LIMIT 10`,
    [hours]
  );

  const r = summary.rows[0] || {};
  const total = Number(r.signals_with_webhook ?? 0);
  const enriched = Number(r.enriched ?? 0);
  const missingCount = Number(r.missing ?? 0);
  const missingPct = total > 0 ? (missingCount / total) * 100 : 0;
  const pass = missingPct < thresholdPct;

  return {
    pass,
    total,
    enriched,
    missing: missingCount,
    missingPct,
    thresholdPct,
    hours,
    sampleMissing: missing.rows.map((row) => ({
      event_id: row.event_id,
      signal_id: row.signal_id,
      symbol: row.symbol,
      created_at: String(row.created_at ?? ''),
    })),
  };
}
