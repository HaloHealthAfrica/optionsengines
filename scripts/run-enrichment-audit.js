#!/usr/bin/env node
/**
 * Phase 5: Enrichment coverage audit.
 * Lists accepted webhooks with no matching refactored_signals.
 * Alert if missing > threshold (default 1% of accepted).
 *
 * Usage: node scripts/run-enrichment-audit.js [--hours=24] [--threshold-pct=1]
 * Requires: DATABASE_URL
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const args = process.argv.slice(2);
const hours = parseInt(args.find((a) => a.startsWith('--hours='))?.split('=')[1] || '24', 10);
const thresholdPct = parseFloat(args.find((a) => a.startsWith('--threshold-pct='))?.split('=')[1] || '1');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const q = `
  SELECT 
    COUNT(*)::int AS signals_with_webhook,
    COUNT(r.refactored_signal_id)::int AS enriched,
    COUNT(*)::int - COUNT(r.refactored_signal_id)::int AS missing
  FROM webhook_events we
  JOIN signals s ON we.signal_id = s.signal_id
  LEFT JOIN refactored_signals r ON s.signal_id = r.signal_id
  WHERE we.created_at >= NOW() - ($1::int || ' hours')::interval
    AND we.status = 'accepted'
    AND COALESCE(we.is_test, false) = false
    AND we.signal_id IS NOT NULL
`;

const qMissing = `
  SELECT we.event_id, we.request_id, we.signal_id, we.symbol, we.direction, we.timeframe, we.created_at
  FROM webhook_events we
  JOIN signals s ON we.signal_id = s.signal_id
  LEFT JOIN refactored_signals r ON s.signal_id = r.signal_id
  WHERE we.created_at >= NOW() - ($1::int || ' hours')::interval
    AND we.status = 'accepted'
    AND COALESCE(we.is_test, false) = false
    AND we.signal_id IS NOT NULL
    AND r.refactored_signal_id IS NULL
  ORDER BY we.created_at DESC
  LIMIT 50
`;

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  const [summary, missing] = await Promise.all([
    pool.query(q, [hours]),
    pool.query(qMissing, [hours]),
  ]);

  const r = summary.rows[0] || {};
  const total = Number(r.signals_with_webhook ?? 0);
  const enriched = Number(r.enriched ?? 0);
  const missingCount = Number(r.missing ?? 0);
  const missingPct = total > 0 ? (missingCount / total) * 100 : 0;

  console.log(`\n=== Enrichment Coverage (last ${hours}h) ===\n`);
  console.log(`Accepted webhooks with signal: ${total}`);
  console.log(`Enriched:         ${enriched}`);
  console.log(`Missing:          ${missingCount} (${missingPct.toFixed(2)}%)`);
  console.log(`Target:           missing < ${thresholdPct}%\n`);

  const pass = missingPct < thresholdPct;
  console.log(pass ? '✅ PASS' : `❌ FAIL: missing ${missingPct.toFixed(2)}% exceeds threshold ${thresholdPct}%`);

  if (missing.rows.length > 0) {
    console.log('\nSample missing (use trace-webhooks.ts for details):');
    console.table(missing.rows.slice(0, 10));
  }

  await pool.end();
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
