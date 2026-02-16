/**
 * Strat Command Center API
 * /api/strat/alerts, /api/strat/plans, /api/strat/watchlist
 *
 * Full lifecycle: Scanner → Alerts → Plans → Trigger → Signal → Execution
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
import { db } from '../services/database.service.js';
import { watchlistManager, getStratPlanConfig } from '../services/strat-plan/index.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

type AuthPayload = { userId: string; email: string; role: string };

function requireAuth(req: Request, res: Response, next: NextFunction): Response | void {
  const token = authService.extractTokenFromHeader(req.headers.authorization);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const payload = authService.verifyToken(token) as AuthPayload | null;
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });
  (req as Request & { user?: AuthPayload }).user = payload;
  return next();
}

function requireStratEnabled(_req: Request, res: Response, next: NextFunction): void {
  if (!config.enableStratPlanLifecycle) {
    res.status(503).json({ error: 'Strat Command Center disabled' });
    return;
  }
  next();
}

/** GET /strat/alerts - List strat alerts (from strat_alerts table or empty) */
router.get(
  '/alerts',
  requireAuth,
  requireStratEnabled,
  async (req: Request, res: Response) => {
    try {
      const status = (req.query.status as string) || 'all';
      const symbol = (req.query.symbol as string) || '';
      const limit = Math.min(100, parseInt(String(req.query.limit || 50), 10) || 50);

      const result = await db.query(
        `SELECT alert_id, symbol, direction, timeframe, setup, entry, target, stop,
                reversal_level, score, c1_type, c2_type, c1_shape, atr, rvol,
                flow_sentiment, unusual_activity, status, source, options_suggestion,
                condition_text, created_at, triggered_at
         FROM strat_alerts
         WHERE ($1::text = 'all' OR status = $1)
           AND ($2::text = '' OR symbol ILIKE '%' || $2 || '%')
         ORDER BY created_at DESC
         LIMIT $3`,
        [status, symbol, limit]
      );

      const alerts = result.rows.map((row) => ({
        id: row.alert_id,
        symbol: row.symbol,
        direction: row.direction,
        timeframe: row.timeframe,
        setup: row.setup,
        entry: Number(row.entry),
        target: Number(row.target),
        stop: Number(row.stop),
        reversalLevel: row.reversal_level != null ? Number(row.reversal_level) : null,
        score: Number(row.score),
        c1Type: row.c1_type,
        c2Type: row.c2_type,
        c1Shape: row.c1_shape,
        atr: row.atr != null ? Number(row.atr) : null,
        rvol: row.rvol,
        flowSentiment: row.flow_sentiment,
        unusualActivity: row.unusual_activity,
        status: row.status,
        source: row.source,
        optionsSuggestion: row.options_suggestion,
        conditionText: row.condition_text,
        createdAt: row.created_at,
        triggeredAt: row.triggered_at,
      }));

      return res.json({ alerts });
    } catch (err) {
      if ((err as { code?: string }).code === '42P01') {
        return res.json({ alerts: [] });
      }
      logger.error('Strat alerts fetch failed', { error: err });
      return res.status(500).json({ error: 'Failed to fetch alerts' });
    }
  }
);

/** GET /strat/plans - List plans with full state machine */
router.get(
  '/plans',
  requireAuth,
  requireStratEnabled,
  async (req: Request, res: Response) => {
    const tab = (req.query.tab as string) || 'active';
    const statusFilter =
      tab === 'active'
        ? ['draft', 'armed']
        : tab === 'triggered'
          ? ['triggered', 'executing']
          : ['filled', 'expired', 'cancelled', 'rejected'];

    try {
      const result = await db.query(
        `SELECT plan_id, symbol, direction, timeframe,
                COALESCE(setup, raw_payload->>'setupType') AS setup,
                source_alert_id, entry_price, target_price, stop_price, reversal_level,
                COALESCE(execution_mode, 'manual') AS execution_mode,
                trigger_condition,
                COALESCE(plan_status, 'draft') AS plan_status,
                signal_id, position_id, created_at, triggered_at, filled_at, raw_payload
         FROM strat_plans
         WHERE COALESCE(plan_status, 'draft') = ANY($1::text[])
         ORDER BY created_at DESC
         LIMIT 50`,
        [statusFilter]
      );

      const plans = result.rows.map((row) => ({
        id: row.plan_id,
        symbol: row.symbol,
        direction: row.direction,
        timeframe: row.timeframe,
        setup: row.setup,
        entry: row.entry_price != null ? Number(row.entry_price) : null,
        target: row.target_price != null ? Number(row.target_price) : null,
        stop: row.stop_price != null ? Number(row.stop_price) : null,
        reversalLevel: row.reversal_level != null ? Number(row.reversal_level) : null,
        executionMode: row.execution_mode || 'manual',
        triggerCondition: row.trigger_condition,
        status: row.plan_status || 'draft',
        signalId: row.signal_id,
        positionId: row.position_id,
        createdAt: row.created_at,
        triggeredAt: row.triggered_at,
        filledAt: row.filled_at,
        rawPayload: row.raw_payload,
      }));

      return res.json({ plans });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '42P01' || code === '42703') {
        return res.json({ plans: [] });
      }
      logger.error('Strat plans fetch failed', { error: err });
      return res.status(500).json({ error: 'Failed to fetch plans' });
    }
  }
);

/** GET /strat/watchlist - Alias for strat-plan watchlist */
router.get(
  '/watchlist',
  requireAuth,
  requireStratEnabled,
  async (_req: Request, res: Response) => {
    const status = await watchlistManager.getStatus();
    const cfg = await getStratPlanConfig();
    return res.json({
      ...status,
      max_tickers: cfg.maxWatchlistTickers,
    });
  }
);

export default router;
