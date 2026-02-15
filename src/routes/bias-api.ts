/**
 * Bias State API - Monitoring endpoints for Bias State Aggregator.
 * GET /api/bias/state, /history, /summary
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
import {
  getCurrentState,
  getHistory,
} from '../services/bias-state-aggregator/bias-state-aggregator.service.js';
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

/** GET /api/bias/state?symbol=SPY - Current unified state for symbol */
router.get('/state', requireAuth, async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || 'SPY').toUpperCase();
  try {
    const state = await getCurrentState(symbol);
    if (!state) {
      return res.status(404).json({
        symbol,
        error: 'No bias state found',
        hint: 'V3 webhooks may not have been received yet',
      });
    }
    return res.json({ symbol, state });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch bias state' });
  }
});

/** GET /api/bias/history?symbol=SPY&limit=50 - History for symbol */
router.get('/history', requireAuth, async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || 'SPY').toUpperCase();
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
  try {
    const history = await getHistory(symbol, limit);
    return res.json({ symbol, history, count: history.length });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch bias history' });
  }
});

/** GET /api/bias/summary - All tracked symbols with key fields */
router.get('/summary', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await db.query(
      `SELECT symbol, updated_at_ms, source, state_json->>'bias' as bias,
              (state_json->'effective'->>'effectiveBiasScore')::int as effective_bias_score,
              (state_json->'effective'->>'effectiveConfidence')::float as effective_confidence,
              (state_json->'effective'->>'tradeSuppressed')::boolean as trade_suppressed,
              state_json->>'macroClass' as macro_class,
              state_json->>'intentType' as intent_type,
              state_json->>'regimeType' as regime_type,
              (state_json->>'isStale')::boolean as is_stale
       FROM bias_state_current
       ORDER BY updated_at_ms DESC`
    );
    const summary = result.rows.map((row) => ({
      symbol: row.symbol,
      updatedAtMs: Number(row.updated_at_ms),
      source: row.source,
      bias: row.bias,
      effectiveBiasScore: row.effective_bias_score,
      effectiveConfidence: row.effective_confidence,
      tradeSuppressed: row.trade_suppressed,
      macroClass: row.macro_class,
      intentType: row.intent_type,
      regimeType: row.regime_type,
      isStale: row.is_stale,
    }));
    return res.json({ symbols: summary });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch bias summary' });
  }
});

export default router;
