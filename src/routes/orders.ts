import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
import { db } from '../services/database.service.js';
import { marketData } from '../services/market-data.js';

const router = Router();

type AuthPayload = {
  userId: string;
  email: string;
  role: 'admin' | 'researcher' | 'user';
};

function requireAuth(req: Request, res: Response, next: NextFunction): Response | void {
  const token = authService.extractTokenFromHeader(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = authService.verifyToken(token) as AuthPayload | null;
  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  (req as Request & { user?: AuthPayload }).user = payload;
  return next();
}

function mapOrderStatus(status: string): 'pending' | 'filled' | 'failed' {
  if (status === 'filled') return 'filled';
  if (status === 'pending_execution') return 'pending';
  return 'failed';
}

function buildDecisionSummary(row: any): any | null {
  const engineLetter = row.engine || row.variant || 'A';
  if (row.meta_bias || row.meta_confidence || row.meta_reasons || row.meta_block !== null) {
    return {
      engine: `Engine ${engineLetter}`,
      source: 'meta_decision',
      bias: row.meta_bias || null,
      confidence: row.meta_confidence ?? null,
      blocked: Boolean(row.meta_block),
      reasons: row.meta_reasons || [],
      metadata: row.meta_metadata || null,
    };
  }

  if (row.risk_check_result) {
    return {
      engine: `Engine ${engineLetter}`,
      source: 'risk_checks',
      risk: row.risk_check_result,
    };
  }

  return {
    engine: `Engine ${engineLetter}`,
    source: 'unknown',
  };
}

const RECENTLY_FILLED_WINDOW_SECONDS = 120;

router.get('/', requireAuth, async (_req: Request, res: Response) => {
  const [pendingOrdersResult, tradesResult, recentlyFilledResult, positionsResult] = await Promise.all([
    db.query(
      `SELECT o.order_id,
              o.signal_id,
              o.symbol,
              o.type,
              o.strike,
              o.expiration,
              o.quantity,
              o.status,
              o.created_at,
              o.engine,
              e.variant,
              md.bias AS meta_bias,
              md.confidence AS meta_confidence,
              md.reasons AS meta_reasons,
              md.block AS meta_block,
              md.metadata AS meta_metadata,
              rs.risk_check_result
       FROM orders o
       LEFT JOIN experiments e ON e.signal_id = o.signal_id
       LEFT JOIN agent_decisions md
         ON md.signal_id = o.signal_id AND md.agent_name = 'meta_decision'
       LEFT JOIN refactored_signals rs ON rs.signal_id = o.signal_id
       WHERE o.status = $1
       ORDER BY o.created_at DESC`,
      ['pending_execution']
    ),
    db.query(
      `SELECT t.trade_id,
              t.order_id,
              t.fill_price,
              t.fill_quantity,
              t.fill_timestamp,
              COALESCE(t.engine, o.engine) AS engine,
              o.signal_id,
              o.symbol,
              o.type,
              o.strike,
              o.expiration,
              o.quantity,
              e.variant,
              md.bias AS meta_bias,
              md.confidence AS meta_confidence,
              md.reasons AS meta_reasons,
              md.block AS meta_block,
              md.metadata AS meta_metadata,
              rs.risk_check_result
       FROM trades t
       JOIN orders o ON o.order_id = t.order_id
       LEFT JOIN experiments e ON e.signal_id = o.signal_id
       LEFT JOIN agent_decisions md
         ON md.signal_id = o.signal_id AND md.agent_name = 'meta_decision'
       LEFT JOIN refactored_signals rs ON rs.signal_id = o.signal_id
       ORDER BY t.fill_timestamp DESC
       LIMIT 200`
    ),
    db.query(
      `SELECT t.trade_id,
              t.order_id,
              t.fill_price,
              t.fill_quantity,
              t.fill_timestamp,
              COALESCE(t.engine, o.engine) AS engine,
              o.signal_id,
              o.symbol,
              o.type,
              o.strike,
              o.expiration,
              o.quantity,
              e.variant,
              md.bias AS meta_bias,
              md.confidence AS meta_confidence,
              md.reasons AS meta_reasons,
              md.block AS meta_block,
              md.metadata AS meta_metadata,
              rs.risk_check_result
       FROM trades t
       JOIN orders o ON o.order_id = t.order_id AND o.order_type = $1
       LEFT JOIN experiments e ON e.signal_id = o.signal_id
       LEFT JOIN agent_decisions md
         ON md.signal_id = o.signal_id AND md.agent_name = 'meta_decision'
       LEFT JOIN refactored_signals rs ON rs.signal_id = o.signal_id
       WHERE t.fill_timestamp >= NOW() - INTERVAL '1 second' * $2
       ORDER BY t.fill_timestamp DESC
       LIMIT 50`,
      ['paper', RECENTLY_FILLED_WINDOW_SECONDS]
    ),
    db.query(
      `SELECT position_id,
              symbol,
              option_symbol,
              strike,
              expiration,
              type,
              quantity,
              entry_price,
              realized_pnl,
              position_pnl_percent,
              entry_timestamp,
              exit_timestamp,
              status,
              engine
       FROM refactored_positions
       WHERE status = $1
       ORDER BY exit_timestamp DESC NULLS LAST
       LIMIT 200`,
      ['closed']
    ),
  ]);

  const ordersRaw = pendingOrdersResult.rows.map((row: any) => ({
    id: row.order_id,
    signal_id: row.signal_id,
    symbol: row.symbol,
    type: row.type === 'call' ? 'Call' : 'Put',
    strike: Number(row.strike),
    expiry: row.expiration ? new Date(row.expiration).toISOString().slice(0, 10) : null,
    qty: Number(row.quantity),
    price: null as number | null,
    status: mapOrderStatus(row.status),
    time: row.created_at ? new Date(row.created_at).toISOString() : null,
    pnl: null,
    engine: row.engine || null,
    decision: buildDecisionSummary(row),
  }));

  // Enrich pending orders with live option price (from Alpaca, Polygon, or Unusual Whales)
  const orders = await Promise.all(
    ordersRaw.map(async (order) => {
      if (order.symbol && order.strike != null && order.expiry && order.type) {
        try {
          const expiration = new Date(order.expiry);
          const optionType = order.type.toLowerCase() as 'call' | 'put';
          const price = await marketData.getOptionPrice(
            order.symbol,
            order.strike,
            expiration,
            optionType
          );
          if (price != null && Number.isFinite(price)) {
            return { ...order, price };
          }
        } catch (err) {
          // Keep price null on failure
        }
      }
      return order;
    })
  );

  const trades = tradesResult.rows.map((row: any) => ({
    id: row.trade_id,
    order_id: row.order_id,
    signal_id: row.signal_id,
    symbol: row.symbol,
    type: row.type === 'call' ? 'Call' : 'Put',
    strike: Number(row.strike),
    expiry: row.expiration ? new Date(row.expiration).toISOString().slice(0, 10) : null,
    qty: Number(row.fill_quantity ?? row.quantity),
    price: row.fill_price !== null && row.fill_price !== undefined ? Number(row.fill_price) : null,
    status: 'filled',
    time: row.fill_timestamp ? new Date(row.fill_timestamp).toISOString() : null,
    pnl: null,
    engine: row.engine || null,
    decision: buildDecisionSummary(row),
  }));

  const positions = positionsResult.rows.map((row: any) => ({
    id: row.position_id,
    symbol: row.symbol,
    option_symbol: row.option_symbol,
    type: row.type === 'call' ? 'Call' : 'Put',
    strike: Number(row.strike),
    expiry: row.expiration ? new Date(row.expiration).toISOString().slice(0, 10) : null,
    qty: Number(row.quantity),
    entry_price: row.entry_price !== null && row.entry_price !== undefined ? Number(row.entry_price) : null,
    realized_pnl: row.realized_pnl !== null && row.realized_pnl !== undefined ? Number(row.realized_pnl) : null,
    pnl_percent:
      row.position_pnl_percent !== null && row.position_pnl_percent !== undefined
        ? Number(row.position_pnl_percent)
        : null,
    status: row.status,
    time: row.exit_timestamp ? new Date(row.exit_timestamp).toISOString() : null,
    engine: row.engine || null,
  }));

  const recentlyFilled = recentlyFilledResult.rows.map((row: any) => ({
    id: row.trade_id,
    order_id: row.order_id,
    signal_id: row.signal_id,
    symbol: row.symbol,
    type: row.type === 'call' ? 'Call' : 'Put',
    strike: Number(row.strike),
    expiry: row.expiration ? new Date(row.expiration).toISOString().slice(0, 10) : null,
    qty: Number(row.fill_quantity ?? row.quantity),
    price: row.fill_price !== null && row.fill_price !== undefined ? Number(row.fill_price) : null,
    status: 'filled',
    time: row.fill_timestamp ? new Date(row.fill_timestamp).toISOString() : null,
    engine: row.engine || null,
    decision: buildDecisionSummary(row),
    isRecentlyFilled: true,
  }));

  res.json({ orders, trades, positions, recentlyFilled });
});

export default router;
