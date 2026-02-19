#!/usr/bin/env node
/**
 * Run Copilot verification SQLs for E2E diagnostics.
 * Usage: node scripts/run-verification-sqls.js (requires DATABASE_URL)
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const QUERIES = [
  {
    name: '1️⃣ Experiment Split',
    sql: `SELECT variant, COUNT(*) 
FROM experiments 
WHERE created_at >= NOW() - INTERVAL '30 days' 
GROUP BY variant`,
    note: 'If B = 0 → routing failure confirmed.',
  },
  {
    name: '2️⃣ Orders by Engine',
    sql: `SELECT engine, COUNT(*) 
FROM orders 
WHERE created_at >= NOW() - INTERVAL '30 days' 
GROUP BY engine`,
    note: 'Proves whether Engine B is ever placing trades.',
  },
  {
    name: '3️⃣ Refactored Signals Missing',
    sql: `SELECT s.signal_id, s.created_at, r.refactored_signal_id 
FROM signals s 
LEFT JOIN refactored_signals r 
ON s.signal_id = r.signal_id 
WHERE s.created_at >= NOW() - INTERVAL '24 hours'
ORDER BY s.created_at DESC`,
    note: 'If NULLs in refactored_signal_id → enrichment silently failing.',
  },
  {
    name: '4️⃣ GEX Non-Zero Check',
    sql: `SELECT COUNT(*) AS snapshots,
       SUM(CASE WHEN (gex->>'net_gex')::numeric != 0 THEN 1 ELSE 0 END) AS non_zero
FROM gex_snapshots
WHERE created_at >= NOW()-INTERVAL '30 days'`,
    note: 'If non_zero ≈ 0 → gamma is decorative.',
  },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    for (const q of QUERIES) {
      console.log('\n' + '='.repeat(60));
      console.log(q.name);
      console.log('='.repeat(60));
      console.log('SQL:', q.sql.replace(/\s+/g, ' ').trim());
      console.log('Note:', q.note);
      console.log('-'.repeat(60));
      try {
        const { rows } = await pool.query(q.sql);
        if (rows.length === 0) {
          console.log('(no rows)');
        } else {
          console.table(rows);
        }
      } catch (err) {
        console.error('ERROR:', err.message);
        if (q.name.includes('GEX') && err.message.includes('gex')) {
          console.log('Trying alternative: gex_snapshots may use net_gex column directly...');
          try {
            const alt = `SELECT COUNT(*) AS snapshots,
       SUM(CASE WHEN net_gex != 0 THEN 1 ELSE 0 END) AS non_zero
FROM gex_snapshots
WHERE created_at >= NOW()-INTERVAL '30 days'`;
            const { rows } = await pool.query(alt);
            console.table(rows);
          } catch (e2) {
            console.error('Alt query failed:', e2.message);
          }
        }
      }
    }
    console.log('\n' + '='.repeat(60) + '\n');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
