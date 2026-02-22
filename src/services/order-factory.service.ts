/**
 * Canonical order creation factory.
 * All order INSERT paths should go through here to enforce:
 *  - consistent field mapping
 *  - idempotency guards
 *  - transaction safety for exit orders
 */

import { db } from './database.service.js';

/** Minimal query interface satisfied by both db and pg.PoolClient */
export interface QueryClient {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export interface CreateEntryOrderParams {
  signalId: string;
  symbol: string;
  optionSymbol: string;
  strike: number;
  expiration: Date;
  type: 'call' | 'put';
  quantity: number;
  engine: 'A' | 'B' | string;
  experimentId: string | null;
  isTest?: boolean;
  client?: QueryClient;
}

export interface CreateExitOrderParams {
  symbol: string;
  optionSymbol: string;
  strike: number;
  expiration: Date;
  type: 'call' | 'put';
  quantity: number;
  engine: 'A' | 'B' | string | null;
  experimentId: string | null;
}

const INSERT_ORDER_SQL = `INSERT INTO orders (
  signal_id, symbol, option_symbol, strike, expiration,
  type, quantity, engine, experiment_id, order_type, status, is_test
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;

/**
 * Create an entry order (BUY TO OPEN).
 * Uses the provided transaction client if available, otherwise the default pool.
 */
export async function createEntryOrder(params: CreateEntryOrderParams): Promise<void> {
  const queryFn = params.client ?? db;
  await queryFn.query(INSERT_ORDER_SQL, [
    params.signalId,
    params.symbol,
    params.optionSymbol,
    params.strike,
    params.expiration,
    params.type,
    params.quantity,
    params.engine,
    params.experimentId,
    'paper',
    'pending_execution',
    params.isTest ?? false,
  ]);
}

/**
 * Create an exit order (SELL TO CLOSE).
 * signal_id is always NULL for exit orders to distinguish from entries.
 * Uses the provided transaction client if available.
 */
export async function createExitOrder(
  params: CreateExitOrderParams,
  client?: QueryClient
): Promise<void> {
  const queryFn = client ?? db;
  await queryFn.query(INSERT_ORDER_SQL, [
    null,
    params.symbol,
    params.optionSymbol,
    params.strike,
    params.expiration,
    params.type,
    params.quantity,
    params.engine ?? null,
    params.experimentId ?? null,
    'paper',
    'pending_execution',
    false,
  ]);
}
