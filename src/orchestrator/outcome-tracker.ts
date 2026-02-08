/**
 * Outcome Tracker - records trade outcomes and aggregates performance
 */

import pg from 'pg';
import { PerformanceMetrics, TradeOutcome } from './types.js';
import { TradeOutcomeSchema } from './schemas.js';
import { logger } from '../utils/logger.js';

export class OutcomeTracker {
  constructor(private pool: pg.Pool) {}

  async recordOutcome(outcome: TradeOutcome): Promise<TradeOutcome> {
    const validated = TradeOutcomeSchema.parse(outcome);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO trade_outcomes
         (experiment_id, engine, trade_id, entry_price, exit_price, pnl, exit_reason, entry_time, exit_time, is_shadow)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING outcome_id, experiment_id, engine, trade_id, entry_price, exit_price, pnl, exit_reason, entry_time, exit_time, is_shadow, created_at`,
        [
          validated.experiment_id,
          validated.engine,
          validated.trade_id,
          validated.entry_price,
          validated.exit_price,
          validated.pnl,
          validated.exit_reason,
          validated.entry_time,
          validated.exit_time,
          validated.is_shadow,
        ]
      );

      const stored = result.rows[0];
      logger.info('Recorded trade outcome', {
        outcome_id: stored.outcome_id,
        experiment_id: stored.experiment_id,
        engine: stored.engine,
      });

      return stored;
    } finally {
      client.release();
    }
  }

  async getPerformanceMetrics(engine: 'A' | 'B'): Promise<PerformanceMetrics> {
    const result = await this.pool.query(
      `SELECT
         COUNT(*)::int AS total_trades,
         COUNT(*) FILTER (WHERE pnl > 0)::int AS winning_trades,
         COUNT(*) FILTER (WHERE pnl <= 0)::int AS losing_trades,
         COALESCE(SUM(pnl), 0)::float AS total_pnl,
         COALESCE(AVG(pnl), 0)::float AS average_pnl,
         COALESCE(MAX(pnl), 0)::float AS max_win,
         COALESCE(MIN(pnl), 0)::float AS max_loss
       FROM trade_outcomes
       WHERE engine = $1`,
      [engine]
    );

    const row = result.rows[0];
    const total = row.total_trades || 0;

    return {
      engine,
      total_trades: total,
      winning_trades: row.winning_trades || 0,
      losing_trades: row.losing_trades || 0,
      win_rate: this.calculateWinRate(row.winning_trades || 0, total),
      total_pnl: row.total_pnl || 0,
      average_pnl: row.average_pnl || 0,
      max_win: row.max_win || 0,
      max_loss: row.max_loss || 0,
    };
  }

  calculateWinRate(winningTrades: number, totalTrades: number): number {
    if (totalTrades === 0) {
      return 0;
    }
    return (winningTrades / totalTrades) * 100;
  }

  calculateAveragePnL(totalPnL: number, totalTrades: number): number {
    if (totalTrades === 0) {
      return 0;
    }
    return totalPnL / totalTrades;
  }
}
