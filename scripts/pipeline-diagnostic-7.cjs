const pg = require('pg');
const { config } = require('../dist/config/index.js');
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });

async function run() {
  // 1. Current pending signals (should be small now)
  const pending = await pool.query(
    `SELECT COUNT(*)::int as total,
            SUM(CASE WHEN timestamp >= NOW() - INTERVAL '30 minutes' THEN 1 ELSE 0 END)::int as fresh
     FROM signals
     WHERE (status = 'pending' OR status IS NULL) AND processed = FALSE AND processing_lock = FALSE`
  );
  console.log('=== PENDING SIGNALS ===');
  console.log('Total pending:', pending.rows[0].total);
  console.log('Fresh (< 30 min):', pending.rows[0].fresh);

  // 2. Signals processed in the last 15 minutes
  const recent = await pool.query(
    `SELECT signal_id, symbol, status, rejection_reason, processing_attempts, timestamp, locked_at
     FROM signals
     WHERE locked_at >= NOW() - INTERVAL '15 minutes'
     ORDER BY locked_at DESC
     LIMIT 10`
  );
  console.log('\n=== PROCESSED IN LAST 15 MIN ===');
  console.table(recent.rows);

  // 3. Currently locked
  const locked = await pool.query(
    `SELECT COUNT(*)::int as cnt FROM signals WHERE processing_lock = TRUE`
  );
  console.log('Currently locked:', locked.rows[0].cnt);

  // 4. Decision recommendations (all time)
  const decisions = await pool.query(
    `SELECT COUNT(*)::int as total, MAX(created_at) as latest FROM decision_recommendations`
  );
  console.log('\n=== DECISION RECOMMENDATIONS ===');
  console.log('Total:', decisions.rows[0].total, '| Latest:', decisions.rows[0].latest);

  // 5. Experiments created recently
  const experiments = await pool.query(
    `SELECT experiment_id, variant, created_at
     FROM experiments
     ORDER BY created_at DESC
     LIMIT 5`
  );
  console.log('\n=== RECENT EXPERIMENTS ===');
  console.table(experiments.rows);

  // 6. Signals that were approved but check if they have experiment_ids
  const approved = await pool.query(
    `SELECT signal_id, symbol, status, experiment_id, timestamp
     FROM signals
     WHERE status = 'approved'
     ORDER BY timestamp DESC
     LIMIT 5`
  );
  console.log('\n=== RECENT APPROVED SIGNALS ===');
  console.table(approved.rows);

  // 7. Rejection reasons in the last 30 minutes
  const recentRej = await pool.query(
    `SELECT rejection_reason, COUNT(*)::int as cnt
     FROM signals
     WHERE status = 'rejected' AND locked_at >= NOW() - INTERVAL '30 minutes'
     GROUP BY rejection_reason ORDER BY cnt DESC`
  );
  console.log('\n=== REJECTIONS LAST 30 MIN ===');
  console.table(recentRej.rows);

  // 8. New signals arriving (created in last 10 min)
  const incoming = await pool.query(
    `SELECT COUNT(*)::int as cnt, MAX(created_at) as latest
     FROM signals
     WHERE created_at >= NOW() - INTERVAL '10 minutes'`
  );
  console.log('\n=== SIGNALS CREATED LAST 10 MIN ===');
  console.log('Count:', incoming.rows[0].cnt, '| Latest:', incoming.rows[0].latest);

  // 9. Check what the enrichment_data looks like for approved signals
  const enrichData = await pool.query(
    `SELECT signal_id, symbol, enrichment_data IS NOT NULL as has_enrichment,
            enrichment_data->>'rejectionReason' as enrich_rejection
     FROM signals
     WHERE status = 'approved'
     ORDER BY timestamp DESC
     LIMIT 3`
  );
  console.log('\n=== APPROVED SIGNAL ENRICHMENT ===');
  console.table(enrichData.rows);

  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
