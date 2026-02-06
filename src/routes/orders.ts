import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
import { db } from '../services/database.service.js';

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

function mapOrderStatus(status: string): 'pending' | 'filled' | 'cancelled' {
  if (status === 'filled') return 'filled';
  if (status === 'pending_execution') return 'pending';
  return 'cancelled';
}

router.get('/', requireAuth, async (_req: Request, res: Response) => {
  const result = await db.query(
    `SELECT DISTINCT ON (o.order_id)
      o.order_id,
      o.symbol,
      o.type,
      o.strike,
      o.expiration,
      o.quantity,
      o.status,
      o.created_at,
      t.fill_price,
      t.fill_timestamp
     FROM orders o
     LEFT JOIN trades t ON t.order_id = o.order_id
     ORDER BY o.order_id, t.fill_timestamp DESC NULLS LAST`
  );

  const orders = result.rows.map((row: any) => {
    const price = row.fill_price !== null && row.fill_price !== undefined ? Number(row.fill_price) : null;
    const timestamp = row.fill_timestamp || row.created_at;
    return {
      id: row.order_id,
      symbol: row.symbol,
      type: row.type === 'call' ? 'Call' : 'Put',
      strike: Number(row.strike),
      expiry: row.expiration ? new Date(row.expiration).toISOString().slice(0, 10) : null,
      qty: Number(row.quantity),
      price,
      status: mapOrderStatus(row.status),
      time: timestamp ? new Date(timestamp).toISOString() : null,
      pnl: null,
    };
  });

  res.json({ orders });
});

export default router;
