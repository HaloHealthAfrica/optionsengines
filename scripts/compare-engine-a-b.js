#!/usr/bin/env node
/**
 * Phase 3: Engine B vs Engine A comparison script.
 * Compares strike selection, win rate, expectancy from:
 * - decision_recommendations (A vs B strike/expiration)
 * - refactored_positions (Engine A live PnL)
 * - shadow_positions (Engine B shadow PnL)
 *
 * Usage: node scripts/compare-engine-a-b.js [--days N]
 * Default: 30 days
 * Requires: DATABASE_URL
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(__dirname, '..', 'tmp', 'ENGINE_A_BASELINE.json');

const days = parseInt(process.argv.find((a) => a.startsWith('--days='))?.split('=')[1] ?? process.env.PHASE3_DAYS ?? '30', 10);
const interval = `INTERVAL '${days} days'`;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  console.log(`\n=== Engine A vs B Comparison (last ${days} days) ===\n`);

  // 1. Decision recommendations: A vs B counts and strike selection audit
  const recCounts = await pool.query(
    `SELECT engine, is_shadow, COUNT(*)::int AS cnt
     FROM decision_recommendations dr
     JOIN experiments e ON e.experiment_id = dr.experiment_id
     WHERE dr.created_at >= NOW() - ${interval}
     GROUP BY engine, is_shadow
     ORDER BY engine, is_shadow`
  );

  // Signals where BOTH A and B have recommendations (for strike comparison)
  const bothRecs = await pool.query(
    `WITH a_recs AS (
       SELECT signal_id, strike AS strike_a, expiration AS exp_a, quantity AS qty_a, entry_price AS ep_a
       FROM decision_recommendations WHERE engine = 'A' AND is_shadow = false
         AND created_at >= NOW() - ${interval}
     ),
     b_recs AS (
       SELECT signal_id, strike AS strike_b, expiration AS exp_b, quantity AS qty_b, entry_price AS ep_b
       FROM decision_recommendations WHERE engine = 'B' AND is_shadow = true
         AND created_at >= NOW() - ${interval}
     )
     SELECT a.signal_id, a.strike_a, a.exp_a, b.strike_b, b.exp_b,
            a.strike_a = b.strike_b AS strike_match,
            a.exp_a::date = b.exp_b::date AS exp_match
     FROM a_recs a
     JOIN b_recs b ON a.signal_id = b.signal_id`
  );

  // 2. Engine A performance (refactored_positions)
  const engineAPerf = await pool.query(
    `SELECT
       COUNT(*)::int AS closed,
       SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END)::int AS wins,
       SUM(CASE WHEN realized_pnl <= 0 AND realized_pnl IS NOT NULL THEN 1 ELSE 0 END)::int AS losses,
       COALESCE(SUM(realized_pnl), 0)::float AS total_pnl,
       COALESCE(AVG(CASE WHEN realized_pnl > 0 THEN realized_pnl END), 0)::float AS avg_win,
       COALESCE(AVG(CASE WHEN realized_pnl < 0 THEN realized_pnl END), 0)::float AS avg_loss
     FROM refactored_positions
     WHERE status = 'closed'
       AND exit_timestamp >= NOW() - ${interval}
       AND COALESCE(is_test, false) = false`
  );

  // 3. Engine B shadow performance (shadow_positions)
  const engineBPerf = await pool.query(
    `SELECT
       COUNT(*)::int AS closed,
       SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END)::int AS wins,
       SUM(CASE WHEN realized_pnl <= 0 AND realized_pnl IS NOT NULL THEN 1 ELSE 0 END)::int AS losses,
       COALESCE(SUM(realized_pnl), 0)::float AS total_pnl,
       COALESCE(AVG(CASE WHEN realized_pnl > 0 THEN realized_pnl END), 0)::float AS avg_win,
       COALESCE(AVG(CASE WHEN realized_pnl < 0 THEN realized_pnl END), 0)::float AS avg_loss
     FROM shadow_positions sp
     JOIN shadow_trades st ON st.shadow_trade_id = sp.shadow_trade_id
     WHERE sp.status = 'closed'
       AND sp.exit_timestamp >= NOW() - ${interval}`
  );

  const aRow = engineAPerf.rows[0] || {};
  const bRow = engineBPerf.rows[0] || {};
  const aClosed = Number(aRow.closed ?? 0);
  const bClosed = Number(bRow.closed ?? 0);
  const aWins = Number(aRow.wins ?? 0);
  const bWins = Number(bRow.wins ?? 0);
  const aLosses = Number(aRow.losses ?? 0);
  const bLosses = Number(bRow.losses ?? 0);
  const aPnl = Number(aRow.total_pnl ?? 0);
  const bPnl = Number(bRow.total_pnl ?? 0);
  const aAvgWin = Number(aRow.avg_win ?? 0);
  const bAvgWin = Number(bRow.avg_win ?? 0);
  const aAvgLoss = Number(aRow.avg_loss ?? 0);
  const bAvgLoss = Number(bRow.avg_loss ?? 0);

  const winRate = (w, l) => (w + l > 0 ? (w / (w + l)) * 100 : null);
  const expectancy = (w, l, avgW, avgL) => {
    if (w + l === 0) return null;
    const pWin = w / (w + l);
    return pWin * avgW + (1 - pWin) * avgL;
  };

  const aWinRate = winRate(aWins, aLosses);
  const bWinRate = winRate(bWins, bLosses);
  const aExp = expectancy(aWins, aLosses, aAvgWin, aAvgLoss);
  const bExp = expectancy(bWins, bLosses, bAvgWin, bAvgLoss);

  // Output
  console.log('--- Decision Recommendations ---');
  console.table(recCounts.rows.map((r) => ({ engine: r.engine, is_shadow: r.is_shadow, count: r.cnt })));

  if (bothRecs.rows.length > 0) {
    const strikeMatch = bothRecs.rows.filter((r) => r.strike_match).length;
    const expMatch = bothRecs.rows.filter((r) => r.exp_match).length;
    console.log('\n--- Strike Selection Audit (signals with both A and B) ---');
    console.log(`Signals with both engines: ${bothRecs.rows.length}`);
    console.log(`Strike match: ${strikeMatch}/${bothRecs.rows.length} (${((strikeMatch / bothRecs.rows.length) * 100).toFixed(1)}%)`);
    console.log(`Expiration match: ${expMatch}/${bothRecs.rows.length} (${((expMatch / bothRecs.rows.length) * 100).toFixed(1)}%)`);
  } else {
    console.log('\n--- Strike Selection Audit ---');
    console.log('No signals with both Engine A and B recommendations. Enable Engine B (AB_SPLIT_PERCENTAGE > 0) and ENABLE_SHADOW_EXECUTION to collect data.');
  }

  console.log('\n--- Engine A (Live) ---');
  console.log(`Closed: ${aClosed} | Wins: ${aWins} | Losses: ${aLosses}`);
  console.log(`Win rate: ${aWinRate != null ? aWinRate.toFixed(1) : 'n/a'}%`);
  console.log(`Total PnL: $${aPnl.toFixed(2)} | Avg win: $${aAvgWin.toFixed(2)} | Avg loss: $${aAvgLoss.toFixed(2)}`);
  console.log(`Expectancy: ${aExp != null ? '$' + aExp.toFixed(2) : 'n/a'}`);

  console.log('\n--- Engine B (Shadow) ---');
  if (bClosed > 0) {
    console.log(`Closed: ${bClosed} | Wins: ${bWins} | Losses: ${bLosses}`);
    console.log(`Win rate: ${bWinRate != null ? bWinRate.toFixed(1) : 'n/a'}%`);
    console.log(`Total PnL: $${bPnl.toFixed(2)} | Avg win: $${bAvgWin.toFixed(2)} | Avg loss: $${bAvgLoss.toFixed(2)}`);
    console.log(`Expectancy: ${bExp != null ? '$' + bExp.toFixed(2) : 'n/a'}`);

    if (aClosed > 0 && bClosed > 0) {
      console.log('\n--- B vs A Summary ---');
      const winRateDiff = bWinRate != null && aWinRate != null ? bWinRate - aWinRate : null;
      const expDiff = bExp != null && aExp != null ? bExp - aExp : null;
      console.log(`Win rate diff (B - A): ${winRateDiff != null ? winRateDiff.toFixed(1) + '%' : 'n/a'}`);
      console.log(`Expectancy diff (B - A): ${expDiff != null ? '$' + expDiff.toFixed(2) : 'n/a'}`);
    }
  } else {
    console.log('No closed shadow positions. Enable Engine B + ENABLE_SHADOW_EXECUTION and run shadow exit monitor to collect data.');
  }

  // Compare to baseline if exists
  if (existsSync(BASELINE_PATH)) {
    try {
      const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
      console.log('\n--- vs Recorded Baseline (tmp/ENGINE_A_BASELINE.json) ---');
      console.log(`Baseline win rate: ${baseline.performance?.win_rate_pct ?? 'n/a'}%`);
      console.log(`Baseline total PnL: $${baseline.performance?.total_pnl ?? 0}`);
    } catch (_) {}
  }

  console.log('');
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
