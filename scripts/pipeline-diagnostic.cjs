const pg = require('pg');
const { config } = require('../dist/config/index.js');
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });

async function run() {
  // 1. Recent webhook events
  const webhooks = await pool.query(
    `SELECT status, COUNT(*)::int as cnt, MAX(created_at) as latest
     FROM webhook_events 
     WHERE created_at >= NOW() - INTERVAL '7 days'
     GROUP BY status ORDER BY cnt DESC`
  );
  console.log('=== WEBHOOK EVENTS (last 7d) ===');
  console.table(webhooks.rows);

  // 2. Recent signals and their status
  const signals = await pool.query(
    `SELECT status, processed, processing_lock, COUNT(*)::int as cnt,
            MAX(created_at) as latest
     FROM signals 
     WHERE created_at >= NOW() - INTERVAL '7 days'
     GROUP BY status, processed, processing_lock ORDER BY cnt DESC`
  );
  console.log('=== SIGNALS (last 7d) ===');
  console.table(signals.rows);

  // 3. Stuck signals (pending but not picked up)
  const stuck = await pool.query(
    `SELECT signal_id, symbol, direction, status, processed, processing_lock,
            rejection_reason, created_at, queued_until, next_retry_at,
            processing_attempts
     FROM signals 
     WHERE processed = false AND created_at >= NOW() - INTERVAL '7 days'
     ORDER BY created_at DESC LIMIT 10`
  );
  console.log('=== UNPROCESSED SIGNALS (last 7d, limit 10) ===');
  for (const row of stuck.rows) {
    console.log({
      signal_id: row.signal_id,
      symbol: row.symbol,
      direction: row.direction,
      status: row.status,
      processed: row.processed,
      lock: row.processing_lock,
      rejection: row.rejection_reason,
      created: row.created_at,
      queued_until: row.queued_until,
      next_retry: row.next_retry_at,
      attempts: row.processing_attempts,
    });
  }

  // 4. Recent experiments
  const experiments = await pool.query(
    `SELECT variant, COUNT(*)::int as cnt, MAX(created_at) as latest
     FROM experiments 
     WHERE created_at >= NOW() - INTERVAL '7 days'
     GROUP BY variant`
  );
  console.log('\n=== EXPERIMENTS (last 7d) ===');
  console.table(experiments.rows);

  // 5. Recent decision_recommendations
  const decisions = await pool.query(
    `SELECT engine, COUNT(*)::int as cnt, MAX(created_at) as latest
     FROM decision_recommendations 
     WHERE created_at >= NOW() - INTERVAL '7 days'
     GROUP BY engine`
  );
  console.log('=== DECISION RECOMMENDATIONS (last 7d) ===');
  console.table(decisions.rows);

  // 6. Recent refactored_signals (enrichment)
  const enriched = await pool.query(
    `SELECT COUNT(*)::int as cnt, 
            SUM(CASE WHEN rejection_reason IS NOT NULL THEN 1 ELSE 0 END)::int as rejected,
            MAX(processed_at) as latest
     FROM refactored_signals 
     WHERE processed_at >= NOW() - INTERVAL '7 days'`
  );
  console.log('=== REFACTORED SIGNALS / ENRICHMENT (last 7d) ===');
  console.table(enriched.rows);

  // 7. Signals with rejection reasons
  const rejections = await pool.query(
    `SELECT rejection_reason, COUNT(*)::int as cnt
     FROM signals 
     WHERE created_at >= NOW() - INTERVAL '7 days'
       AND rejection_reason IS NOT NULL
     GROUP BY rejection_reason ORDER BY cnt DESC LIMIT 10`
  );
  console.log('=== SIGNAL REJECTION REASONS (last 7d) ===');
  console.table(rejections.rows);

  // 8. Orders created
  const orders = await pool.query(
    `SELECT status, engine, COUNT(*)::int as cnt, MAX(created_at) as latest
     FROM orders 
     WHERE created_at >= NOW() - INTERVAL '7 days'
     GROUP BY status, engine ORDER BY cnt DESC`
  );
  console.log('=== ORDERS (last 7d) ===');
  console.table(orders.rows);

  await pool.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
