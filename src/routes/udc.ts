import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../services/database.service.js';
import { authService } from '../services/auth.service.js';
import { logger } from '../utils/logger.js';
import { getTradingMode, setTradingMode, type TradingMode } from '../config/trading-mode.js';

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

function requireAdmin(req: Request, res: Response, next: NextFunction): Response | void {
  const user = (req as Request & { user?: AuthPayload }).user;
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}

router.get('/snapshots', requireAuth, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 200);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const status = req.query.status as string | undefined;

    let query = `SELECT id, signal_id, decision_id, status, reason, order_plan_json, strategy_json, created_at
                 FROM decision_snapshots`;
    const params: unknown[] = [];

    if (status) {
      params.push(status);
      query += ` WHERE status = $${params.length}`;
    }

    query += ` ORDER BY created_at DESC`;
    params.push(limit);
    query += ` LIMIT $${params.length}`;
    params.push(offset);
    query += ` OFFSET $${params.length}`;

    const result = await db.query(query, params);

    const countQuery = status
      ? `SELECT COUNT(*)::int AS total FROM decision_snapshots WHERE status = $1`
      : `SELECT COUNT(*)::int AS total FROM decision_snapshots`;
    const countResult = await db.query(countQuery, status ? [status] : []);

    res.json({
      data: result.rows,
      total: countResult.rows[0]?.total ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    logger.error('Failed to fetch UDC snapshots', err);
    res.status(500).json({ error: 'Failed to fetch snapshots' });
  }
});

router.get('/mode', requireAuth, async (_req: Request, res: Response) => {
  res.json({ mode: getTradingMode() });
});

const VALID_MODES: TradingMode[] = ['LEGACY_ONLY', 'SHADOW_UDC', 'UDC_PRIMARY', 'UDC_ONLY'];

router.post('/mode', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { mode } = req.body as { mode?: string };
    if (!mode || !VALID_MODES.includes(mode as TradingMode)) {
      return res.status(400).json({
        error: `Invalid mode. Must be one of: ${VALID_MODES.join(', ')}`,
      });
    }

    await setTradingMode(mode as TradingMode);

    const user = (req as Request & { user?: AuthPayload }).user;
    logger.info('Trading mode changed via API', {
      mode,
      changedBy: user?.email,
    });

    return res.json({ mode, updatedAt: new Date().toISOString() });
  } catch (err) {
    logger.error('Failed to update trading mode', err);
    return res.status(500).json({ error: 'Failed to update trading mode' });
  }
});

export default router;
