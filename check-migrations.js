import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

async function checkMigrations() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('Checking applied migrations...\n');
    const result = await pool.query(`
      SELECT migration_name, applied_at 
      FROM schema_migrations 
      ORDER BY migration_id
    `);
    
    console.log('Applied migrations:');
    result.rows.forEach(r => {
      console.log(`  ✓ ${r.migration_name} (${r.applied_at.toISOString()})`);
    });
    
    console.log(`\nTotal: ${result.rows.length} migrations applied`);
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    await pool.end();
    process.exit(1);
  }
}

checkMigrations();
