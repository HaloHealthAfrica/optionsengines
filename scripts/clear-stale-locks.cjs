/**
 * One-time script: Clear stale processing locks and reset market_data_unavailable rejections.
 * Run with: node scripts/clear-stale-locks.cjs
 */
const pg = require('pg');
const { config } = require('../dist/config/index.js');

async function main() {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });

  try {
    // 1. Clear all stale processing locks (any status)
    const lockResult = await pool.query(
      `UPDATE signals
       SET processing_lock = FALSE, locked_by = NULL, locked_at = NULL
       WHERE processing_lock = TRUE
       RETURNING signal_id, status`
    );
    console.log(`[1] Cleared processing_lock on ${lockResult.rowCount} signals`);
    if (lockResult.rowCount > 0) {
      const byStatus = {};
      for (const row of lockResult.rows) {
        byStatus[row.status || 'NULL'] = (byStatus[row.status || 'NULL'] || 0) + 1;
      }
      console.log('   Breakdown by status:', byStatus);
    }

    // 2. Reset market_data_unavailable rejections to pending for retry
    const resetResult = await pool.query(
      `UPDATE signals
       SET status = 'pending',
           rejection_reason = NULL,
           processing_attempts = 0,
           next_retry_at = NULL,
           processed = FALSE
       WHERE status = 'rejected'
         AND rejection_reason = 'market_data_unavailable'
         AND processing_lock = FALSE
       RETURNING signal_id`
    );
    console.log(`[2] Reset ${resetResult.rowCount} market_data_unavailable signals to pending`);

    // 3. Summary of current signal states
    const summary = await pool.query(
      `SELECT status, COUNT(*)::int AS count, 
              SUM(CASE WHEN processing_lock THEN 1 ELSE 0 END)::int AS locked
       FROM signals
       GROUP BY status
       ORDER BY count DESC`
    );
    console.log('\n[3] Signal status summary:');
    for (const row of summary.rows) {
      console.log(`   ${row.status || 'NULL'}: ${row.count} (${row.locked} locked)`);
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
