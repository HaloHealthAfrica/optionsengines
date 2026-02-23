import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
import { logger } from '../utils/logger.js';
import { strategyRollupService } from '../engine/dashboard/StrategyRollupService.js';
import { driftDetectionEngine } from '../engine/dashboard/DriftDetectionEngine.js';
import { contextPerformanceService } from '../engine/dashboard/ContextPerformanceService.js';
import { db } from '../services/database.service.js';

const router = Router();

type AuthPayload = {
  userId: string;
  email: string;
  role: 'admin' | 'researcher' | 'user';
};

function requireAuth(req: Request, res: Response, next: NextFunction): Response | void {
  const token = authService.extractTokenFromHeader(req.headers.authorization);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const payload = authService.verifyToken(token) as AuthPayload | null;
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });

  (req as Request & { user?: AuthPayload }).user = payload;
  return next();
}

async function getAccountId(userId: string): Promise<string | null> {
  const result = await db.query(
    'SELECT id FROM oe_trading_accounts WHERE owner_user_id = $1 LIMIT 1',
    [userId]
  );
  return result.rows.length > 0 ? (result.rows[0].id as string) : null;
}

router.get('/overview', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user: AuthPayload }).user;
    const accountId = await getAccountId(user.userId);

    if (!accountId) {
      return res.json({ rollups: [], drifts: [], context: {} });
    }

    const [rollups, drifts, contextMap] = await Promise.all([
      strategyRollupService.computeAllRollups(accountId),
      driftDetectionEngine.getUnresolvedDrifts(accountId),
      contextPerformanceService.computeAllStrategies(accountId),
    ]);

    const context: Record<string, unknown[]> = {};
    for (const [tag, breakdowns] of contextMap) {
      context[tag] = breakdowns.map(b => ({
        contextType: b.contextType,
        computedAt: b.computedAt,
        segments: b.segments,
      }));
    }

    return res.json({ rollups, drifts, context });
  } catch (error) {
    logger.error('Research overview failed', error);
    return res.status(500).json({ error: 'Failed to fetch research data' });
  }
});

router.get('/rollups', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user: AuthPayload }).user;
    const accountId = await getAccountId(user.userId);
    if (!accountId) return res.json([]);

    const rollups = await strategyRollupService.computeAllRollups(accountId);
    return res.json(rollups);
  } catch (error) {
    logger.error('Rollups fetch failed', error);
    return res.status(500).json({ error: 'Failed to fetch rollups' });
  }
});

router.get('/drift', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user: AuthPayload }).user;
    const accountId = await getAccountId(user.userId);
    if (!accountId) return res.json({ drifts: [], detections: [] });

    const [drifts, detections] = await Promise.all([
      driftDetectionEngine.getUnresolvedDrifts(accountId),
      driftDetectionEngine.detectAll(accountId),
    ]);

    return res.json({ drifts, detections });
  } catch (error) {
    logger.error('Drift fetch failed', error);
    return res.status(500).json({ error: 'Failed to fetch drift data' });
  }
});

router.post('/drift/:id/resolve', requireAuth, async (req: Request, res: Response) => {
  try {
    await driftDetectionEngine.resolveDrift(req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    logger.error('Drift resolve failed', error);
    return res.status(500).json({ error: 'Failed to resolve drift' });
  }
});

router.get('/context', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as Request & { user: AuthPayload }).user;
    const accountId = await getAccountId(user.userId);
    if (!accountId) return res.json({});

    const contextMap = await contextPerformanceService.computeAllStrategies(accountId);
    const result: Record<string, unknown[]> = {};
    for (const [tag, breakdowns] of contextMap) {
      result[tag] = breakdowns.map(b => ({
        contextType: b.contextType,
        computedAt: b.computedAt,
        segments: b.segments,
      }));
    }
    return res.json(result);
  } catch (error) {
    logger.error('Context performance fetch failed', error);
    return res.status(500).json({ error: 'Failed to fetch context data' });
  }
});

export default router;
