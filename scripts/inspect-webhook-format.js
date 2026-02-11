import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable.');
  process.exit(1);
}

async function run() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const result = await pool.query(
      `SELECT raw_payload, created_at
       FROM signals
       WHERE COALESCE(is_test, false) = false
       ORDER BY created_at DESC
       LIMIT 1`
    );

    if (result.rows.length === 0) {
      console.log('No production webhooks found in signals.');
      return;
    }

    const row = result.rows[0];
    console.log('Latest production webhook timestamp:', row.created_at);
    console.log('Payload:');
    console.log(JSON.stringify(row.raw_payload, null, 2));
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error('Failed to inspect webhook format:', error.message || error);
  process.exit(1);
});
