const pg = require('pg');
const { config } = require('../dist/config/index.js');
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });

async function main() {
  // 1. Bulk-reject all pending signals older than signalMaxAgeMinutes
  const maxAge = config.signalMaxAgeMinutes || 30;
  const result = await pool.query(
    `UPDATE signals
     SET status = 'rejected',
         rejection_reason = 'signal_stale',
         processing_lock = FALSE,
         locked_by = NULL,
         locked_at = NULL
     WHERE (status IS NULL OR status = 'pending')
       AND processed = FALSE
       AND timestamp < NOW() - INTERVAL '${maxAge} minutes'
     RETURNING signal_id`
  );
  console.log(`[1] Bulk-rejected ${result.rowCount} stale pending signals (older than ${maxAge} min)`);

  // 2. Clear any stuck locks
  const locks = await pool.query(
    `UPDATE signals
     SET processing_lock = FALSE, locked_by = NULL, locked_at = NULL
     WHERE processing_lock = TRUE
     RETURNING signal_id, status`
  );
  console.log(`[2] Cleared ${locks.rowCount} stuck processing locks`);

  // 3. Summary
  const summary = await pool.query(
    `SELECT status, COUNT(*)::int as cnt,
            SUM(CASE WHEN processing_lock THEN 1 ELSE 0 END)::int as locked
     FROM signals GROUP BY status ORDER BY cnt DESC`
  );
  console.log('\n[3] Signal status after cleanup:');
  console.table(summary.rows);

  // 4. Fresh pending count
  const fresh = await pool.query(
    `SELECT COUNT(*)::int as cnt FROM signals
     WHERE (status = 'pending' OR status IS NULL)
       AND processed = FALSE
       AND processing_lock = FALSE
       AND timestamp >= NOW() - INTERVAL '${maxAge} minutes'`
  );
  console.log(`\nFresh pending signals ready for processing: ${fresh.rows[0].cnt}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
