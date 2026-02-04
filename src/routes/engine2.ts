// Engine 2 API endpoints
import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../services/database.service.js';
import { authService } from '../services/auth.service.js';
import { marketData } from '../services/market-data.js';
import { cache } from '../services/cache.service.js';
import { logger } from '../utils/logger.js';
import { errorTracker } from '../services/error-tracker.service.js';

const router = Router();

type AuthPayload = {
  userId: string;
  email: string;
  role: 'admin' | 'researcher' | 'user';
};

type ExitSignal = {
  position_id: string;
  symbol: string;
  reason: string;
  severity: 'low' | 'medium' | 'high';
  created_at: Date;
  status: 'active';
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

function parseDate(input?: string): Date | null {
  if (!input) return null;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function calculateMetrics(pnls: number[]) {
  if (pnls.length === 0) {
    return {
      totalTrades: 0,
      winRate: 0,
      avgPnl: 0,
      avgWin: 0,
      avgLoss: 0,
      expectancy: 0,
    };
  }

  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const total = pnls.length;
  const winRate = wins.length / total;
  const avgPnl = pnls.reduce((sum, p) => sum + p, 0) / total;
  const avgWin = wins.length ? wins.reduce((sum, p) => sum + p, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((sum, p) => sum + p, 0) / losses.length : 0;
  const expectancy = avgWin * winRate + avgLoss * (1 - winRate);

  return {
    totalTrades: total,
    winRate: Math.round(winRate * 100) / 100,
    avgPnl,
    avgWin,
    avgLoss,
    expectancy,
  };
}

function erf(x: number): number {
  // Abramowitz and Stegun approximation
  const sign = x >= 0 ? 1 : -1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * Math.abs(x));
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-x * x);
  return sign * y;
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function computeSignificance(a: { totalTrades: number; winRate: number }, b: { totalTrades: number; winRate: number }) {
  if (a.totalTrades === 0 || b.totalTrades === 0) {
    return null;
  }

  const p1 = a.winRate;
  const p2 = b.winRate;
  const n1 = a.totalTrades;
  const n2 = b.totalTrades;
  const p = (p1 * n1 + p2 * n2) / (n1 + n2);
  const denom = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!denom) {
    return null;
  }

  const zScore = (p1 - p2) / denom;
  const pValue = 2 * (1 - normalCdf(Math.abs(zScore)));
  return {
    zScore,
    pValue,
    significant: pValue < 0.05,
  };
}

function clamp(num: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, num));
}

function calculatePnlPercent(entryPrice: number, currentPrice: number): number {
  if (!entryPrice) return 0;
  return ((currentPrice - entryPrice) / entryPrice) * 100;
}

async function getExitSignals(): Promise<ExitSignal[]> {
  const rulesResult = await db.query(
    `SELECT * FROM exit_rules WHERE enabled = true ORDER BY created_at DESC LIMIT 1`
  );
  const rule = rulesResult.rows[0];
  if (!rule) return [];

  const positionsResult = await db.query(
    `SELECT position_id, symbol, entry_price, current_price, entry_timestamp, expiration
     FROM refactored_positions WHERE status IN ('open', 'closing')`
  );

  const signals: ExitSignal[] = [];
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

router.get('/exit-signals', requireAuth, async (_req: Request, res: Response) => {
  const data = await getExitSignals();
  return res.json({ data });
});

router.get('/signals', requireAuth, async (req: Request, res: Response) => {
  const rawStatus = String(req.query.status || 'pending');
  const status = rawStatus === 'queued' ? 'pending' : rawStatus;
  if (status !== 'pending' && status !== 'approved' && status !== 'rejected') {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const result = await db.query(
    `SELECT signal_id AS id, symbol, direction, timeframe, created_at AS queued_at
     FROM signals
     WHERE status = $1
     ORDER BY created_at DESC
     LIMIT 200`,
    [status]
  );
  return res.json({ data: result.rows });
});

router.get('/signals/sources/performance', requireAuth, async (_req: Request, res: Response) => {
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

  return res.json({ data });
});

router.get('/analytics/pnl-curve', requireAuth, async (req: Request, res: Response) => {
  const days = req.query.days ? Number(req.query.days) : 30;
  const series = await getDailyPnlSeries(days);
  let cumulative = 0;
  const data = series.map((point) => {
    cumulative += point.value;
    return { date: point.date, value: cumulative };
  });
  return res.json({ data });
});

router.get('/analytics/daily-returns', requireAuth, async (req: Request, res: Response) => {
  const days = req.query.days ? Number(req.query.days) : 14;
  const data = await getDailyPnlSeries(days);
  return res.json({ data });
});

router.get('/experiments', requireAuth, async (req: Request, res: Response) => {
  const { startDate, endDate, symbol, variant } = req.query as Record<string, string | undefined>;
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  const conditions: string[] = [];
  const values: any[] = [];

  if (symbol) {
    conditions.push(`s.symbol = $${values.length + 1}`);
    values.push(symbol);
  }
  if (variant) {
    conditions.push(`e.variant = $${values.length + 1}`);
    values.push(variant);
  }
  if (start) {
    conditions.push(`e.created_at >= $${values.length + 1}`);
    values.push(start);
  }
  if (end) {
    conditions.push(`e.created_at <= $${values.length + 1}`);
    values.push(end);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await db.query(
    `SELECT e.experiment_id, e.signal_id, e.variant, e.assignment_hash, e.split_percentage, e.created_at,
            s.symbol, s.timeframe
     FROM experiments e
     JOIN signals s ON s.signal_id = e.signal_id
     ${where}
     ORDER BY e.created_at DESC
     LIMIT 500`,
    values
  );

  return res.json({ data: result.rows });
});

router.get('/experiments/:id/results', requireAuth, async (req: Request, res: Response) => {
  const experimentId = req.params.id;

  const experimentResult = await db.query(
    `SELECT experiment_id, signal_id, variant, created_at FROM experiments WHERE experiment_id = $1`,
    [experimentId]
  );
  if (experimentResult.rows.length === 0) {
    return res.status(404).json({ error: 'Experiment not found' });
  }

  const experiment = experimentResult.rows[0];

  const orderResult = await db.query(
    `SELECT option_symbol FROM orders WHERE signal_id = $1`,
    [experiment.signal_id]
  );
  const optionSymbols = orderResult.rows.map((row) => row.option_symbol);
  const variantAResult = optionSymbols.length
    ? await db.query(
        `SELECT realized_pnl, unrealized_pnl FROM refactored_positions WHERE option_symbol = ANY($1)`,
        [optionSymbols]
      )
    : { rows: [] as any[] };
  const variantAPnls = variantAResult.rows
    .map((row) => (row.realized_pnl ?? row.unrealized_pnl) as number | null)
    .filter((p) => typeof p === 'number') as number[];

  const variantBResult = await db.query(
    `SELECT sp.realized_pnl, sp.unrealized_pnl
     FROM shadow_positions sp
     JOIN shadow_trades st ON st.shadow_trade_id = sp.shadow_trade_id
     WHERE st.experiment_id = $1`,
    [experimentId]
  );
  const variantBPnls = variantBResult.rows
    .map((row) => (row.realized_pnl ?? row.unrealized_pnl) as number | null)
    .filter((p) => typeof p === 'number') as number[];

  const metricsA = calculateMetrics(variantAPnls);
  const metricsB = calculateMetrics(variantBPnls);
  const significance = computeSignificance(metricsA, metricsB);

  return res.json({
    experiment_id: experiment.experiment_id,
    signal_id: experiment.signal_id,
    variant: experiment.variant,
    metrics: {
      A: metricsA,
      B: metricsB,
    },
    statistical_significance: significance,
  });
});

router.get('/agents/performance', requireAuth, async (req: Request, res: Response) => {
  const { agent, startDate, endDate } = req.query as Record<string, string | undefined>;
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  const conditions: string[] = [];
  const values: any[] = [];

  if (agent) {
    conditions.push(`agent_name = $${values.length + 1}`);
    values.push(agent);
  }
  if (start) {
    conditions.push(`last_updated >= $${values.length + 1}`);
    values.push(start);
  }
  if (end) {
    conditions.push(`last_updated <= $${values.length + 1}`);
    values.push(end);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await db.query(
    `SELECT * FROM agent_performance ${where} ORDER BY last_updated DESC LIMIT 500`,
    values
  );

  return res.json({ data: result.rows });
});

router.get('/shadow-trades', requireAuth, async (req: Request, res: Response) => {
  const { startDate, endDate, symbol, agent } = req.query as Record<string, string | undefined>;
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  const conditions: string[] = [];
  const values: any[] = [];

  if (symbol) {
    conditions.push(`symbol = $${values.length + 1}`);
    values.push(symbol);
  }
  if (start) {
    conditions.push(`entry_timestamp >= $${values.length + 1}`);
    values.push(start);
  }
  if (end) {
    conditions.push(`entry_timestamp <= $${values.length + 1}`);
    values.push(end);
  }
  if (agent) {
    conditions.push(`contributing_agents @> $${values.length + 1}::jsonb`);
    values.push(JSON.stringify([agent]));
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await db.query(
    `SELECT * FROM shadow_trades ${where} ORDER BY entry_timestamp DESC LIMIT 500`,
    values
  );

  return res.json({ data: result.rows });
});

router.get('/shadow-positions', requireAuth, async (req: Request, res: Response) => {
  const { startDate, endDate, symbol, agent, status } = req.query as Record<string, string | undefined>;
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  const conditions: string[] = [];
  const values: any[] = [];

  if (symbol) {
    conditions.push(`sp.symbol = $${values.length + 1}`);
    values.push(symbol);
  }
  if (status) {
    conditions.push(`sp.status = $${values.length + 1}`);
    values.push(status);
  }
  if (start) {
    conditions.push(`sp.entry_timestamp >= $${values.length + 1}`);
    values.push(start);
  }
  if (end) {
    conditions.push(`sp.entry_timestamp <= $${values.length + 1}`);
    values.push(end);
  }
  if (agent) {
    conditions.push(`st.contributing_agents @> $${values.length + 1}::jsonb`);
    values.push(JSON.stringify([agent]));
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await db.query(
    `SELECT sp.*, st.experiment_id, st.contributing_agents, st.meta_confidence
     FROM shadow_positions sp
     JOIN shadow_trades st ON st.shadow_trade_id = sp.shadow_trade_id
     ${where}
     ORDER BY sp.entry_timestamp DESC
     LIMIT 500`,
    values
  );

  return res.json({ data: result.rows });
});

router.get('/positions', requireAuth, async (req: Request, res: Response) => {
  const { startDate, endDate, symbol, status } = req.query as Record<string, string | undefined>;
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  const conditions: string[] = [];
  const values: any[] = [];

  if (symbol) {
    conditions.push(`symbol = $${values.length + 1}`);
    values.push(symbol);
  }
  if (status) {
    conditions.push(`status = $${values.length + 1}`);
    values.push(status);
  }
  if (start) {
    conditions.push(`entry_timestamp >= $${values.length + 1}`);
    values.push(start);
  }
  if (end) {
    conditions.push(`entry_timestamp <= $${values.length + 1}`);
    values.push(end);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await db.query(
    `SELECT * FROM refactored_positions ${where} ORDER BY entry_timestamp DESC LIMIT 500`,
    values
  );

  return res.json({ data: result.rows });
});

router.get('/health', async (_req: Request, res: Response) => {
  const now = new Date();
  const uptimeSeconds = Math.floor(process.uptime());
  let dbOk = true;
  try {
    await db.query('SELECT 1');
  } catch (error) {
    dbOk = false;
    logger.error('Health check DB failed', error);
  }

  return res.json({
    status: dbOk ? 'healthy' : 'degraded',
    timestamp: now.toISOString(),
    uptime_seconds: uptimeSeconds,
    database: { ok: dbOk },
    cache: cache.getStats(),
    errors: errorTracker.getStats(),
    external_apis: {
      circuit_breakers: marketData.getCircuitBreakerStatus(),
    },
  });
});

export default router;
