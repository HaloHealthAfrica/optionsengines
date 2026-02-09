import { db } from './database.service.js';
import { config } from '../config/index.js';
import { broadcastRealtime } from './realtime-websocket.service.js';
import { marketIntelSnapshotService } from './market-intel/market-intel-snapshot.service.js';

type PositionRow = {
  position_id: string;
  symbol: string;
  option_symbol: string;
  strike: number;
  expiration: Date;
  type: 'call' | 'put';
  quantity: number;
  entry_price: number;
  current_price?: number | null;
  unrealized_pnl?: number | null;
  realized_pnl?: number | null;
  position_pnl_percent?: number | null;
  status: 'open' | 'closing' | 'closed';
  entry_timestamp?: Date | null;
  exit_timestamp?: Date | null;
  last_updated?: Date | null;
};

function mapPosition(row: PositionRow) {
  return {
    id: row.position_id,
    symbol: row.symbol,
    option_symbol: row.option_symbol,
    type: row.type,
    strike: Number(row.strike),
    expiry: row.expiration ? new Date(row.expiration).toISOString().slice(0, 10) : null,
    qty: Number(row.quantity),
    entry_price: row.entry_price !== null ? Number(row.entry_price) : null,
    current_price: row.current_price !== null && row.current_price !== undefined ? Number(row.current_price) : null,
    unrealized_pnl: row.unrealized_pnl !== null && row.unrealized_pnl !== undefined ? Number(row.unrealized_pnl) : null,
    realized_pnl: row.realized_pnl !== null && row.realized_pnl !== undefined ? Number(row.realized_pnl) : null,
    pnl_percent:
      row.position_pnl_percent !== null && row.position_pnl_percent !== undefined
        ? Number(row.position_pnl_percent)
        : null,
    status: row.status,
    entry_time: row.entry_timestamp ? new Date(row.entry_timestamp).toISOString() : null,
    exit_time: row.exit_timestamp ? new Date(row.exit_timestamp).toISOString() : null,
    updated_at: row.last_updated ? new Date(row.last_updated).toISOString() : null,
  };
}

export async function publishPositionUpdate(positionId: string): Promise<void> {
  const result = await db.query<PositionRow>(
    `SELECT position_id,
            symbol,
            option_symbol,
            strike,
            expiration,
            type,
            quantity,
            entry_price,
            current_price,
            unrealized_pnl,
            realized_pnl,
            position_pnl_percent,
            status,
            entry_timestamp,
            exit_timestamp,
            last_updated
     FROM refactored_positions
     WHERE position_id = $1
     LIMIT 1`,
    [positionId]
  );

  const row = result.rows[0];
  if (!row) return;
  broadcastRealtime('position_update', mapPosition(row));
}

export async function publishRiskUpdate(): Promise<void> {
  const [riskLimitResult, openPositionsResult, pnlResult] = await Promise.all([
    db.query(
      `SELECT max_position_size,
              max_total_exposure,
              max_exposure_percent,
              max_positions_per_symbol
       FROM risk_limits
       WHERE enabled = true
       ORDER BY created_at DESC
       LIMIT 1`
    ),
    db.query(
      `SELECT COUNT(*)::int AS open_positions
       FROM refactored_positions
       WHERE status IN ('open', 'closing')`
    ),
    db.query(
      `SELECT COALESCE(SUM(unrealized_pnl), 0) AS unrealized_pnl,
              COALESCE(SUM(realized_pnl), 0) AS realized_pnl
       FROM refactored_positions`
    ),
  ]);

  const riskLimit = riskLimitResult.rows[0] || {};

  broadcastRealtime('risk_update', {
    timestamp: new Date().toISOString(),
    open_positions: openPositionsResult.rows[0]?.open_positions ?? 0,
    max_open_positions: config.maxOpenPositions,
    max_positions_per_symbol: riskLimit.max_positions_per_symbol ?? null,
    max_position_size: riskLimit.max_position_size ?? null,
    max_total_exposure: riskLimit.max_total_exposure ?? null,
    max_exposure_percent: riskLimit.max_exposure_percent ?? null,
    unrealized_pnl: Number(pnlResult.rows[0]?.unrealized_pnl ?? 0),
    realized_pnl: Number(pnlResult.rows[0]?.realized_pnl ?? 0),
  });
}

export async function publishIntelUpdate(symbol: string): Promise<void> {
  const snapshot = await marketIntelSnapshotService.getLatest(symbol);
  broadcastRealtime('intel_update', snapshot, symbol);
}
