// Database migration runner
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Migration {
  name: string;
  sql: string;
}

class MigrationRunner {
  private pool: pg.Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: 5,
    });
  }

  async connect(): Promise<void> {
    try {
      await this.pool.query('SELECT 1');
      logger.info('Database connection established');
    } catch (error) {
      logger.error('Failed to connect to database', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
    logger.info('Database connection closed');
  }

  async ensureMigrationsTable(): Promise<void> {
    const migrationTableSql = await readFile(
      join(__dirname, '000_create_migrations_table.sql'),
      'utf-8'
    );
    await this.pool.query(migrationTableSql);
    logger.info('Migrations table ensured');
  }

  async getAppliedMigrations(): Promise<string[]> {
    const result = await this.pool.query(
      'SELECT migration_name FROM schema_migrations ORDER BY migration_id'
    );
    return result.rows.map((row) => row.migration_name);
  }

  async getMigrationFiles(): Promise<Migration[]> {
    const files = await readdir(__dirname);
    const sqlFiles = files
      .filter((f) => f.endsWith('.sql') && f !== '000_create_migrations_table.sql')
      .sort();

    const migrations: Migration[] = [];
    for (const file of sqlFiles) {
      const sql = await readFile(join(__dirname, file), 'utf-8');
      migrations.push({ name: file, sql });
    }

    return migrations;
  }

  async runMigration(migration: Migration): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Execute migration SQL
      await client.query(migration.sql);

      // Record migration
      await client.query(
        'INSERT INTO schema_migrations (migration_name) VALUES ($1)',
        [migration.name]
      );

      await client.query('COMMIT');
      logger.info(`Migration applied: ${migration.name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`Migration failed: ${migration.name}`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  async migrateUp(): Promise<void> {
    logger.info('Starting migrations (UP)');

    await this.ensureMigrationsTable();
    const applied = await this.getAppliedMigrations();
    const migrations = await this.getMigrationFiles();

    const pending = migrations.filter((m) => !applied.includes(m.name));

    if (pending.length === 0) {
      logger.info('No pending migrations');
      return;
    }

    logger.info(`Found ${pending.length} pending migrations`);

    for (const migration of pending) {
      await this.runMigration(migration);
    }

    logger.info('All migrations completed successfully');
  }

  async migrateDown(): Promise<void> {
    logger.warn('Migration rollback not implemented');
    logger.warn('To rollback, manually drop tables or restore from backup');
  }
}

// CLI execution
async function main() {
  const command = process.argv[2] || 'up';

  const runner = new MigrationRunner();

  try {
    await runner.connect();

    if (command === 'up') {
      await runner.migrateUp();
    } else if (command === 'down') {
      await runner.migrateDown();
    } else {
      logger.error(`Unknown command: ${command}`);
      logger.info('Usage: node runner.js [up|down]');
      process.exit(1);
    }

    await runner.close();
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed', error);
    await runner.close();
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { MigrationRunner };
