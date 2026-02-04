// Database Service: PostgreSQL connection pool and query execution
import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

export class DatabaseService {
  private pool: pg.Pool;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 10;
  private readonly reconnectInterval: number = 5000; // 5 seconds

  constructor() {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: config.dbPoolMax,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.pool.on('connect', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      logger.debug('Database client connected');
    });

    this.pool.on('error', (err) => {
      logger.error('Unexpected database pool error', err);
      this.isConnected = false;
      this.handleDisconnection();
    });

    this.pool.on('remove', () => {
      logger.debug('Database client removed from pool');
    });
  }

  private async handleDisconnection(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached, giving up');
      return;
    }

    this.reconnectAttempts++;
    logger.warn(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    await new Promise((resolve) => setTimeout(resolve, this.reconnectInterval));

    try {
      await this.connect();
      logger.info('Database reconnection successful');
    } catch (error) {
      logger.error('Database reconnection failed', error);
      await this.handleDisconnection();
    }
  }

  async connect(): Promise<void> {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      this.isConnected = true;
      this.reconnectAttempts = 0;
      logger.info('Database connection established');
    } catch (error) {
      this.isConnected = false;
      logger.error('Failed to connect to database', error);
      throw error;
    }
  }

  async query<T extends pg.QueryResultRow = any>(text: string, params?: any[]): Promise<pg.QueryResult<T>> {
    const start = Date.now();
    try {
      const result = await this.pool.query<T>(text, params);
      const duration = Date.now() - start;

      if (duration > config.slowRequestMs) {
        logger.warn('Slow query detected', {
          duration,
          query: text.substring(0, 100),
        });
      }

      return result;
    } catch (error) {
      logger.error('Query execution failed', error, {
        query: text.substring(0, 100),
        params: params?.slice(0, 5),
      });
      throw error;
    }
  }

  async transaction<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Transaction failed, rolled back', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getClient(): Promise<pg.PoolClient> {
    return this.pool.connect();
  }

  getConnectionStatus(): { connected: boolean; reconnectAttempts: number } {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
    this.isConnected = false;
    logger.info('Database connection pool closed');
  }

  // Helper methods for common operations

  async findOne<T extends pg.QueryResultRow = any>(
    table: string,
    conditions: Record<string, any>
  ): Promise<T | null> {
    const keys = Object.keys(conditions);
    const values = Object.values(conditions);
    const whereClause = keys.map((key, idx) => `${key} = $${idx + 1}`).join(' AND ');

    const query = `SELECT * FROM ${table} WHERE ${whereClause} LIMIT 1`;
    const result = await this.query<T>(query, values);

    return result.rows[0] || null;
  }

  async findMany<T extends pg.QueryResultRow = any>(
    table: string,
    conditions?: Record<string, any>,
    limit?: number,
    offset?: number
  ): Promise<T[]> {
    let query = `SELECT * FROM ${table}`;
    const values: any[] = [];

    if (conditions && Object.keys(conditions).length > 0) {
      const keys = Object.keys(conditions);
      const whereClause = keys.map((key, idx) => `${key} = $${idx + 1}`).join(' AND ');
      query += ` WHERE ${whereClause}`;
      values.push(...Object.values(conditions));
    }

    if (limit) {
      query += ` LIMIT $${values.length + 1}`;
      values.push(limit);
    }

    if (offset) {
      query += ` OFFSET $${values.length + 1}`;
      values.push(offset);
    }

    const result = await this.query<T>(query, values);
    return result.rows;
  }

  async insert<T extends pg.QueryResultRow = any>(
    table: string,
    data: Record<string, any>
  ): Promise<T> {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, idx) => `$${idx + 1}`).join(', ');
    const columns = keys.join(', ');

    const query = `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING *`;
    const result = await this.query<T>(query, values);

    return result.rows[0];
  }

  async update<T extends pg.QueryResultRow = any>(
    table: string,
    data: Record<string, any>,
    conditions: Record<string, any>
  ): Promise<T[]> {
    const dataKeys = Object.keys(data);
    const dataValues = Object.values(data);
    const conditionKeys = Object.keys(conditions);
    const conditionValues = Object.values(conditions);

    const setClause = dataKeys.map((key, idx) => `${key} = $${idx + 1}`).join(', ');
    const whereClause = conditionKeys
      .map((key, idx) => `${key} = $${dataValues.length + idx + 1}`)
      .join(' AND ');

    const query = `UPDATE ${table} SET ${setClause} WHERE ${whereClause} RETURNING *`;
    const result = await this.query<T>(query, [...dataValues, ...conditionValues]);

    return result.rows;
  }

  async delete(table: string, conditions: Record<string, any>): Promise<number> {
    const keys = Object.keys(conditions);
    const values = Object.values(conditions);
    const whereClause = keys.map((key, idx) => `${key} = $${idx + 1}`).join(' AND ');

    const query = `DELETE FROM ${table} WHERE ${whereClause}`;
    const result = await this.query(query, values);

    return result.rowCount || 0;
  }
}

// Singleton instance
export const db = new DatabaseService();
