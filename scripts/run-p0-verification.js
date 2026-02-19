#!/usr/bin/env node
/**
 * P0 Safety Gate Verification
 * Run before enabling Engine B (Phase 4).
 * Pass criteria: 0 duplicate orders, 0 duplicate trades.
 *
 * Usage: node scripts/run-p0-verification.js
 * Requires: DATABASE_URL
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

const QUERIES = [
  {
    name: 'P0.3 Duplicate orders per signal (last 30 days)',
    sql: `SELECT signal_id, COUNT(*) AS order_count
FROM orders
WHERE created_at >= NOW() - INTERVAL '30 days'
  AND signal_id IS NOT NULL
GROUP BY signal_id
HAVING COUNT(*) > 1`,
    pass: (rows) => rows.length === 0,
    failMsg: 'Found duplicate orders — fix before Phase 4',
  },
  {
    name: 'GEX health (last 7 days)',
    sql: `SELECT 
  COUNT(*)::bigint AS snapshots,
  COALESCE(SUM(CASE WHEN net_gex != 0 THEN 1 ELSE 0 END), 0)::bigint AS nonzero,
  ROUND(100.0 * COALESCE(SUM(CASE WHEN net_gex != 0 THEN 1 ELSE 0 END), 0) / NULLIF(COUNT(*), 0), 2)::float AS nonzero_pct
FROM gex_snapshots
WHERE created_at >= NOW() - INTERVAL '7 days'`,
    pass: (rows) => {
      const r = rows[0];
      if (!r) return true;
      const snapshots = Number(r.snapshots ?? 0);
      const nonzero = Number(r.nonzero ?? 0);
      return snapshots === 0 || nonzero > 0;
    },
    failMsg: 'GEX all zeros — Phase 1 not complete',
  },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let allPass = true;

  try {
    console.log('\n=== P0 Safety Gate Verification ===\n');

    for (const q of QUERIES) {
      const { rows } = await pool.query(q.sql);
      const passed = q.pass(rows);

      console.log(`${q.name}`);
      if (rows.length > 0 && rows[0].constructor?.name === 'Object') {
        console.log(rows.length === 1 ? JSON.stringify(rows[0], null, 2) : `(${rows.length} rows)`);
      }
      console.log(passed ? '✅ PASS' : `❌ FAIL: ${q.failMsg}`);
      console.log('');

      if (!passed) allPass = false;
    }

    console.log('---');
    console.log('Also run: npm run audit:pnl');
    console.log('Pass criteria: 0 duplicate trade groups.');
    console.log('');
    console.log(allPass ? '✅ P0 gate PASSED' : '❌ P0 gate FAILED — do not enable Engine B');
    console.log('');

    if (!allPass) process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
