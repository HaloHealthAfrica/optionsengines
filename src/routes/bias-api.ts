/**
 * Bias State API - Monitoring endpoints for Bias State Aggregator.
 * GET /api/bias/state, /history, /summary
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
import { PORTFOLIO_GUARDRAILS } from '../lib/shared/constants.js';
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

/** GET /api/bias/adaptive-status - Adaptive tuner status for UI */
router.get('/adaptive-status', requireAuth, async (_req: Request, res: Response) => {
  try {
    const { getRollingStats } = await import(
      '../services/performance-feedback/performance-analyzer.service.js'
    );
    const { getLastAdaptiveRunDate } = await import(
      '../services/performance-feedback/adaptive-tuner.service.js'
    );
    const { getAdaptiveMeta } = await import(
      '../services/performance-feedback/adaptive-status.service.js'
    );

    const [stats, meta] = await Promise.all([getRollingStats(), getAdaptiveMeta()]);
    const highAccelR = stats.avgRByAccelerationBucket['high'] ?? 0;

    return res.json({
      lastAdaptiveUpdate: getLastAdaptiveRunDate(),
      rollingWinRate: stats.winRate,
      rollingAvgR: stats.avgR,
      breakoutInRangeWinRate: stats.breakoutWinRateInRange,
      macroDriftExitAvgR: stats.macroDriftExitAvgR,
      accelerationTradeAvgR: highAccelR,
      adaptiveEnabled: meta.enabled,
      lastRunSummary: meta.lastRunSummary ?? {
        tunerUpdated: false,
        parametersChanged: [],
      },
      manualRunAvailable: process.env.NODE_ENV !== 'production',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch adaptive status' });
  }
});

/** GET /api/bias/adaptive-history - Last 30 parameter changes */
router.get('/adaptive-history', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await db.query(
      `SELECT id, config_key, parameter_name, previous_value, new_value, reason, rolling_metrics, created_at
       FROM bias_adaptive_config_history
       ORDER BY created_at DESC
       LIMIT 30`
    );
    const rows = result.rows.map((r) => ({
      date: r.created_at,
      parameter: r.parameter_name,
      oldValue: r.previous_value,
      newValue: r.new_value,
      reason: r.reason,
      rollingStats: r.rolling_metrics,
    }));
    return res.json({ history: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch adaptive history' });
  }
});

/** POST /api/bias/adaptive-toggle - Enable/disable adaptive tuning */
router.post('/adaptive-toggle', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = req.body as { enabled?: boolean };
    const enabled = body.enabled === true;
    const { setAdaptiveEnabled } = await import(
      '../services/performance-feedback/adaptive-status.service.js'
    );
    await setAdaptiveEnabled(enabled);
    return res.json({ enabled });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update adaptive toggle' });
  }
});

/** POST /api/bias/run-adaptive - Manual run (admin only, non-production) */
router.post('/run-adaptive', requireAuth, async (req: Request, res: Response) => {
  const user = (req as Request & { user?: AuthPayload }).user;
  if (user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Manual run disabled in production' });
  }
  try {
    const { runAdaptiveTuning } = await import(
      '../services/performance-feedback/adaptive-tuner.service.js'
    );
    const result = await runAdaptiveTuning({ forceRun: true });
    return res.json({
      updated: result.updated,
      changes: result.changes,
      stats: result.stats,
      dryRun: result.dryRun,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to run adaptive tuner' });
  }
});

/** GET /api/bias/adaptive-params - Current risk + adaptive params for display */
router.get('/adaptive-params', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await db.query(
      `SELECT config_key, config_json FROM bias_config WHERE config_key IN ('risk', 'adaptive')`
    );
    const params: Record<string, unknown> = {};
    for (const row of result.rows) {
      const cfg = row.config_json as Record<string, unknown>;
      if (row.config_key === 'risk') {
        params.rangeBreakoutMultiplier = cfg.rangeBreakoutMultiplier;
        params.stateStrengthUpMultiplier = cfg.stateStrengthUpMultiplier;
        params.latePhaseNegativeMultiplier = cfg.latePhaseNegativeMultiplier;
      } else {
        params.macroDriftThreshold = cfg.macroDriftThreshold ?? 0.18;
      }
    }
    return res.json(params);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch adaptive params' });
  }
});

/** GET /api/bias/summary - All tracked symbols with key fields + rolling metrics */
router.get('/summary', requireAuth, async (_req: Request, res: Response) => {
  try {
    let rollingWinRate = 0;
    let rollingAvgR = 0;
    let adaptiveModifiers: Record<string, unknown> = {};
    let lastAdaptiveUpdate: string | null = null;

    try {
      const { getRollingStats } = await import(
        '../services/performance-feedback/performance-analyzer.service.js'
      );
      const { getLastAdaptiveRunDate } = await import(
        '../services/performance-feedback/adaptive-tuner.service.js'
      );
      const stats = await getRollingStats();
      rollingWinRate = stats.winRate;
      rollingAvgR = stats.avgR;
      lastAdaptiveUpdate = getLastAdaptiveRunDate();

      const cfgResult = await db.query(
        `SELECT config_key, config_json FROM bias_config WHERE config_key IN ('risk', 'adaptive')`
      );
      for (const row of cfgResult.rows) {
        adaptiveModifiers[String(row.config_key)] = row.config_json;
      }
    } catch {
      /* performance feedback optional */
    }

    const result = await db.query(
      `SELECT symbol, updated_at_ms, source, state_json
       FROM bias_state_current
       ORDER BY updated_at_ms DESC`
    );
    const summary = result.rows.map((row) => {
      const state = row.state_json as Record<string, unknown>;
      const effective = state?.effective as Record<string, unknown> | undefined;
      const acceleration = state?.acceleration as Record<string, unknown> | undefined;
      const updatedAtMs = Number(row.updated_at_ms ?? state?.updatedAtMs ?? 0);
      const session = (state?.session as string) ?? 'RTH';
      const now = Date.now();
      const ageMinutes = (now - updatedAtMs) / 60_000;
      const isRth = session === 'RTH';
      const threshold = isRth ? 10 : 60;
      const isStale = ageMinutes > threshold;
      const stalenessMinutes = Math.round(ageMinutes * 10) / 10;
      return {
        symbol: row.symbol,
        updatedAtMs,
        source: row.source,
        bias: state?.bias,
        effectiveBiasScore: effective?.effectiveBiasScore,
        effectiveConfidence: effective?.effectiveConfidence,
        tradeSuppressed: effective?.tradeSuppressed,
        macroClass: state?.macroClass,
        intentType: state?.intentType,
        regimeType: state?.regimeType,
        isStale,
        stalenessMinutes,
        macroDriftScore: acceleration?.macroDriftScore,
        acceleration: acceleration
          ? {
              stateStrengthDelta: acceleration.stateStrengthDelta,
              intentMomentumDelta: acceleration.intentMomentumDelta,
              macroDriftScore: acceleration.macroDriftScore,
            }
          : null,
        currentExposureCaps: {
          maxOpenTrades: PORTFOLIO_GUARDRAILS.maxOpenTrades,
          maxPositionsPerSymbol: 2,
          maxSameDirectionPerSymbolCluster: 2,
          maxMacroMisalignedExposure: 3,
        },
        lastSuppressionReason: (effective?.notes as string[] | undefined)?.join('; ') ?? null,
      };
    });
    let adaptiveBadge: 'stable' | 'tuning_adjusted' | 'disabled' = 'stable';
    try {
      const { getAdaptiveMeta } = await import(
        '../services/performance-feedback/adaptive-status.service.js'
      );
      const meta = await getAdaptiveMeta();
      if (!meta.enabled) adaptiveBadge = 'disabled';
      else if (meta.lastRunSummary?.tunerUpdated && meta.lastRunSummary?.parametersChanged?.length) {
        const lastDate = meta.lastRunSummary.date ? new Date(meta.lastRunSummary.date).getTime() : 0;
        if (Date.now() - lastDate < 24 * 60 * 60 * 1000) adaptiveBadge = 'tuning_adjusted';
      }
    } catch {
      /* ignore */
    }

    return res.json({
      symbols: summary,
      rollingWinRate,
      rollingAvgR,
      adaptiveModifiers,
      lastAdaptiveUpdate,
      adaptiveBadge,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch bias summary' });
  }
});

export default router;
