#!/usr/bin/env node
/**
 * Validate null values across database tables.
 * Reports counts of nulls in each column where nulls are allowed (nullable columns).
 * Run: node scripts/validate-nulls.js (requires DATABASE_URL)
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const EXCLUDED_TABLES = ['schema_migrations'];

async function getTablesAndColumns(pool) {
  const { rows } = await pool.query(`
    SELECT
      t.table_name,
      c.column_name,
      c.is_nullable,
      c.data_type
    FROM information_schema.tables t
    JOIN information_schema.columns c ON t.table_name = c.table_name
      AND t.table_schema = c.table_schema
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND t.table_name = ANY($1::text[])
    ORDER BY t.table_name, c.ordinal_position
  `, [['signals', 'refactored_signals', 'orders', 'trades', 'refactored_positions',
       'experiments', 'agent_decisions', 'shadow_trades', 'shadow_positions',
       'agent_performance', 'feature_flags', 'webhook_events', 'execution_policies',
       'market_contexts', 'trade_outcomes', 'gex_snapshots', 'options_flow_snapshots',
       'decision_recommendations', 'test_sessions', 'users', 'exit_rules', 'risk_limits']]);
  return rows;
}

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

async function countNulls(pool, tableName, columnName) {
  const tbl = quoteIdent(tableName);
  const col = quoteIdent(columnName);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM ${tbl} WHERE ${col} IS NULL`
  );
  return rows[0]?.cnt ?? 0;
}

async function getTotalRows(pool, tableName) {
  const tbl = quoteIdent(tableName);
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS cnt FROM ${tbl}`);
  return rows[0]?.cnt ?? 0;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND table_name NOT IN ('schema_migrations')
      ORDER BY table_name
    `);

    console.log('=== Null Validation Report ===\n');
    console.log('Checking nullable columns for null values...\n');

    let totalIssues = 0;
    const results = [];

    for (const { table_name } of tables.rows) {
      const cols = await pool.query(`
        SELECT column_name, is_nullable, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [table_name]);

      const totalRows = await getTotalRows(pool, table_name);
      const tableNulls = [];

      for (const { column_name, is_nullable } of cols.rows) {
        const nullCount = await countNulls(pool, table_name, column_name);
        if (nullCount > 0) {
          tableNulls.push({ column: column_name, nullCount, totalRows });
          totalIssues += nullCount;
        }
      }

      if (tableNulls.length > 0) {
        results.push({ table: table_name, totalRows, nulls: tableNulls });
      }
    }

    if (results.length === 0) {
      console.log('No nulls found in nullable columns.\n');
      await pool.end();
      return;
    }

    for (const { table, totalRows, nulls } of results) {
      console.log(`\n${table} (${totalRows} total rows)`);
      console.log('-'.repeat(50));
      for (const { column, nullCount } of nulls) {
        const pct = totalRows > 0 ? ((nullCount / totalRows) * 100).toFixed(1) : '0';
        console.log(`  ${column}: ${nullCount} nulls (${pct}%)`);
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log(`Total null cells across tables: ${totalIssues}`);
    console.log('='.repeat(50));

    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    await pool.end();
    process.exit(1);
  }
}

main();
