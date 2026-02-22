const pg = require('pg');
const { config } = require('../dist/config/index.js');
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });
(async () => {
  // 1. Pending signals detail - why aren't they being picked up?
  const pending = await pool.query(
    `SELECT signal_id, symbol, status, processing_lock, processing_attempts,
            next_retry_at, queued_until, timestamp,
            timestamp >= NOW() - INTERVAL '${config.signalMaxAgeMinutes} minutes' as within_max_age
     FROM signals
     WHERE (status = 'pending' OR status IS NULL) AND processed = FALSE
     ORDER BY timestamp DESC
     LIMIT 10`
  );
  console.log('=== PENDING SIGNALS DETAIL ===');
  console.table(pending.rows);

  // 2. Most recently updated signals (by any status change)
  const recentAny = await pool.query(
    `SELECT signal_id, symbol, status, rejection_reason, processing_attempts, timestamp,
            next_retry_at
     FROM signals
     ORDER BY GREATEST(COALESCE(locked_at, '1970-01-01'), COALESCE(next_retry_at, '1970-01-01'), timestamp) DESC
     LIMIT 10`
  );
  console.log('=== MOST RECENT SIGNAL ACTIVITY ===');
  console.table(recentAny.rows);

  // 3. Signals with rejection_reason set but status still pending (retry scheduled)
  const retrying = await pool.query(
    `SELECT signal_id, symbol, rejection_reason, processing_attempts, next_retry_at, timestamp
     FROM signals
     WHERE status = 'pending' AND rejection_reason IS NOT NULL
     ORDER BY next_retry_at DESC NULLS LAST
     LIMIT 10`
  );
  console.log('=== PENDING WITH REJECTION REASON (retrying) ===');
  console.table(retrying.rows);

  // 4. Signal counts by status in last hour  
  const lastHour = await pool.query(
    `SELECT status, rejection_reason, COUNT(*)::int as cnt
     FROM signals
     WHERE timestamp >= NOW() - INTERVAL '1 hour'
     GROUP BY status, rejection_reason
     ORDER BY cnt DESC`
  );
  console.log('=== SIGNALS LAST HOUR ===');
  console.table(lastHour.rows);

  // 5. Check fly logs - any recent errors visible from the DB?
  const recentRejected = await pool.query(
    `SELECT signal_id, symbol, rejection_reason, processing_attempts, timestamp
     FROM signals
     WHERE status = 'rejected'
     ORDER BY timestamp DESC
     LIMIT 5`
  );
  console.log('=== MOST RECENT REJECTIONS ===');
  console.table(recentRejected.rows);

  await pool.end();
})();
