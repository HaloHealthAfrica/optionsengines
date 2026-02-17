/**
 * Strat Command Center API
 * /api/strat/alerts, /api/strat/plans, /api/strat/watchlist
 *
 * Full lifecycle: Scanner → Alerts → Plans → Trigger → Signal → Execution
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service.js';
import { db } from '../services/database.service.js';
import { watchlistManager, getStratPlanConfig } from '../services/strat-plan/index.js';
import { stratScannerService } from '../services/strat-scanner/index.js';
import {
  stratAnalyticsService,
  generateInsights,
  saveInsights,
  getCachedInsights,
  tuneWeights,
} from '../services/strat-analytics/index.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import {
  publishStratAlertNew,
  publishStratScanComplete,
} from '../services/realtime-updates.service.js';

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

const createAlertSchema = z.object({
  symbol: z.string().min(1).max(20),
  direction: z.enum(['long', 'short']),
  timeframe: z.enum(['4H', 'D', 'W', 'M']),
  setup: z.string().min(1).max(50),
  entry: z.number().positive(),
  target: z.number().positive(),
  stop: z.number().positive(),
  reversalLevel: z.number().positive().optional(),
  score: z.number().int().min(0).max(100).default(75),
  c1Type: z.string().max(50).optional(),
  c2Type: z.string().max(50).optional(),
  c1Shape: z.string().max(50).optional(),
  atr: z.number().positive().optional(),
  rvol: z.union([z.string(), z.number()]).optional(),
  status: z.enum(['watching', 'pending', 'triggered', 'expired', 'invalidated']).optional(),
  optionsSuggestion: z.string().max(200).optional(),
  conditionText: z.string().max(500).optional(),
});

/** DELETE /strat/alerts/:id - Delete an alert (invalidated, expired, or any) */
router.delete(
  '/alerts/:id',
  requireAuth,
  requireStratEnabled,
  async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      if (!id) return res.status(400).json({ error: 'Alert ID required' });
      const result = await db.query(
        `DELETE FROM strat_alerts WHERE alert_id = $1 RETURNING alert_id`,
        [id]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Alert not found' });
      }
      return res.json({ ok: true, deleted: id });
    } catch (err) {
      logger.error('Strat alert delete failed', { error: err });
      return res.status(500).json({ error: 'Failed to delete alert' });
    }
  }
);

/** POST /strat/alerts/cleanup - Delete all invalidated and expired alerts */
router.post(
  '/alerts/cleanup',
  requireAuth,
  requireStratEnabled,
  async (_req: Request, res: Response) => {
    try {
      const result = await db.query(
        `DELETE FROM strat_alerts
         WHERE status IN ('invalidated', 'expired')
         RETURNING alert_id`
      );
      return res.json({
        ok: true,
        deleted: result.rowCount ?? 0,
      });
    } catch (err) {
      logger.error('Strat alerts cleanup failed', { error: err });
      return res.status(500).json({ error: 'Failed to cleanup alerts' });
    }
  }
);

/** POST /strat/alerts - Create strat alert (manual ingestion) */
router.post(
  '/alerts',
  requireAuth,
  requireStratEnabled,
  async (req: Request, res: Response) => {
    try {
      const parse = createAlertSchema.safeParse(req.body);
      if (!parse.success) {
        return res.status(400).json({ error: 'Invalid payload', details: parse.error.errors });
      }
      const d = parse.data;
      const result = await db.query(
        `INSERT INTO strat_alerts (
          symbol, direction, timeframe, setup, entry, target, stop,
          reversal_level, score, c1_type, c2_type, c1_shape, atr, rvol,
          status, source, options_suggestion, condition_text
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING alert_id, symbol, direction, timeframe, setup, entry, target, stop,
          reversal_level, score, c1_type, c2_type, c1_shape, atr, rvol,
          status, source, options_suggestion, condition_text, created_at`,
        [
          d.symbol.toUpperCase(),
          d.direction,
          d.timeframe,
          d.setup,
          d.entry,
          d.target,
          d.stop,
          d.reversalLevel ?? null,
          d.score,
          d.c1Type ?? null,
          d.c2Type ?? null,
          d.c1Shape ?? null,
          d.atr ?? null,
          d.rvol != null ? String(d.rvol) : null,
          d.status ?? 'watching',
          'manual',
          d.optionsSuggestion ?? null,
          d.conditionText ?? null,
        ]
      );
      const row = result.rows[0];
      const alert = {
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
        status: row.status,
        source: row.source,
        createdAt: row.created_at,
      };
      publishStratAlertNew(alert);
      return res.status(201).json({ alert });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '42P01') {
        return res.status(503).json({ error: 'Strat alerts table not available' });
      }
      logger.error('Strat alert create failed', { error: err });
      return res.status(500).json({ error: 'Failed to create alert' });
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

const scanBodySchema = z.object({
  symbols: z.array(z.string()).optional(),
  timeframes: z.array(z.enum(['4H', 'D', 'W', 'M'])).optional(),
});

/** POST /strat/scan - Run strat scanner (on-demand) */
router.post(
  '/scan',
  requireAuth,
  requireStratEnabled,
  async (req: Request, res: Response) => {
    try {
      const parse = scanBodySchema.safeParse(req.body ?? {});
      const options = parse.success ? parse.data : {};
      const alerts = await stratScannerService.run(options);
      const scannedAt = new Date().toISOString();
      publishStratScanComplete({ count: alerts.length, scannedAt });
      return res.json({ alerts, scannedAt });
    } catch (err) {
      logger.error('Strat scan failed', { error: err });
      return res.status(500).json({ error: 'Scan failed' });
    }
  }
);

// --- Strat Analytics (Feedback Loop) ---
function parseDateRange(req: Request): { from: Date; to: Date } | undefined {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  if (from && to) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (!isNaN(fromDate.getTime()) && !isNaN(toDate.getTime())) {
      return { from: fromDate, to: toDate };
    }
  }
  return undefined;
}

/** GET /strat/analytics/overview - Overall stats */
router.get(
  '/analytics/overview',
  requireAuth,
  requireStratEnabled,
  async (req: Request, res: Response) => {
    try {
      const stats = await stratAnalyticsService.getOverallStats(parseDateRange(req));
      return res.json(stats);
    } catch (err) {
      if ((err as { code?: string }).code === '42P01') {
        return res.json({ totalAlerts: 0, triggeredCount: 0, triggerRate: 0, winRate: 0, avgRR: 0, profitFactor: 0, expectancy: 0 });
      }
      logger.error('Strat analytics overview failed', { error: err });
      return res.status(500).json({ error: 'Analytics failed' });
    }
  }
);

/** GET /strat/analytics/patterns - Win rate by pattern */
router.get(
  '/analytics/patterns',
  requireAuth,
  requireStratEnabled,
  async (_req: Request, res: Response) => {
    try {
      const data = await stratAnalyticsService.getPatternPerformance();
      return res.json({ patterns: data });
    } catch (err) {
      if ((err as { code?: string }).code === '42P01') return res.json({ patterns: [] });
      logger.error('Strat analytics patterns failed', { error: err });
      return res.status(500).json({ error: 'Analytics failed' });
    }
  }
);

/** GET /strat/analytics/timeframes - Win rate by timeframe */
router.get(
  '/analytics/timeframes',
  requireAuth,
  requireStratEnabled,
  async (_req: Request, res: Response) => {
    try {
      const data = await stratAnalyticsService.getTimeframePerformance();
      return res.json({ timeframes: data });
    } catch (err) {
      if ((err as { code?: string }).code === '42P01') return res.json({ timeframes: [] });
      logger.error('Strat analytics timeframes failed', { error: err });
      return res.status(500).json({ error: 'Analytics failed' });
    }
  }
);

/** GET /strat/analytics/symbols - Win rate by symbol */
router.get(
  '/analytics/symbols',
  requireAuth,
  requireStratEnabled,
  async (_req: Request, res: Response) => {
    try {
      const data = await stratAnalyticsService.getSymbolPerformance();
      return res.json({ symbols: data });
    } catch (err) {
      if ((err as { code?: string }).code === '42P01') return res.json({ symbols: [] });
      logger.error('Strat analytics symbols failed', { error: err });
      return res.status(500).json({ error: 'Analytics failed' });
    }
  }
);

/** GET /strat/analytics/score-calibration - Score calibration */
router.get(
  '/analytics/score-calibration',
  requireAuth,
  requireStratEnabled,
  async (_req: Request, res: Response) => {
    try {
      const data = await stratAnalyticsService.getScoreCalibration();
      return res.json({ calibration: data });
    } catch (err) {
      if ((err as { code?: string }).code === '42P01') return res.json({ calibration: [] });
      logger.error('Strat analytics score-calibration failed', { error: err });
      return res.status(500).json({ error: 'Analytics failed' });
    }
  }
);

/** GET /strat/analytics/market-regimes - Performance by market regime */
router.get(
  '/analytics/market-regimes',
  requireAuth,
  requireStratEnabled,
  async (_req: Request, res: Response) => {
    try {
      const data = await stratAnalyticsService.getMarketRegimePerformance();
      return res.json({ regimes: data });
    } catch (err) {
      if ((err as { code?: string }).code === '42P01') return res.json({ regimes: [] });
      logger.error('Strat analytics market-regimes failed', { error: err });
      return res.status(500).json({ error: 'Analytics failed' });
    }
  }
);

/** GET /strat/analytics/flow-alignment - Flow alignment impact */
router.get(
  '/analytics/flow-alignment',
  requireAuth,
  requireStratEnabled,
  async (_req: Request, res: Response) => {
    try {
      const data = await stratAnalyticsService.getFlowAlignmentPerformance();
      return res.json(data);
    } catch (err) {
      if ((err as { code?: string }).code === '42P01') {
        return res.json({ alignedWinRate: 0, opposingWinRate: 0, flowAlignmentEdge: 0, isFlowUseful: false, sampleSizes: { aligned: 0, opposing: 0, neutral: 0 } });
      }
      logger.error('Strat analytics flow-alignment failed', { error: err });
      return res.status(500).json({ error: 'Analytics failed' });
    }
  }
);

/** GET /strat/analytics/confluence - TF confluence impact */
router.get(
  '/analytics/confluence',
  requireAuth,
  requireStratEnabled,
  async (_req: Request, res: Response) => {
    try {
      const data = await stratAnalyticsService.getConfluencePerformance();
      return res.json({ confluence: data });
    } catch (err) {
      if ((err as { code?: string }).code === '42P01') return res.json({ confluence: [] });
      logger.error('Strat analytics confluence failed', { error: err });
      return res.status(500).json({ error: 'Analytics failed' });
    }
  }
);

/** GET /strat/analytics/candle-shapes - Candle shape performance */
router.get(
  '/analytics/candle-shapes',
  requireAuth,
  requireStratEnabled,
  async (_req: Request, res: Response) => {
    try {
      const data = await stratAnalyticsService.getCandleShapePerformance();
      return res.json({ candleShapes: data });
    } catch (err) {
      if ((err as { code?: string }).code === '42P01') return res.json({ candleShapes: [] });
      logger.error('Strat analytics candle-shapes failed', { error: err });
      return res.status(500).json({ error: 'Analytics failed' });
    }
  }
);

/** GET /strat/analytics/alert-context - Historical stats for a specific pattern+symbol+timeframe+score */
router.get(
  '/analytics/alert-context',
  requireAuth,
  requireStratEnabled,
  async (req: Request, res: Response) => {
    try {
      const pattern = req.query.pattern as string;
      const symbol = req.query.symbol as string;
      const timeframe = req.query.timeframe as string;
      const score = parseInt(String(req.query.score || '0'), 10);
      if (!pattern || !symbol || !timeframe) {
        return res.json({ patternStats: null, symbolStats: null, scoreCalibration: null });
      }
      const [patterns, symbols, calibration, flow] = await Promise.all([
        stratAnalyticsService.getPatternPerformance(),
        stratAnalyticsService.getSymbolPerformance(),
        stratAnalyticsService.getScoreCalibration(),
        stratAnalyticsService.getFlowAlignmentPerformance(),
      ]);
      const patternStats = patterns.find((p) => p.pattern === pattern) ?? null;
      const symbolStats = symbols.find((s) => s.symbol === symbol) ?? null;
      const scoreRange = calibration.find((c) => {
        const parts = c.range.split('-').map((p) => parseInt(p, 10));
        const min = parts[0] ?? 0;
        const max = parts[1] ?? 100;
        return score >= min && score < max;
      }) ?? null;
      return res.json({
        patternStats,
        symbolStats,
        scoreCalibration: scoreRange,
        flowEdge: flow.flowAlignmentEdge,
      });
    } catch (err) {
      if ((err as { code?: string }).code === '42P01') return res.json({ patternStats: null, symbolStats: null, scoreCalibration: null });
      logger.error('Strat alert context failed', { error: err });
      return res.status(500).json({ error: 'Failed to fetch context' });
    }
  }
);

/** GET /strat/analytics/pattern-timeframe - Heatmap data (pattern × timeframe) */
router.get(
  '/analytics/pattern-timeframe',
  requireAuth,
  requireStratEnabled,
  async (_req: Request, res: Response) => {
    try {
      const data = await stratAnalyticsService.getPatternTimeframeMatrix();
      return res.json({ matrix: data });
    } catch (err) {
      if ((err as { code?: string }).code === '42P01') return res.json({ matrix: [] });
      logger.error('Strat analytics pattern-timeframe failed', { error: err });
      return res.status(500).json({ error: 'Analytics failed' });
    }
  }
);

/** GET /strat/analytics/time-of-day - Time of day performance */
router.get(
  '/analytics/time-of-day',
  requireAuth,
  requireStratEnabled,
  async (_req: Request, res: Response) => {
    try {
      const data = await stratAnalyticsService.getTimeOfDayPerformance();
      return res.json({ sessions: data });
    } catch (err) {
      if ((err as { code?: string }).code === '42P01') return res.json({ sessions: [] });
      logger.error('Strat analytics time-of-day failed', { error: err });
      return res.status(500).json({ error: 'Analytics failed' });
    }
  }
);

/** GET /strat/analytics/insights - Cached or generated insights */
router.get(
  '/analytics/insights',
  requireAuth,
  requireStratEnabled,
  async (req: Request, res: Response) => {
    try {
      const refresh = req.query.refresh === 'true';
      const limit = Math.min(50, parseInt(String(req.query.limit || 20), 10) || 20);
      if (refresh) {
        const insights = await generateInsights();
        await saveInsights(insights);
        return res.json({ insights });
      }
      const insights = await getCachedInsights(limit);
      if (insights.length === 0) {
        const generated = await generateInsights();
        await saveInsights(generated);
        return res.json({ insights: generated });
      }
      return res.json({ insights });
    } catch (err) {
      if ((err as { code?: string }).code === '42P01') return res.json({ insights: [] });
      logger.error('Strat analytics insights failed', { error: err });
      return res.status(500).json({ error: 'Analytics failed' });
    }
  }
);

/** GET /strat/analytics/tuning-history - Last tuning runs */
router.get(
  '/analytics/tuning-history',
  requireAuth,
  requireStratEnabled,
  async (_req: Request, res: Response) => {
    try {
      const result = await db.query(
        `SELECT id, previous_weights, new_weights, sample_size, tuned_at
         FROM scoring_weight_history
         ORDER BY tuned_at DESC
         LIMIT 10`
      );
      return res.json({
        history: result.rows.map((r) => ({
          id: r.id,
          previousWeights: r.previous_weights,
          newWeights: r.new_weights,
          sampleSize: r.sample_size,
          tunedAt: r.tuned_at,
        })),
      });
    } catch (err) {
      if ((err as { code?: string }).code === '42P01') return res.json({ history: [] });
      logger.error('Strat tuning history failed', { error: err });
      return res.status(500).json({ error: 'Failed to fetch tuning history' });
    }
  }
);

/** POST /strat/analytics/tune - Run scoring weight tuner */
router.post(
  '/analytics/tune',
  requireAuth,
  requireStratEnabled,
  async (_req: Request, res: Response) => {
    try {
      const result = await tuneWeights();
      return res.json(result);
    } catch (err) {
      logger.error('Strat scoring tune failed', { error: err });
      return res.status(500).json({ error: 'Tuning failed' });
    }
  }
);

export default router;
