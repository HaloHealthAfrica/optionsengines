import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
import { db } from '../services/database.service.js';
import { getProductionWebhookSchema } from '../services/webhook-schema.service.js';

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

function requireAccess(req: Request, res: Response, next: NextFunction): Response | void {
  const user = (req as Request & { user?: AuthPayload }).user;
  if (!user || !['admin', 'researcher'].includes(user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
}

router.get('/schema', requireAuth, requireAccess, async (_req: Request, res: Response) => {
  const schema = await getProductionWebhookSchema();
  return res.json(schema);
});

router.get('/recent-production', requireAuth, requireAccess, async (req: Request, res: Response) => {
  const limitParam = Number(req.query.limit);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 25) : 10;
  const status = String(req.query.status || '').toLowerCase();

  const params: Array<number | string> = [limit];
  const statusClause = status ? 'AND we.status = $2' : '';
  if (status) {
    params.push(status);
  }

  const result = await db.query(
    `SELECT we.event_id AS webhook_id,
            we.created_at AS received_at,
            s.symbol,
            s.timeframe,
            we.status,
            s.raw_payload
     FROM webhook_events we
     LEFT JOIN signals s ON s.signal_id = we.signal_id
     WHERE COALESCE(we.is_test, false) = false
     ${statusClause}
     ORDER BY we.created_at DESC
     LIMIT $1`,
    params
  );

  return res.json({
    webhooks: result.rows.map((row) => ({
      webhook_id: row.webhook_id,
      received_at: row.received_at,
      symbol: row.symbol,
      timeframe: row.timeframe,
      status: row.status,
      raw_payload: row.raw_payload,
    })),
  });
});

export default router;
