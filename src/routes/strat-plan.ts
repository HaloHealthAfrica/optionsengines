/**
 * Strat Plan Lifecycle API Routes
 * Watchlist control, manual plan creation, plan dashboard, plan webhook
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service.js';
import {
  watchlistManager,
  stratPlanLifecycleService,
  getStratPlanConfig,
} from '../services/strat-plan/index.js';
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

function requireStratPlanEnabled(_req: Request, res: Response, next: NextFunction): void {
  if (!config.enableStratPlanLifecycle) {
    res.status(503).json({ error: 'Strat Plan Lifecycle Engine is disabled' });
    return;
  }
  next();
}

// --- Watchlist ---

/** GET /strat-plan/watchlist - Get watchlist status */
router.get(
  '/watchlist',
  requireAuth,
  requireStratPlanEnabled,
  async (_req: Request, res: Response) => {
    const status = await watchlistManager.getStatus();
    const cfg = await getStratPlanConfig();
    return res.json({
      ...status,
      max_tickers: cfg.maxWatchlistTickers,
      at_capacity: status.atCapacity,
      warning: status.atCapacity ? `Watchlist at capacity (${cfg.maxWatchlistTickers}). Remove a ticker to add new ones.` : null,
    });
  }
);

const addWatchlistSchema = z.object({
  symbol: z.string().min(1).max(20),
  priority_score: z.number().int().min(0).optional(),
});

/** POST /strat-plan/watchlist - Add ticker to watchlist */
router.post(
  '/watchlist',
  requireAuth,
  requireStratPlanEnabled,
  async (req: Request, res: Response) => {
    const parse = addWatchlistSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parse.error.errors });
    }
    const { symbol, priority_score = 0 } = parse.data;
    const result = await watchlistManager.add(symbol, 'manual', priority_score);
    if (!result.ok) {
      return res.status(400).json({ error: result.reason, ok: false });
    }
    return res.json({ ok: true, entry: result.entry });
  }
);

/** DELETE /strat-plan/watchlist/:symbol - Remove ticker */
router.delete(
  '/watchlist/:symbol',
  requireAuth,
  requireStratPlanEnabled,
  async (req: Request, res: Response) => {
    const symbol = req.params.symbol?.trim();
    if (!symbol) return res.status(400).json({ error: 'Symbol required' });
    const result = await watchlistManager.remove(symbol);
    if (!result.ok) {
      return res.status(400).json({ error: result.reason, ok: false });
    }
    return res.json({ ok: true });
  }
);

const setPrioritySchema = z.object({ priority_score: z.number().int() });

/** PUT /strat-plan/watchlist/:symbol/priority - Set priority */
router.put(
  '/watchlist/:symbol/priority',
  requireAuth,
  requireStratPlanEnabled,
  async (req: Request, res: Response) => {
    const symbol = req.params.symbol?.trim();
    if (!symbol) return res.status(400).json({ error: 'Symbol required' });
    const parse = setPrioritySchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parse.error.errors });
    }
    const result = await watchlistManager.setPriority(symbol, parse.data.priority_score);
    if (!result.ok) {
      return res.status(400).json({ error: result.reason, ok: false });
    }
    return res.json({ ok: true });
  }
);

// --- Manual Plan Creation ---

const createPlanSchema = z.object({
  symbol: z.string().min(1).max(20),
  direction: z.enum(['long', 'short']),
  timeframe: z.string().min(1).max(20),
  raw_payload: z.record(z.any()).optional(),
});

/** POST /strat-plan/plans - Create plan manually */
router.post(
  '/plans',
  requireAuth,
  requireStratPlanEnabled,
  async (req: Request, res: Response) => {
    const parse = createPlanSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parse.error.errors });
    }
    const result = await stratPlanLifecycleService.createPlan({
      ...parse.data,
      source: 'manual',
    });
    if (!result.ok && !result.plan) {
      return res.status(400).json({ error: result.reason, state: result.state, ok: false });
    }
    return res.json({
      ok: result.ok,
      plan: result.plan,
      state: result.state,
      message: result.reason,
    });
  }
);

// --- Plan Dashboard ---

/** GET /strat-plan/plans - List plans (optionally by symbol) */
router.get(
  '/plans',
  requireAuth,
  requireStratPlanEnabled,
  async (req: Request, res: Response) => {
    const symbol = req.query.symbol as string | undefined;
    if (symbol) {
      const plans = await stratPlanLifecycleService.getPlansBySymbol(symbol);
      return res.json({ plans });
    }
    const status = await stratPlanLifecycleService.getLifecycleStatus();
    return res.json({ lifecycle: status });
  }
);

/** GET /strat-plan/plans/:planId - Get single plan */
router.get(
  '/plans/:planId',
  requireAuth,
  requireStratPlanEnabled,
  async (req: Request, res: Response) => {
    const plan = await stratPlanLifecycleService.getPlanById(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    return res.json({ plan });
  }
);

/** GET /strat-plan/dashboard - Aggregated dashboard for frontend */
router.get(
  '/dashboard',
  requireAuth,
  requireStratPlanEnabled,
  async (_req: Request, res: Response) => {
    const [watchlistStatus, lifecycleStatus, cfg] = await Promise.all([
      watchlistManager.getStatus(),
      stratPlanLifecycleService.getLifecycleStatus(),
      getStratPlanConfig(),
    ]);

    return res.json({
      watchlist: {
        entries: watchlistStatus.entries,
        count: watchlistStatus.count,
        max_tickers: cfg.maxWatchlistTickers,
        at_capacity: watchlistStatus.atCapacity,
      },
      plans: {
        total: lifecycleStatus.totalPlans,
        by_state: lifecycleStatus.byState,
        in_force_count: lifecycleStatus.inForceCount,
        plans_by_ticker: lifecycleStatus.plansByTicker,
        at_capacity: lifecycleStatus.atCapacity,
        max_concurrent: cfg.maxConcurrentPlans,
        max_per_ticker: cfg.maxPlansPerTicker,
        max_in_force: cfg.maxInForceSimultaneous,
      },
      config: {
        max_watchlist_tickers: cfg.maxWatchlistTickers,
        max_concurrent_plans: cfg.maxConcurrentPlans,
        max_plans_per_ticker: cfg.maxPlansPerTicker,
      },
    });
  }
);

// --- Plan Webhook (for external systems) ---

const planWebhookSchema = z.object({
  symbol: z.string().min(1).max(20),
  direction: z.enum(['long', 'short', 'LONG', 'SHORT']),
  timeframe: z.string().min(1).max(20),
  raw_payload: z.record(z.any()).optional(),
}).transform((d) => ({
  ...d,
  direction: (d.direction.toLowerCase() as 'long' | 'short'),
}));

/** POST /strat-plan/webhook - Receive plan from external system */
router.post(
  '/webhook',
  requireStratPlanEnabled,
  async (req: Request, res: Response) => {
    const parse = planWebhookSchema.safeParse(req.body);
    if (!parse.success) {
      logger.warn('Strat plan webhook invalid payload', { errors: parse.error.errors });
      return res.status(400).json({ error: 'Invalid payload', details: parse.error.errors });
    }

    const symbol = parse.data.symbol.toUpperCase().trim();
    const inWatchlist = await watchlistManager.isInWatchlist(symbol);

    if (!inWatchlist) {
      const addResult = await watchlistManager.addFromWebhookIfAllowed(symbol);
      if (!addResult.ok) {
        return res.status(400).json({
          status: 'REJECTED',
          reason: `Symbol ${symbol} not in watchlist. Webhook auto-add disabled or watchlist full.`,
        });
      }
    }

    const result = await stratPlanLifecycleService.createPlan({
      symbol: parse.data.symbol,
      direction: parse.data.direction,
      timeframe: parse.data.timeframe,
      source: 'webhook',
      rawPayload: parse.data.raw_payload,
    });

    if (!result.ok && !result.plan) {
      return res.status(400).json({
        status: 'REJECTED',
        reason: result.reason,
        state: result.state,
      });
    }

    return res.status(200).json({
      status: 'ACCEPTED',
      plan_id: result.plan?.plan_id,
      state: result.state,
      message: result.reason,
    });
  }
);

// --- Config (admin) ---

/** GET /strat-plan/config - Get config (read-only) */
router.get(
  '/config',
  requireAuth,
  requireStratPlanEnabled,
  async (_req: Request, res: Response) => {
    const cfg = await getStratPlanConfig();
    return res.json({ config: cfg });
  }
);

export default router;
