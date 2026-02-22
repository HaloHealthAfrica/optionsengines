const pg = require('pg');
require('dotenv').config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  max: 2,
});

async function run() {
  try {
    await pool.query('SELECT 1');

    // 1. Flow config table
    const flowConfig = await pool.query(`SELECT key, value_text, value_number, value_bool FROM flow_config`);
    console.log('=== FLOW_CONFIG TABLE ===');
    if (flowConfig.rows.length === 0) console.log('(empty - using env/defaults)');
    else console.table(flowConfig.rows);

    // 2. Check the most recent enriched signals for rejection details
    const enriched = await pool.query(`
      SELECT signal_id, rejection_reason, 
             enriched_data::text as enriched_preview,
             risk_check_result::text as risk_preview,
             processed_at
      FROM refactored_signals
      ORDER BY processed_at DESC NULLS LAST LIMIT 3
    `);
    console.log('\n=== LAST 3 ENRICHED SIGNALS (details) ===');
    for (const row of enriched.rows) {
      console.log('---');
      console.log('Signal:', row.signal_id);
      console.log('Rejection:', row.rejection_reason);
      console.log('Processed:', row.processed_at);
      try {
        const risk = JSON.parse(row.risk_preview || '{}');
        console.log('Market open:', risk.marketOpen);
        console.log('Market clock:', risk.marketClock);
        console.log('Confluence rejection:', risk.confluenceRejection);
        console.log('Test bypass:', risk.testBypass);
        console.log('Decision only:', risk.decisionOnly);
      } catch {}
      try {
        const enriched = JSON.parse(row.enriched_preview || '{}');
        console.log('Current price:', enriched.currentPrice);
        console.log('Confluence:', enriched.confluence ? JSON.stringify(enriched.confluence).slice(0, 200) : null);
      } catch {}
    }

    // 3. Check Fly secrets by looking at what the app is using
    const lastSignal = await pool.query(`
      SELECT signal_id, symbol, status, rejection_reason, created_at
      FROM signals 
      WHERE created_at >= NOW() - INTERVAL '5 minutes'
      ORDER BY created_at DESC LIMIT 5
    `);
    console.log('\n=== SIGNALS IN LAST 5 MINUTES ===');
    if (lastSignal.rows.length === 0) console.log('(none)');
    else console.table(lastSignal.rows);

  } catch (e) {
    console.error('ERROR:', e.message);
  }
  await pool.end();
}

run();
