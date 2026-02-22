const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  // Get column names first
  const cols = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'refactored_positions' AND table_schema = 'public'
    ORDER BY ordinal_position
  `);
  console.log('Columns:', cols.rows.map(r => r.column_name).join(', '));

  // Preview
  const preview = await pool.query(`
    SELECT status, COUNT(*)::int as count
    FROM refactored_positions
    WHERE status IN ('open', 'closing')
      AND COALESCE(is_test, false) = false
      AND created_at < NOW() - INTERVAL '24 hours'
    GROUP BY status
  `);
  console.log('=== STALE POSITIONS TO CLOSE (>24h old) ===');
  console.table(preview.rows);

  const total = preview.rows.reduce((sum, r) => sum + r.count, 0);
  console.log('Total to close:', total);

  if (total === 0) {
    console.log('Nothing to close.');
    await pool.end();
    return;
  }

  // Close stale positions - just update status
  const result = await pool.query(`
    UPDATE refactored_positions
    SET status = 'closed'
    WHERE status IN ('open', 'closing')
      AND COALESCE(is_test, false) = false
      AND created_at < NOW() - INTERVAL '24 hours'
  `);
  console.log('Closed', result.rowCount, 'stale positions');

  // Verify
  const remaining = await pool.query(`
    SELECT status, COUNT(*)::int as count
    FROM refactored_positions
    WHERE status IN ('open', 'closing')
      AND COALESCE(is_test, false) = false
    GROUP BY status
  `);
  console.log('=== REMAINING OPEN/CLOSING POSITIONS ===');
  if (remaining.rows.length === 0) {
    console.log('  (none - all clear!)');
  } else {
    console.table(remaining.rows);
  }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
