#!/usr/bin/env node
/**
 * Phase 2.2: Simulate DTE 7 and 14 buckets.
 * Shows how many trades would have been excluded if minDteEntry were 7 or 14.
 * Run: node scripts/simulate-dte-buckets.js
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const q = `
  SELECT 
    EXTRACT(DAY FROM (expiration::timestamp - entry_timestamp))::int AS dte_at_entry,
    COUNT(*)::int AS cnt,
    SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END)::int AS wins,
    SUM(CASE WHEN realized_pnl <= 0 AND realized_pnl IS NOT NULL THEN 1 ELSE 0 END)::int AS losses,
    COALESCE(SUM(realized_pnl), 0)::float AS total_pnl
  FROM refactored_positions
  WHERE status = 'closed'
    AND exit_timestamp >= NOW() - INTERVAL '30 days'
    AND COALESCE(is_test, false) = false
  GROUP BY 1
  ORDER BY 1
`;

(async () => {
  const { rows } = await pool.query(q);
  const total = rows.reduce((s, r) => s + Number(r.cnt ?? 0), 0);
  const below7 = rows.filter((r) => Number(r.dte_at_entry ?? 0) < 7).reduce((s, r) => s + Number(r.cnt ?? 0), 0);
  const below14 = rows.filter((r) => Number(r.dte_at_entry ?? 0) < 14).reduce((s, r) => s + Number(r.cnt ?? 0), 0);
  const pnlBelow7 = rows
    .filter((r) => Number(r.dte_at_entry ?? 0) < 7)
    .reduce((s, r) => s + Number(r.total_pnl ?? 0), 0);
  const pnlBelow14 = rows
    .filter((r) => Number(r.dte_at_entry ?? 0) < 14)
    .reduce((s, r) => s + Number(r.total_pnl ?? 0), 0);
  const pnlTotal = rows.reduce((s, r) => s + Number(r.total_pnl ?? 0), 0);

  console.log('\n=== DTE Bucket Simulation (last 30d) ===\n');
  console.table(rows);
  console.log(`Total closed: ${total}`);
  const pct7 = total > 0 ? ((below7 / total) * 100).toFixed(1) : '0';
  const pct14 = total > 0 ? ((below14 / total) * 100).toFixed(1) : '0';
  console.log(`If MIN_DTE_ENTRY=7: would exclude ${below7} trades (${pct7}%), PnL excluded: $${pnlBelow7.toFixed(2)}`);
  console.log(`If MIN_DTE_ENTRY=14: would exclude ${below14} trades (${pct14}%), PnL excluded: $${pnlBelow14.toFixed(2)}`);
  console.log(`Remaining PnL (min 7): $${(pnlTotal - pnlBelow7).toFixed(2)}`);
  console.log(`Remaining PnL (min 14): $${(pnlTotal - pnlBelow14).toFixed(2)}`);
  console.log('');
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});