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
    const t0 = Date.now();
    await pool.query('SELECT 1');
    console.log(`DB connected in ${Date.now() - t0}ms\n`);

    // 1. Signal status breakdown (7 days)
    const signals = await pool.query(`
      SELECT status, rejection_reason, COUNT(*)::int as cnt
      FROM signals
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY status, rejection_reason
      ORDER BY cnt DESC
    `);
    console.log('=== SIGNAL STATUS (7 days) ===');
    console.table(signals.rows);

    // 2. Last 10 signals
    const recent = await pool.query(`
      SELECT signal_id, symbol, direction, timeframe, status, rejection_reason,
             processed, processing_lock, created_at
      FROM signals
      ORDER BY created_at DESC LIMIT 10
    `);
    console.log('=== LAST 10 SIGNALS ===');
    console.table(recent.rows);

    // 3. Locked signals
    const locked = await pool.query(`
      SELECT COUNT(*)::int as locked_count
      FROM signals WHERE processing_lock = TRUE
    `);
    console.log('Locked signals:', locked.rows[0].locked_count);

    // 4. Pending unprocessed signals
    const pending = await pool.query(`
      SELECT COUNT(*)::int as cnt
      FROM signals
      WHERE processed = FALSE
        AND processing_lock = FALSE
        AND (status IS NULL OR status = 'pending')
    `);
    console.log('Pending unprocessed signals:', pending.rows[0].cnt);

    // 5. Webhook events (7 days)
    const events = await pool.query(`
      SELECT status, COUNT(*)::int as cnt
      FROM webhook_events
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY status ORDER BY cnt DESC
    `);
    console.log('\n=== WEBHOOK EVENTS (7 days) ===');
    console.table(events.rows);

    // 6. Last 5 webhook events
    const lastEvents = await pool.query(`
      SELECT event_id, status, symbol, direction, error_message, is_test, created_at
      FROM webhook_events
      ORDER BY created_at DESC LIMIT 5
    `);
    console.log('=== LAST 5 WEBHOOK EVENTS ===');
    console.table(lastEvents.rows);

    // 7. Orders (7 days)
    const orders = await pool.query(`
      SELECT status, COUNT(*)::int as cnt
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY status
    `);
    console.log('\n=== ORDERS (7 days) ===');
    if (orders.rows.length === 0) console.log('(none)');
    else console.table(orders.rows);

    // 8. Recommendations (7 days)
    const recs = await pool.query(`
      SELECT COUNT(*)::int as cnt
      FROM decision_recommendations
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `);
    console.log('Recommendations (7 days):', recs.rows[0].cnt);

    // 9. Experiments (7 days)
    const exps = await pool.query(`
      SELECT variant, COUNT(*)::int as cnt
      FROM experiments
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY variant
    `);
    console.log('\n=== EXPERIMENTS (7 days) ===');
    if (exps.rows.length === 0) console.log('(none)');
    else console.table(exps.rows);

    // 10. Refactored signals enrichment (recent)
    const enriched = await pool.query(`
      SELECT signal_id, rejection_reason, processed_at
      FROM refactored_signals
      ORDER BY processed_at DESC NULLS LAST LIMIT 5
    `);
    console.log('\n=== LAST 5 ENRICHED SIGNALS ===');
    if (enriched.rows.length === 0) console.log('(none)');
    else console.table(enriched.rows);

  } catch (e) {
    console.error('ERROR:', e.message);
  }
  await pool.end();
}

run();
