import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
import { marketIntelSnapshotService } from '../services/market-intel/market-intel-snapshot.service.js';

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

router.get('/latest', requireAuth, async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || 'SPY').toUpperCase();
  const snapshot = await marketIntelSnapshotService.getLatest(symbol);
  res.json(snapshot);
});

export default router;
