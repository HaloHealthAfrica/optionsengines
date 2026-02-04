import pg from 'pg';
import dotenv from 'dotenv';
import { readFile } from 'fs/promises';

dotenv.config();

const { Pool } = pg;

async function testConnection() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('Testing connection...');
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Connection successful!', result.rows[0]);

    console.log('\nChecking existing tables...');
    const tables = await pool.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    console.log('Existing tables:', tables.rows.map(r => r.tablename));

    console.log('\nRunning migrations...');
    
    // Run migrations in order
    const migrations = [
      'dist/migrations/000_enable_pgcrypto.sql',
      'dist/migrations/001_create_engine1_tables.sql',
      'dist/migrations/002_create_engine2_tables.sql',
      'dist/migrations/003_add_signal_hash.sql'
    ];

    for (const migrationFile of migrations) {
      console.log(`\nRunning: ${migrationFile}`);
      const sql = await readFile(migrationFile, 'utf-8');
      await pool.query(sql);
      console.log(`✅ ${migrationFile} completed`);
    }

    console.log('\nChecking tables after migration...');
    const tablesAfter = await pool.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    console.log('Tables after migration:', tablesAfter.rows.map(r => r.tablename));

    await pool.end();
    console.log('\n✅ All done!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    await pool.end();
    process.exit(1);
  }
}

testConnection();
