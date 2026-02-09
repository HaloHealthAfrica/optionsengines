import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { logger } from '../utils/logger.js';
import { db } from './database.service.js';
import { config } from '../config/index.js';
import { marketIntelSnapshotService } from './market-intel/market-intel-snapshot.service.js';

type ClientState = {
  symbol: string;
};

type BroadcastPayload = {
  type: 'intel_update' | 'position_update' | 'positions_snapshot' | 'risk_update';
  data: any;
};

let wss: WebSocketServer | null = null;
const clients = new Map<WebSocket, ClientState>();

function normalizeSymbol(value?: string | null): string {
  const trimmed = String(value || '').trim().toUpperCase();
  return trimmed || 'SPY';
}

async function getPositionsSnapshot(limit: number = 50) {
  const result = await db.query(
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
     WHERE status IN ('open', 'closing')
     ORDER BY last_updated DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows.map((row: any) => ({
    id: row.position_id,
    symbol: row.symbol,
    option_symbol: row.option_symbol,
    type: row.type,
    strike: Number(row.strike),
    expiry: row.expiration ? new Date(row.expiration).toISOString().slice(0, 10) : null,
    qty: Number(row.quantity),
    entry_price: row.entry_price !== null ? Number(row.entry_price) : null,
    current_price: row.current_price !== null ? Number(row.current_price) : null,
    unrealized_pnl: row.unrealized_pnl !== null ? Number(row.unrealized_pnl) : null,
    realized_pnl: row.realized_pnl !== null ? Number(row.realized_pnl) : null,
    pnl_percent: row.position_pnl_percent !== null ? Number(row.position_pnl_percent) : null,
    status: row.status,
    entry_time: row.entry_timestamp ? new Date(row.entry_timestamp).toISOString() : null,
    exit_time: row.exit_timestamp ? new Date(row.exit_timestamp).toISOString() : null,
    updated_at: row.last_updated ? new Date(row.last_updated).toISOString() : null,
  }));
}

async function getRiskSnapshot() {
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

  return {
    timestamp: new Date().toISOString(),
    open_positions: openPositionsResult.rows[0]?.open_positions ?? 0,
    max_open_positions: config.maxOpenPositions,
    max_positions_per_symbol: riskLimit.max_positions_per_symbol ?? null,
    max_position_size: riskLimit.max_position_size ?? null,
    max_total_exposure: riskLimit.max_total_exposure ?? null,
    max_exposure_percent: riskLimit.max_exposure_percent ?? null,
    unrealized_pnl: Number(pnlResult.rows[0]?.unrealized_pnl ?? 0),
    realized_pnl: Number(pnlResult.rows[0]?.realized_pnl ?? 0),
  };
}

async function sendInitialSnapshots(socket: WebSocket, symbol: string) {
  try {
    const intel = await marketIntelSnapshotService.getLatest(symbol);
    socket.send(JSON.stringify({ type: 'intel_update', data: intel }));
  } catch (error) {
    logger.warn('Realtime intel snapshot failed', { error, symbol });
  }

  try {
    const positions = await getPositionsSnapshot();
    socket.send(JSON.stringify({ type: 'positions_snapshot', data: positions }));
  } catch (error) {
    logger.warn('Realtime positions snapshot failed', { error });
  }

  try {
    const risk = await getRiskSnapshot();
    socket.send(JSON.stringify({ type: 'risk_update', data: risk }));
  } catch (error) {
    logger.warn('Realtime risk snapshot failed', { error });
  }
}

export function startRealtimeWebSocketServer(server: Server): WebSocketServer {
  if (wss) {
    return wss;
  }

  wss = new WebSocketServer({ server, path: '/v1/realtime' });

  wss.on('connection', (socket, request) => {
    const url = new URL(request.url || '/v1/realtime', 'http://localhost');
    const symbol = normalizeSymbol(url.searchParams.get('symbol'));
    clients.set(socket, { symbol });
    sendInitialSnapshots(socket, symbol).catch(() => undefined);

    socket.on('message', (data) => {
      try {
        const payload = JSON.parse(data.toString());
        if (payload?.action === 'subscribe' && payload?.symbol) {
          const nextSymbol = normalizeSymbol(payload.symbol);
          clients.set(socket, { symbol: nextSymbol });
          sendInitialSnapshots(socket, nextSymbol).catch(() => undefined);
        }
      } catch {
        // Ignore malformed payloads
      }
    });

    socket.on('close', () => {
      clients.delete(socket);
    });
  });

  logger.info('Realtime WebSocket server started', { path: '/v1/realtime' });
  return wss;
}

export function stopRealtimeWebSocketServer(): void {
  if (!wss) {
    return;
  }

  wss.clients.forEach((client) => client.close());
  wss.close();
  wss = null;
  clients.clear();
}

export function broadcastRealtime(type: BroadcastPayload['type'], data: any, symbol?: string): void {
  if (!wss) {
    return;
  }

  const payload = JSON.stringify({ type, data });
  const normalizedSymbol = symbol ? normalizeSymbol(symbol) : null;

  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) {
      return;
    }

    if (type === 'intel_update' && normalizedSymbol) {
      const state = clients.get(client);
      if (state && state.symbol !== normalizedSymbol) {
        return;
      }
    }

    client.send(payload);
  });
}
