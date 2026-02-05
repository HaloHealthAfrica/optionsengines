// Aggregated Dashboard Endpoint - Fetches all dashboard data in parallel
import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../services/database.service.js';
import { authService } from '../services/auth.service.js';
import { positioningService } from '../services/positioning.service.js';
import { redisCache } from '../services/redis-cache.service.js';
import { logger } from '../utils/logger.js';
import { cache } from '../services/cache.service.js';
import { errorTracker } from '../services/error-tracker.service.js';
import { marketData } from '../services/market-data.js';

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

function clamp(num: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, num));
}

async function getDailyPnlSeries(days: number): Promise<{ date: string; value: number }[]> {
  const safeDays = clamp(days, 1, 365);
  const result = await db.query(
    `SELECT DATE_TRUNC('day', exit_timestamp) AS day,
            SUM(COALESCE(realized_pnl, 0))::float AS pnl
     FROM refactored_positions
     WHERE exit_timestamp >= NOW() - ($1::int || ' days')::interval
     GROUP BY day
     ORDER BY day ASC`,
    [safeDays]
  );

  return result.rows.map((row: any) => ({
    date: new Date(row.day).toISOString(),
    value: Number(row.pnl ?? 0),
  }));
}

function calculatePnlPercent(entryPrice: number, currentPrice: number): number {
  if (!entryPrice) return 0;
  return ((currentPrice - entryPrice) / entryPrice) * 100;
}

async function getExitSignals() {
  const rulesResult = await db.query(
    `SELECT * FROM exit_rules WHERE enabled = true ORDER BY created_at DESC LIMIT 1`
  );
  const rule = rulesResult.rows[0];
  if (!rule) return [];

  const positionsResult = await db.query(
    `SELECT position_id, symbol, entry_price, current_price, entry_timestamp, expiration
     FROM refactored_positions WHERE status IN ('open', 'closing')`
  );

  const signals: any[] = [];
  const now = Date.now();

  for (const row of positionsResult.rows) {
    if (!row.current_price || !row.entry_price) continue;

    const pnlPercent = calculatePnlPercent(Number(row.entry_price), Number(row.current_price));
    const timeInHours = row.entry_timestamp
      ? (now - new Date(row.entry_timestamp).getTime()) / 3600000
      : 0;
    const dte = row.expiration
      ? Math.ceil((new Date(row.expiration).getTime() - now) / 86400000)
      : null;

    if (rule.profit_target_percent && pnlPercent >= Number(rule.profit_target_percent)) {
      signals.push({
        position_id: row.position_id,
        symbol: row.symbol,
        reason: 'profit_target',
        severity: 'medium',
        created_at: new Date(),
        status: 'active',
      });
      continue;
    }

    if (rule.stop_loss_percent && pnlPercent <= -Number(rule.stop_loss_percent)) {
      signals.push({
        position_id: row.position_id,
        symbol: row.symbol,
        reason: 'stop_loss',
        severity: 'high',
        created_at: new Date(),
        status: 'active',
      });
      continue;
    }

    if (rule.max_hold_time_hours && timeInHours >= Number(rule.max_hold_time_hours)) {
      signals.push({
        position_id: row.position_id,
        symbol: row.symbol,
        reason: 'time_stop',
        severity: 'low',
        created_at: new Date(),
        status: 'active',
      });
      continue;
    }

    if (rule.min_dte_exit && dte !== null && dte <= Number(rule.min_dte_exit)) {
      signals.push({
        position_id: row.position_id,
        symbol: row.symbol,
        reason: 'dte_exit',
        severity: 'medium',
        created_at: new Date(),
        status: 'active',
      });
    }
  }

  return signals;
}

// Aggregated dashboard endpoint
router.get('/', requireAuth, async (_req: Request, res: Response) => {
  const startTime = Date.now();
  const cacheHits: string[] = [];
  const cacheMisses: string[] = [];
  const errors: Record<string, string> = {};

  // Fetch all data in parallel
  const results = await Promise.allSettled([
    // 1. Positions (real-time, no cache)
    db.query(`SELECT * FROM refactored_positions WHERE status = 'open' ORDER BY entry_timestamp DESC LIMIT 500`)
      .then(r => r.rows)
      .catch(err => { errors.positions = err.message; return []; }),
    
    // 2. Shadow Positions (real-time, no cache)
    db.query(
      `SELECT sp.*, st.experiment_id, st.contributing_agents, st.meta_confidence
       FROM shadow_positions sp
       JOIN shadow_trades st ON st.shadow_trade_id = sp.shadow_trade_id
       WHERE sp.status = 'open'
       ORDER BY sp.entry_timestamp DESC
       LIMIT 500`
    )
      .then(r => r.rows)
      .catch(err => { errors.shadow_positions = err.message; return []; }),
    
    // 3. Health (real-time, no cache)
    (async () => {
      const now = new Date();
      const uptimeSeconds = Math.floor(process.uptime());
      let dbOk = true;
      try {
        await db.query('SELECT 1');
      } catch (error) {
        dbOk = false;
        logger.error('Health check DB failed', error);
      }

      return {
        status: dbOk ? 'healthy' : 'degraded',
        timestamp: now.toISOString(),
        uptime_seconds: uptimeSeconds,
        database: { ok: dbOk },
        cache: cache.getStats(),
        errors: errorTracker.getStats(),
        external_apis: {
          circuit_breakers: marketData.getCircuitBreakerStatus(),
        },
      };
    })().catch(err => { errors.health = err.message; return null; }),
    
    // 4. Exit Signals (real-time, no cache)
    getExitSignals()
      .catch(err => { errors.exit_signals = err.message; return []; }),
    
    // 5. Queued Signals (real-time, no cache)
    db.query(
      `SELECT signal_id AS id, symbol, direction, timeframe, created_at AS queued_at
       FROM signals
       WHERE status = 'pending'
       ORDER BY created_at DESC
       LIMIT 200`
    )
      .then(r => r.rows)
      .catch(err => { errors.queued_signals = err.message; return []; }),
    
    // 6. Source Performance (cached, 10-min TTL)
    (async () => {
      const cacheKey = redisCache.buildKey('performance', { type: 'sources' });
      const cached = await redisCache.getCached<any[]>(cacheKey);
      
      if (cached.hit && cached.data) {
        cacheHits.push('source_performance');
        return cached.data;
      }

      cacheMisses.push('source_performance');
      
      const result = await db.query(
        `SELECT
          COALESCE(raw_payload->>'source', raw_payload->>'strategy', raw_payload->>'indicator', 'unknown') AS source,
          COUNT(*)::int AS total,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END)::int AS approved,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END)::int AS rejected
         FROM signals
         GROUP BY source
         ORDER BY total DESC
         LIMIT 50`
      );

      const data = result.rows.map((row: any) => {
        const total = Number(row.total || 0);
        const approved = Number(row.approved || 0);
        const acceptanceRate = total ? Math.round((approved / total) * 100) : 0;

        return {
          source: row.source,
          acceptance_rate: acceptanceRate,
          win_rate: 0,
          avg_confidence: 0,
          weight: 0,
        };
      });

      const ttl = redisCache.getTTLForType('performance');
      await redisCache.setCached(cacheKey, data, ttl);

      return data;
    })().catch(err => { errors.source_performance = err.message; return []; }),
    
    // 7. GEX (cached, 5-min TTL)
    positioningService.getGexSnapshot('SPY')
      .then(data => {
        if (data.cached) {
          cacheHits.push('gex');
        } else {
          cacheMisses.push('gex');
        }
        return data;
      })
      .catch(err => { errors.gex = err.message; return null; }),
    
    // 8. PnL Curve (cached, 15-min TTL)
    (async () => {
      const days = 30;
      const cacheKey = redisCache.buildKey('analytics', { type: 'pnl', days: days.toString() });
      const cached = await redisCache.getCached<any[]>(cacheKey);
      
      if (cached.hit && cached.data) {
        cacheHits.push('pnl_curve');
        return cached.data;
      }

      cacheMisses.push('pnl_curve');
      
      const series = await getDailyPnlSeries(days);
      let cumulative = 0;
      const data = series.map((point) => {
        cumulative += point.value;
        return { date: point.date, value: cumulative };
      });

      const ttl = redisCache.getTTLForType('analytics');
      await redisCache.setCached(cacheKey, data, ttl);

      return data;
    })().catch(err => { errors.pnl_curve = err.message; return []; }),
    
    // 9. Daily Returns (cached, 15-min TTL)
    (async () => {
      const days = 14;
      const cacheKey = redisCache.buildKey('analytics', { type: 'returns', days: days.toString() });
      const cached = await redisCache.getCached<any[]>(cacheKey);
      
      if (cached.hit && cached.data) {
        cacheHits.push('daily_returns');
        return cached.data;
      }

      cacheMisses.push('daily_returns');
      
      const data = await getDailyPnlSeries(days);

      const ttl = redisCache.getTTLForType('analytics');
      await redisCache.setCached(cacheKey, data, ttl);

      return data;
    })().catch(err => { errors.daily_returns = err.message; return []; }),
  ]);

  const responseTime = Date.now() - startTime;

  // Extract data from results
  const positions = results[0].status === 'fulfilled' ? results[0].value : [];
  const shadowPositions = results[1].status === 'fulfilled' ? results[1].value : [];
  const health = results[2].status === 'fulfilled' ? results[2].value : null;
  const exitSignals = results[3].status === 'fulfilled' ? results[3].value : [];
  const queuedSignals = results[4].status === 'fulfilled' ? results[4].value : [];
  const sourcePerformance = results[5].status === 'fulfilled' ? results[5].value : [];
  const gex = results[6].status === 'fulfilled' ? results[6].value : null;
  const pnlCurve = results[7].status === 'fulfilled' ? results[7].value : [];
  const dailyReturns = results[8].status === 'fulfilled' ? results[8].value : [];

  logger.info('Dashboard aggregated request', {
    responseTimeMs: responseTime,
    cacheHits,
    cacheMisses,
    errors: Object.keys(errors),
  });

  return res.json({
    positions,
    shadow_positions: shadowPositions,
    health,
    exit_signals: exitSignals,
    queued_signals: queuedSignals,
    source_performance: sourcePerformance,
    gex,
    pnl_curve: pnlCurve,
    daily_returns: dailyReturns,
    metadata: {
      response_time_ms: responseTime,
      cache_hits: cacheHits,
      cache_misses: cacheMisses,
      timestamp: new Date().toISOString(),
    },
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  });
});

export default router;
