import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
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

function formatCurrency(value: number): string {
  const rounded = Number.isFinite(value) ? value : 0;
  return rounded.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: number): string {
  const rounded = Number.isFinite(value) ? value : 0;
  const sign = rounded >= 0 ? '+' : '';
  return `${sign}${rounded.toFixed(1)}%`;
}

function formatDays(value: number): string {
  if (!Number.isFinite(value)) return '0.0 days';
  return `${value.toFixed(1)} days`;
}

router.get('/stats', requireAuth, async (_req: Request, res: Response) => {
  const summaryResult = await db.query(
    `SELECT
      COUNT(*)::int AS total,
      SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END)::int AS wins,
      SUM(CASE WHEN realized_pnl < 0 THEN 1 ELSE 0 END)::int AS losses,
      COALESCE(SUM(CASE WHEN realized_pnl > 0 THEN realized_pnl ELSE 0 END), 0) AS wins_pnl,
      COALESCE(SUM(CASE WHEN realized_pnl < 0 THEN realized_pnl ELSE 0 END), 0) AS losses_pnl,
      COALESCE(SUM(realized_pnl), 0) AS total_pnl,
      COALESCE(AVG(EXTRACT(EPOCH FROM (exit_timestamp - entry_timestamp)) / 86400), 0) AS avg_hold_days
     FROM refactored_positions
     WHERE status = 'closed' AND exit_timestamp IS NOT NULL`
  );

  const summary = summaryResult.rows[0] || {};
  const total = Number(summary.total || 0);
  const wins = Number(summary.wins || 0);
  const losses = Number(summary.losses || 0);
  const winsPnl = Number(summary.wins_pnl || 0);
  const lossesPnl = Number(summary.losses_pnl || 0);
  const totalPnl = Number(summary.total_pnl || 0);
  const avgHoldDays = Number(summary.avg_hold_days || 0);
  const winRate = total ? (wins / total) * 100 : 0;
  const profitFactor = lossesPnl === 0 ? winsPnl : Math.abs(winsPnl / lossesPnl);

  const timelineResult = await db.query(
    `SELECT symbol, type, entry_price, quantity, realized_pnl, exit_timestamp
     FROM refactored_positions
     WHERE status = 'closed' AND exit_timestamp IS NOT NULL
     ORDER BY exit_timestamp DESC
     LIMIT 50`
  );

  const timeline = timelineResult.rows.map((row: any) => {
    const entryPrice = Number(row.entry_price || 0);
    const qty = Number(row.quantity || 0);
    const cost = entryPrice * qty * 100;
    const realizedPnl = Number(row.realized_pnl || 0);
    const pnlPercent = cost > 0 ? (realizedPnl / cost) * 100 : 0;
    return {
      symbol: row.symbol,
      type: row.type === 'call' ? 'Call' : 'Put',
      date: row.exit_timestamp ? new Date(row.exit_timestamp).toISOString().slice(0, 10) : '',
      pnl: formatPercent(pnlPercent),
      value: formatCurrency(realizedPnl),
    };
  });

  const distribution = [
    { name: 'Wins', value: wins },
    { name: 'Losses', value: losses },
  ];

  res.json({
    stats: {
      totalPnl: formatCurrency(totalPnl),
      winRate: `${winRate.toFixed(1)}%`,
      profitFactor: profitFactor.toFixed(2),
      avgHold: formatDays(avgHoldDays),
      totalTrades: total,
    },
    timeline,
    distribution,
  });
});

export default router;
