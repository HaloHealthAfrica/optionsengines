/**
 * Strat Plan Lifecycle API Routes
 * Watchlist control, manual plan creation, plan dashboard, plan webhook
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service.js';
import { db } from '../services/database.service.js';
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
  entry: z.number().positive().optional(),
  target: z.number().positive().optional(),
  stop: z.number().positive().optional(),
  reversalLevel: z.number().positive().optional(),
  setup: z.string().max(50).optional(),
  sourceAlertId: z.string().uuid().optional(),
  executionMode: z.enum(['manual', 'auto_on_trigger']).optional(),
  triggerCondition: z.string().max(500).optional(),
  fromAlert: z.boolean().optional(),
});

/** POST /strat-plan/plans/batch - Create plans for all pending alerts (auto-on-trigger) */
router.post(
  '/plans/batch',
  requireAuth,
  requireStratPlanEnabled,
  async (_req: Request, res: Response) => {
    try {
      const alertsResult = await db.query(
        `SELECT a.alert_id, a.symbol, a.direction, a.timeframe, a.entry, a.target, a.stop,
                a.reversal_level, a.setup
         FROM strat_alerts a
         WHERE a.status IN ('pending', 'watching')
           AND NOT EXISTS (
             SELECT 1 FROM strat_plans p
             WHERE p.source_alert_id = a.alert_id
               AND p.plan_status IN ('draft', 'armed', 'triggered', 'executing')
           )
         ORDER BY a.created_at DESC
         LIMIT 20`
      );
      const alerts = alertsResult.rows;
      const created = [];
      const failed = [];
      for (const row of alerts) {
        const result = await stratPlanLifecycleService.createPlan({
          symbol: row.symbol,
          direction: row.direction,
          timeframe: row.timeframe === 'D' ? '1d' : row.timeframe === 'W' ? '1w' : row.timeframe === 'M' ? '1month' : '4h',
          source: 'manual',
          entry: Number(row.entry),
          target: Number(row.target),
          stop: Number(row.stop),
          reversalLevel: row.reversal_level != null ? Number(row.reversal_level) : undefined,
          setup: row.setup,
          sourceAlertId: row.alert_id,
          executionMode: 'auto_on_trigger',
          triggerCondition:
            row.direction === 'long'
              ? `price >= ${Number(row.reversal_level ?? row.entry)}`
              : `price <= ${Number(row.reversal_level ?? row.entry)}`,
          fromAlert: true,
          rawPayload: {
            entry: Number(row.entry),
            target: Number(row.target),
            stop: Number(row.stop),
          },
        });
        if (result.ok && result.plan) {
          created.push({ alertId: row.alert_id, symbol: row.symbol, planId: result.plan.plan_id });
        } else {
          failed.push({ alertId: row.alert_id, symbol: row.symbol, reason: result.reason });
        }
      }
      return res.json({
        ok: true,
        created: created.length,
        failed: failed.length,
        plans: created,
        errors: failed,
      });
    } catch (err) {
      logger.error('Batch create plans failed', { error: err });
      return res.status(500).json({ error: 'Batch create failed' });
    }
  }
);

/** POST /strat-plan/plans - Create plan manually or from alert */
router.post(
  '/plans',
  requireAuth,
  requireStratPlanEnabled,
  async (req: Request, res: Response) => {
    const parse = createPlanSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parse.error.errors });
    }
    const d = parse.data;
    const rawPayload = d.raw_payload ?? {};
    if (d.entry != null) rawPayload.entry = d.entry;
    if (d.target != null) rawPayload.target = d.target;
    if (d.stop != null) rawPayload.stop = d.stop;
    const result = await stratPlanLifecycleService.createPlan({
      symbol: d.symbol,
      direction: d.direction,
      timeframe: d.timeframe,
      source: 'manual',
      rawPayload: Object.keys(rawPayload).length ? rawPayload : undefined,
      entry: d.entry,
      target: d.target,
      stop: d.stop,
      reversalLevel: d.reversalLevel,
      setup: d.setup,
      sourceAlertId: d.sourceAlertId,
      executionMode: d.executionMode,
      triggerCondition: d.triggerCondition,
      fromAlert: d.fromAlert,
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

/** GET /strat-plan/plans - List plans (by symbol, tab, or lifecycle status) */
router.get(
  '/plans',
  requireAuth,
  requireStratPlanEnabled,
  async (req: Request, res: Response) => {
    const symbol = req.query.symbol as string | undefined;
    const tab = (req.query.tab as string) || '';

    if (symbol && !tab) {
      const plans = await stratPlanLifecycleService.getPlansBySymbol(symbol);
      return res.json({ plans });
    }

    if (['active', 'triggered', 'history'].includes(tab)) {
      try {
        const statusFilter =
          tab === 'active'
            ? ['draft', 'armed']
            : tab === 'triggered'
              ? ['triggered', 'executing']
              : ['filled', 'expired', 'cancelled', 'rejected'];
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
        plan_id: row.plan_id,
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
        rr: row.raw_payload?.rr ?? null,
        options: row.raw_payload?.options ?? row.raw_payload?.optionsPlay ?? null,
        notes: row.raw_payload?.notes ?? null,
      }));
        return res.json({ plans });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === '42P01' || code === '42703') return res.json({ plans: [] });
        throw err;
      }
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

/** PATCH /strat-plan/plans/:planId - Update plan (e.g. cancel) */
router.patch(
  '/plans/:planId',
  requireAuth,
  requireStratPlanEnabled,
  async (req: Request, res: Response) => {
    const planId = req.params.planId?.trim();
    if (!planId) return res.status(400).json({ error: 'Plan ID required' });
    const body = req.body as { status?: string };
    if (body?.status === 'cancelled') {
      const ok = await stratPlanLifecycleService.markCancelled(planId);
      if (!ok) return res.status(404).json({ error: 'Plan not found or cannot be cancelled' });
      return res.json({ ok: true, status: 'cancelled' });
    }
    return res.status(400).json({ error: 'Unsupported update' });
  }
);

/** DELETE /strat-plan/plans/:planId - Cancel/remove plan */
router.delete(
  '/plans/:planId',
  requireAuth,
  requireStratPlanEnabled,
  async (req: Request, res: Response) => {
    const planId = req.params.planId?.trim();
    if (!planId) return res.status(400).json({ error: 'Plan ID required' });
    const ok = await stratPlanLifecycleService.markCancelled(planId);
    if (!ok) return res.status(404).json({ error: 'Plan not found or cannot be removed' });
    return res.json({ ok: true });
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
