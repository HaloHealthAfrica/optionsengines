const pg = require('pg');
require('dotenv').config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  max: 2,
});

async function run() {
  try {
    // Disable confluence gate in DB
    const r1 = await pool.query(
      `UPDATE flow_config SET value_bool = false WHERE key = 'enable_confluence_gate'`
    );
    console.log('Disabled confluence gate:', r1.rowCount, 'row(s) updated');

    // Lower threshold as backup
    const r2 = await pool.query(
      `UPDATE flow_config SET value_number = 0 WHERE key = 'confluence_min_threshold'`
    );
    console.log('Set confluence threshold to 0:', r2.rowCount, 'row(s) updated');

    // Verify
    const verify = await pool.query(`SELECT key, value_text, value_number, value_bool FROM flow_config`);
    console.log('\n=== UPDATED FLOW_CONFIG ===');
    console.table(verify.rows);

  } catch (e) {
    console.error('ERROR:', e.message);
  }
  await pool.end();
}

run();
