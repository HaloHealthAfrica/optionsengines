const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const r = await pool.query(`
    SELECT table_name, column_name, character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('timeframe', 'direction')
      AND data_type = 'character varying'
      AND character_maximum_length < 50
    ORDER BY table_name, column_name
  `);
  console.log('=== NARROW timeframe/direction COLUMNS (< 50 chars) ===');
  if (r.rows.length === 0) {
    console.log('  (none - all clear)');
  } else {
    console.table(r.rows);
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
