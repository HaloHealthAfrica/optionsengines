import pg from 'pg';
import { readFile } from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

async function testMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('Connecting to database...');
    await pool.query('SELECT 1');
    console.log('✓ Connected successfully');

    console.log('\nRunning migration 001...');
    const sql = await readFile('src/migrations/001_create_engine1_tables.sql', 'utf-8');
    await pool.query(sql);
    console.log('✓ Migration 001 completed');

    console.log('\nChecking if tables exist...');
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log('Tables in database:');
    result.rows.forEach(row => console.log(`  - ${row.table_name}`));

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

testMigration();
