import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
import { db } from '../services/database.service.js';
import { marketData } from '../services/market-data.js';
import { rateLimiter } from '../services/rate-limiter.service.js';
import { marketDataStream } from '../services/market-data-stream.service.js';
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

  let recentEvents = { rows: [] as any[] };
  let summaryRows = { rows: [] as any[] };
  let engineRows = { rows: [] as any[] };

  try {
    [recentEvents, summaryRows, engineRows] = await Promise.all([
      db.query(
        `SELECT event_id, request_id, signal_id, experiment_id, variant, status, error_message,
                symbol, direction, timeframe, processing_time_ms, created_at
         FROM webhook_events
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      ),
      db.query(
        `SELECT status, COUNT(*)::int AS count
         FROM webhook_events
         WHERE created_at > NOW() - INTERVAL '24 hours'
         GROUP BY status`,
        []
      ),
      db.query(
        `SELECT variant, COUNT(*)::int AS count
         FROM experiments
         WHERE created_at > NOW() - INTERVAL '24 hours'
         GROUP BY variant`,
        []
      ),
    ]);
  } catch (error) {
    // If migrations aren't applied yet, return empty webhook data
    logger.warn('Monitoring query failed, returning empty webhook data', { error });
    recentEvents = { rows: [] };
    summaryRows = { rows: [] };
    engineRows = { rows: [] };
  }

  const webhookSummary = summaryRows.rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row.count;
    return acc;
  }, {});

  const engineSummary = engineRows.rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.variant] = row.count;
    return acc;
  }, {});

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
    websocket: marketDataStream.getStatus(),
    providers: {
      circuit_breakers: circuitBreakers,
      down: downProviders,
      rate_limits: rateLimiter.getAllStats(),
    },
  });
});

export default router;
