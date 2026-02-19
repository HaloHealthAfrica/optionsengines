#!/usr/bin/env node
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const q = `
  SELECT 
    COUNT(*) AS closed_positions,
    SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END) AS wins,
    SUM(CASE WHEN realized_pnl <= 0 AND realized_pnl IS NOT NULL THEN 1 ELSE 0 END) AS losses,
    SUM(CASE WHEN realized_pnl IS NULL THEN 1 ELSE 0 END) AS null_pnl,
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
    COUNT(*) AS cnt
  FROM refactored_positions
  WHERE status = 'closed'
    AND exit_timestamp >= NOW() - INTERVAL '30 days'
    AND COALESCE(is_test, false) = false
  GROUP BY 1
  ORDER BY 1
`;

(async () => {
  const r = await pool.query(q);
  console.log('Engine A Performance (last 30 days, non-test closed positions)\n');
  console.log(JSON.stringify(r.rows[0], null, 2));

  const dte = await pool.query(qDte);
  console.log('\n\nDTE at Entry Distribution (closed positions, last 30d)\n');
  console.table(dte.rows);

  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
