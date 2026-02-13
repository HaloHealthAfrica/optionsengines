// Options API - Chain, intraday OHLC from Unusual Whales
import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
import { unusualWhalesOptionsService } from '../services/unusual-whales-options.service.js';
import { config } from '../config/index.js';

const router = Router();

type AuthPayload = {
  userId: string;
  email: string;
  role: 'admin' | 'researcher' | 'user';
};

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = authService.extractTokenFromHeader(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = authService.verifyToken(token) as AuthPayload | null;
  if (!payload) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  (req as Request & { user?: AuthPayload }).user = payload;
  next();
}

/**
 * GET /api/options/chain/:ticker
 * Returns option chain summary (expiries, strikes, contracts with prices) from Unusual Whales.
 */
router.get('/chain/:ticker', requireAuth, async (req: Request, res: Response) => {
  if (!config.unusualWhalesOptionsEnabled || !config.unusualWhalesApiKey) {
    return res.status(503).json({
      error: 'Unusual Whales options not configured',
      message: 'Set UNUSUAL_WHALES_API_KEY and UNUSUAL_WHALES_OPTIONS_ENABLED=true',
    });
  }

  const ticker = String(req.params.ticker || '').toUpperCase();
  if (!ticker) {
    return res.status(400).json({ error: 'Ticker required' });
  }

  try {
    const chain = await unusualWhalesOptionsService.getOptionChain(ticker);
    return res.json({ data: chain });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to fetch option chain', message });
  }
});

/**
 * GET /api/options/contract/:id/intraday?date=YYYY-MM-DD
 * Returns intraday OHLC and premium for an option contract.
 */
router.get('/contract/:id/intraday', requireAuth, async (req: Request, res: Response) => {
  if (!config.unusualWhalesOptionsEnabled || !config.unusualWhalesApiKey) {
    return res.status(503).json({
      error: 'Unusual Whales options not configured',
      message: 'Set UNUSUAL_WHALES_API_KEY and UNUSUAL_WHALES_OPTIONS_ENABLED=true',
    });
  }

  const contractId = String(req.params.id || '');
  const dateParam = String(req.query.date || '');
  const date = dateParam || new Date().toISOString().slice(0, 10);

  if (!contractId) {
    return res.status(400).json({ error: 'Contract ID required' });
  }

  try {
    const ticks = await unusualWhalesOptionsService.getOptionOHLC(contractId, date);
    return res.json({ data: ticks, contractId, date });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to fetch intraday data', message });
  }
});

export default router;
