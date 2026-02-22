const pg = require('pg');
const { config } = require('../dist/config/index.js');
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });
(async () => {
  const r1 = await pool.query(`SELECT COUNT(*)::int as pending FROM signals WHERE (status='pending' OR status IS NULL) AND processed=FALSE AND processing_lock=FALSE`);
  const r2 = await pool.query(`SELECT COUNT(*)::int as locked FROM signals WHERE processing_lock=TRUE`);
  const r3 = await pool.query(`SELECT signal_id, symbol, status, rejection_reason, locked_at FROM signals WHERE locked_at >= NOW() - INTERVAL '5 minutes' ORDER BY locked_at DESC LIMIT 5`);
  const r4 = await pool.query(`SELECT COUNT(*)::int as total, MAX(created_at) as latest FROM experiments WHERE created_at >= NOW() - INTERVAL '5 minutes'`);
  const r5 = await pool.query(`SELECT COUNT(*)::int as total, MAX(created_at) as latest FROM decision_recommendations WHERE created_at >= NOW() - INTERVAL '5 minutes'`);
  const r6 = await pool.query(`SELECT status, rejection_reason, COUNT(*)::int as cnt FROM signals WHERE locked_at >= NOW() - INTERVAL '5 minutes' GROUP BY status, rejection_reason ORDER BY cnt DESC`);
  console.log('Pending:', r1.rows[0].pending, '| Locked:', r2.rows[0].locked);
  console.log('New experiments (5m):', r4.rows[0].total, '| latest:', r4.rows[0].latest);
  console.log('New decisions (5m):', r5.rows[0].total, '| latest:', r5.rows[0].latest);
  console.log('\nProcessed in last 5 min:');
  console.table(r6.rows);
  if (r3.rows.length > 0) { console.log('\nRecent processed:'); console.table(r3.rows); }
  await pool.end();
})();
