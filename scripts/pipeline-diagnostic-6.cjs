const pg = require('pg');
const { config } = require('../dist/config/index.js');
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });

async function run() {
  // 1. Pending signals age distribution
  const ageDistro = await pool.query(
    `SELECT
       CASE
         WHEN timestamp >= NOW() - INTERVAL '30 minutes' THEN '< 30 min'
         WHEN timestamp >= NOW() - INTERVAL '2 hours' THEN '30min - 2h'
         WHEN timestamp >= NOW() - INTERVAL '24 hours' THEN '2h - 24h'
         WHEN timestamp >= NOW() - INTERVAL '7 days' THEN '1d - 7d'
         ELSE '> 7d'
       END AS age_bucket,
       COUNT(*)::int AS cnt,
       MIN(timestamp) AS oldest,
       MAX(timestamp) AS newest
     FROM signals
     WHERE (status = 'pending' OR status IS NULL) AND processed = FALSE
     GROUP BY age_bucket
     ORDER BY MIN(timestamp) DESC`
  );
  console.log('=== PENDING SIGNALS AGE DISTRIBUTION ===');
  console.table(ageDistro.rows);

  // 2. Signal max age config
  console.log('\nSIGNAL_MAX_AGE_MINUTES:', config.signalMaxAgeMinutes);

  // 3. Last 10 status changes (any signal that was processed recently)
  const recentProcessed = await pool.query(
    `SELECT signal_id, symbol, status, rejection_reason, processing_attempts,
            timestamp, locked_at
     FROM signals
     WHERE status IN ('rejected', 'approved')
       AND locked_at IS NOT NULL
     ORDER BY locked_at DESC
     LIMIT 10`
  );
  console.log('=== MOST RECENTLY PROCESSED SIGNALS ===');
  console.table(recentProcessed.rows);

  // 4. Currently locked signals
  const locked = await pool.query(
    `SELECT signal_id, symbol, status, locked_by, locked_at, processing_attempts, timestamp
     FROM signals
     WHERE processing_lock = TRUE
     ORDER BY locked_at DESC`
  );
  console.log('=== CURRENTLY LOCKED SIGNALS ===');
  console.table(locked.rows);

  // 5. How many pending signals would pass the stale check?
  const freshPending = await pool.query(
    `SELECT COUNT(*)::int AS fresh_pending
     FROM signals
     WHERE (status = 'pending' OR status IS NULL)
       AND processed = FALSE
       AND processing_lock = FALSE
       AND timestamp >= NOW() - ($1 || ' minutes')::interval`,
    [String(config.signalMaxAgeMinutes)]
  );
  console.log('\n=== FRESH PENDING (within max age) ===');
  console.log('Fresh pending signals:', freshPending.rows[0]?.fresh_pending);
  console.log('Signal max age minutes:', config.signalMaxAgeMinutes);

  // 6. Signals created in the last hour
  const lastHour = await pool.query(
    `SELECT status, COUNT(*)::int AS cnt
     FROM signals
     WHERE timestamp >= NOW() - INTERVAL '1 hour'
     GROUP BY status ORDER BY cnt DESC`
  );
  console.log('\n=== SIGNALS CREATED LAST HOUR ===');
  console.table(lastHour.rows);

  // 7. What processed=TRUE vs FALSE looks like
  const processedFlag = await pool.query(
    `SELECT processed, status, COUNT(*)::int AS cnt
     FROM signals
     GROUP BY processed, status
     ORDER BY processed, cnt DESC`
  );
  console.log('=== PROCESSED FLAG BREAKDOWN ===');
  console.table(processedFlag.rows);

  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
