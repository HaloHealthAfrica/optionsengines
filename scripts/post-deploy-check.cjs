const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  // Recent signals after position cleanup (21:03+ UTC)
  const r1 = await pool.query(`
    SELECT signal_id, symbol, direction, timeframe, status, rejection_reason, processed, created_at
    FROM signals
    WHERE created_at > '2026-02-20T21:02:00Z'
    ORDER BY created_at DESC
    LIMIT 10
  `);
  console.log('=== POST-CLEANUP SIGNALS ===');
  console.table(r1.rows);

  // Check recommendations for post-cleanup signals
  const sids = r1.rows.map(r => r.signal_id);
  if (sids.length > 0) {
    const dr = await pool.query(`
      SELECT recommendation_id, signal_id, engine, symbol, direction, strike, quantity, entry_price, created_at
      FROM decision_recommendations
      WHERE signal_id = ANY($1)
      ORDER BY created_at DESC
    `, [sids]);
    console.log('=== RECOMMENDATIONS FOR POST-CLEANUP SIGNALS ===');
    console.table(dr.rows);

    const exp = await pool.query(`
      SELECT signal_id, variant, split_percentage, policy_version, created_at
      FROM experiments
      WHERE signal_id = ANY($1)
      ORDER BY created_at DESC
    `, [sids]);
    console.log('=== EXPERIMENTS FOR POST-CLEANUP SIGNALS ===');
    console.table(exp.rows);

    // Agent decisions
    const ad = await pool.query(`
      SELECT signal_id, agent_name, decision, reasoning, created_at
      FROM agent_decisions
      WHERE signal_id = ANY($1)
      ORDER BY created_at DESC
    `, [sids]);
    console.log('=== AGENT DECISIONS ===');
    console.table(ad.rows);
  }

  // Check current bias state
  const bias = await pool.query('SELECT * FROM bias_state_current');
  console.log('=== BIAS STATE CURRENT ===');
  if (bias.rows.length === 0) {
    console.log('  (empty - no MTF bias data)');
  } else {
    console.table(bias.rows);
  }

  // Open positions after cleanup
  const pos = await pool.query(`
    SELECT COUNT(*)::int as count FROM refactored_positions
    WHERE status IN ('open', 'closing') AND COALESCE(is_test, false) = false
  `);
  console.log('Open positions now:', pos.rows[0].count);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
