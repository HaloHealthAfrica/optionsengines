#!/usr/bin/env node
/**
 * Phase 2.1: Record Engine A baseline metrics.
 * Writes tmp/ENGINE_A_BASELINE.json for comparison during Phase 2 hardening.
 *
 * Usage: node scripts/record-engine-a-baseline.js
 * Requires: DATABASE_URL
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(__dirname, '..', 'tmp', 'ENGINE_A_BASELINE.json');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const qPerf = `
  SELECT 
    COUNT(*)::int AS closed_positions,
    SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END)::int AS wins,
    SUM(CASE WHEN realized_pnl <= 0 AND realized_pnl IS NOT NULL THEN 1 ELSE 0 END)::int AS losses,
    COALESCE(SUM(realized_pnl), 0)::float AS total_pnl,
    COALESCE(AVG(CASE WHEN realized_pnl > 0 THEN realized_pnl END), 0)::float AS avg_win,
    COALESCE(AVG(CASE WHEN realized_pnl < 0 THEN realized_pnl END), 0)::float AS avg_loss
  FROM refactored_positions
  WHERE status = 'closed'
    AND exit_timestamp >= NOW() - INTERVAL '30 days'
    AND COALESCE(is_test, false) = false
`;

const qDte = `
  SELECT 
    EXTRACT(DAY FROM (expiration::timestamp - entry_timestamp))::int AS dte_at_entry,
    COUNT(*)::int AS cnt
  FROM refactored_positions
  WHERE status = 'closed'
    AND exit_timestamp >= NOW() - INTERVAL '30 days'
    AND COALESCE(is_test, false) = false
  GROUP BY 1
  ORDER BY 1
`;

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  const [perf, dte] = await Promise.all([
    pool.query(qPerf),
    pool.query(qDte),
  ]);

  const row = perf.rows[0] || {};
  const closed = Number(row.closed_positions ?? 0);
  const wins = Number(row.wins ?? 0);
  const winRate = closed > 0 ? (wins / closed) * 100 : 0;

  const baseline = {
    recorded_at: new Date().toISOString(),
    window_days: 30,
    performance: {
      closed_positions: closed,
      wins,
      losses: Number(row.losses ?? 0),
      win_rate_pct: Math.round(winRate * 100) / 100,
      total_pnl: Number(row.total_pnl ?? 0),
      avg_win: Number(row.avg_win ?? 0),
      avg_loss: Number(row.avg_loss ?? 0),
    },
    dte_distribution: dte.rows.map((r) => ({
      dte_at_entry: Number(r.dte_at_entry ?? 0),
      cnt: Number(r.cnt ?? 0),
    })),
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(baseline, null, 2));

  console.log('Engine A baseline recorded to', OUTPUT);
  console.log(JSON.stringify(baseline, null, 2));

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
