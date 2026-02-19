#!/usr/bin/env node
/**
 * Phase 1.4: GEX health check — alert if non_zero_gex_ratio < threshold for 24h.
 * Run daily (cron) or on-demand.
 *
 * Usage: node scripts/run-gex-health-check.js [--threshold-pct=5] [--hours=24]
 * Exit 1 if below threshold (for alerting).
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const args = process.argv.slice(2);
const thresholdPct = parseFloat(args.find((a) => a.startsWith('--threshold-pct='))?.split('=')[1] || '5');
const hours = parseInt(args.find((a) => a.startsWith('--hours='))?.split('=')[1] || '24', 10);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const q = `
  SELECT 
    COUNT(*)::bigint AS snapshots,
    COALESCE(SUM(CASE WHEN net_gex != 0 THEN 1 ELSE 0 END), 0)::bigint AS nonzero,
    ROUND(100.0 * COALESCE(SUM(CASE WHEN net_gex != 0 THEN 1 ELSE 0 END), 0) / NULLIF(COUNT(*), 0), 2)::float AS nonzero_pct
  FROM gex_snapshots
  WHERE created_at >= NOW() - ($1::int || ' hours')::interval
`;

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  const { rows } = await pool.query(q, [hours]);
  const r = rows[0] || {};
  const snapshots = Number(r.snapshots ?? 0);
  const nonzero = Number(r.nonzero ?? 0);
  const pct = Number(r.nonzero_pct ?? 0);

  console.log(`GEX health (last ${hours}h): ${snapshots} snapshots, ${nonzero} non-zero (${pct.toFixed(2)}%)`);
  console.log(`Threshold: ${thresholdPct}%`);

  const pass = snapshots === 0 || pct >= thresholdPct;
  if (!pass) {
    console.error(`ALERT: GEX non-zero rate ${pct.toFixed(2)}% < ${thresholdPct}% — run diagnose-gex-provider.ts`);
  }

  await pool.end();
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
