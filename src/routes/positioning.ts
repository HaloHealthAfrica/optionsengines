import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
import { positioningService } from '../services/positioning.service.js';

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

router.get('/gex', requireAuth, async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || 'SPY').toUpperCase();
  const data = await positioningService.getGexSnapshot(symbol);
  res.json({ data });
});

router.get('/options-flow', requireAuth, async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || 'SPY').toUpperCase();
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const data = await positioningService.getOptionsFlowSnapshot(
    symbol,
    Number.isFinite(limit) ? limit : 50
  );
  res.json({ data });
});

router.get('/max-pain', requireAuth, async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || 'SPY').toUpperCase();
  const data = await positioningService.getMaxPain(symbol);
  res.json({ data });
});

router.get('/signal-correlation', requireAuth, async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || 'SPY').toUpperCase();
  const data = await positioningService.getSignalCorrelation(symbol);
  res.json({ data });
});

export default router;
