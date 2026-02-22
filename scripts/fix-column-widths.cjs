const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  console.log('Widening remaining narrow timeframe/direction columns...\n');

  const alterStatements = [
    `ALTER TABLE decision_recommendations ALTER COLUMN timeframe TYPE varchar(50)`,
    `ALTER TABLE decision_recommendations ALTER COLUMN direction TYPE varchar(30)`,
    `ALTER TABLE alert_outcomes ALTER COLUMN timeframe TYPE varchar(50)`,
    `ALTER TABLE alert_outcomes ALTER COLUMN direction TYPE varchar(30)`,
    `ALTER TABLE strat_alerts ALTER COLUMN timeframe TYPE varchar(50)`,
    `ALTER TABLE strat_alerts ALTER COLUMN direction TYPE varchar(30)`,
    `ALTER TABLE strat_plans ALTER COLUMN timeframe TYPE varchar(50)`,
    `ALTER TABLE strat_plans ALTER COLUMN direction TYPE varchar(30)`,
    `ALTER TABLE flow_alerts ALTER COLUMN direction TYPE varchar(30)`,
  ];

  for (const sql of alterStatements) {
    try {
      await pool.query(sql);
      console.log('OK:', sql);
    } catch (e) {
      console.error('FAIL:', sql, '-', e.message);
    }
  }

  // Verify none remaining
  const r = await pool.query(`
    SELECT table_name, column_name, character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('timeframe', 'direction')
      AND data_type = 'character varying'
      AND character_maximum_length < 30
    ORDER BY table_name, column_name
  `);
  console.log('\n=== REMAINING NARROW COLUMNS ===');
  if (r.rows.length === 0) {
    console.log('  (none - all clear)');
  } else {
    console.table(r.rows);
  }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
