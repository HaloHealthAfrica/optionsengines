import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
import { db } from '../services/database.service.js';
import { marketData } from '../services/market-data.js';
import { rateLimiter } from '../services/rate-limiter.service.js';
import { marketDataStream } from '../services/market-data-stream.service.js';
import { errorTracker } from '../services/error-tracker.service.js';
import { logger } from '../utils/logger.js';

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

router.get('/status', requireAuth, async (req: Request, res: Response) => {
  const limitParam = Number(req.query.limit);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 25) : 10;
  const windowHoursParam = Number(req.query.windowHours);
  const windowHours = Number.isFinite(windowHoursParam) && windowHoursParam > 0 ? windowHoursParam : 24;

  let recentEvents = { rows: [] as any[] };
  let summaryRows = { rows: [] as any[] };
  let engineRows = { rows: [] as any[] };
  let signalSummaryRows = { rows: [] as any[] };
  let orderSummaryRows = { rows: [] as any[] };
  let recentSignals = { rows: [] as any[] };
  let recentRejections = { rows: [] as any[] };
  let activityRows = { rows: [] as any[] };

  try {
    [recentEvents, summaryRows, engineRows, signalSummaryRows, orderSummaryRows, recentSignals, recentRejections, activityRows] =
      await Promise.all([
      db.query(
        `SELECT event_id, request_id, signal_id, experiment_id, variant, status, error_message,
                symbol, direction, timeframe, processing_time_ms, created_at
         FROM webhook_events
       WHERE created_at > NOW() - ($2::int || ' hours')::interval
         ORDER BY created_at DESC
       LIMIT $1`,
        [limit, windowHours]
      ),
      db.query(
        `SELECT status, COUNT(*)::int AS count
         FROM webhook_events
       WHERE created_at > NOW() - ($1::int || ' hours')::interval
         GROUP BY status`,
        [windowHours]
      ),
      db.query(
        `SELECT variant, COUNT(*)::int AS count
         FROM experiments
       WHERE created_at > NOW() - ($1::int || ' hours')::interval
         GROUP BY variant`,
        [windowHours]
      ),
      db.query(
        `SELECT status, COUNT(*)::int AS count
         FROM signals
       WHERE created_at > NOW() - ($1::int || ' hours')::interval
         GROUP BY status`,
        [windowHours]
      ),
      db.query(
        `SELECT status, COUNT(*)::int AS count
         FROM orders
       WHERE created_at > NOW() - ($1::int || ' hours')::interval
         GROUP BY status`,
        [windowHours]
      ),
      db.query(
        `SELECT signal_id, symbol, direction, timeframe, status, created_at
         FROM signals
         ORDER BY created_at DESC
         LIMIT 10`
      ),
      db.query(
        `SELECT s.signal_id, s.symbol, s.direction, s.timeframe, rs.rejection_reason, s.created_at
         FROM signals s
         JOIN refactored_signals rs ON rs.signal_id = s.signal_id
         WHERE s.status = 'rejected'
         ORDER BY s.created_at DESC
         LIMIT 10`
      ),
      db.query(
        `SELECT 
           (SELECT MAX(created_at) FROM signals) AS last_signal_at,
           (SELECT MAX(created_at) FROM orders) AS last_order_at,
           (SELECT MAX(fill_timestamp) FROM trades) AS last_trade_at,
           (SELECT MAX(created_at) FROM refactored_positions) AS last_position_at`
      ),
    ]);
  } catch (error) {
    // If migrations aren't applied yet, return empty webhook data
    logger.warn('Monitoring query failed, returning empty webhook data', { error });
    recentEvents = { rows: [] };
    summaryRows = { rows: [] };
    engineRows = { rows: [] };
    signalSummaryRows = { rows: [] };
    orderSummaryRows = { rows: [] };
    recentSignals = { rows: [] };
    recentRejections = { rows: [] };
    activityRows = { rows: [] };
  }

  const webhookSummary = summaryRows.rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row.count;
    return acc;
  }, {});

  const engineSummary = engineRows.rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.variant] = row.count;
    return acc;
  }, {});

  const signalSummary = signalSummaryRows.rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row.count;
    return acc;
  }, {});

  const orderSummary = orderSummaryRows.rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row.count;
    return acc;
  }, {});

  const activity = activityRows.rows[0] || {};

  const circuitBreakers = marketData.getCircuitBreakerStatus();
  const downProviders = Object.entries(circuitBreakers)
    .filter(([, status]) => status.state === 'open')
    .map(([provider]) => provider);

  return res.json({
    timestamp: new Date().toISOString(),
    webhooks: {
      recent: recentEvents.rows,
      summary_24h: {
        total:
          Object.values(webhookSummary).reduce((sum, value) => sum + value, 0) || 0,
        accepted: webhookSummary.accepted || 0,
        duplicate: webhookSummary.duplicate || 0,
        invalid_signature: webhookSummary.invalid_signature || 0,
        invalid_payload: webhookSummary.invalid_payload || 0,
        error: webhookSummary.error || 0,
      },
    },
    engines: {
      by_variant_24h: {
        A: engineSummary.A || 0,
        B: engineSummary.B || 0,
      },
    },
    pipeline: {
      signals_24h: {
        total: Object.values(signalSummary).reduce((sum, value) => sum + value, 0) || 0,
        pending: signalSummary.pending || 0,
        approved: signalSummary.approved || 0,
        rejected: signalSummary.rejected || 0,
      },
      orders_24h: {
        total: Object.values(orderSummary).reduce((sum, value) => sum + value, 0) || 0,
        pending_execution: orderSummary.pending_execution || 0,
        filled: orderSummary.filled || 0,
        failed: orderSummary.failed || 0,
        cancelled: orderSummary.cancelled || 0,
      },
      recent_signals: recentSignals.rows,
      recent_rejections: recentRejections.rows,
      last_activity: {
        signal: activity.last_signal_at || null,
        order: activity.last_order_at || null,
        trade: activity.last_trade_at || null,
        position: activity.last_position_at || null,
      },
      worker_errors: errorTracker.getStats(),
    },
    websocket: marketDataStream.getStatus(),
    providers: {
      circuit_breakers: circuitBreakers,
      down: downProviders,
      rate_limits: rateLimiter.getAllStats(),
    },
  });
});

export default router;
