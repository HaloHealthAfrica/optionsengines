/**
 * PnL Reconciliation Worker
 * Periodically verifies that stored PnL values match recalculated values
 * using the canonical PnL module. Flags any drift above threshold.
 */

import { db } from '../services/database.service.js';
import { logger } from '../utils/logger.js';
import { calculateRealizedPnL, calculateUnrealizedPnL } from '../lib/pnl/calculate-realized-pnl.js';
import * as Sentry from '@sentry/node';

const DRIFT_THRESHOLD_DOLLARS = 0.50;
const DRIFT_THRESHOLD_PERCENT = 1;
const BATCH_SIZE = 100;

export class PnLReconciliationWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  start(intervalMs: number = 300_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.run().catch((err) => {
        logger.error('PnL reconciliation worker failed', err);
        Sentry.captureException(err, { tags: { worker: 'PnLReconciliation' } });
      });
    }, intervalMs);
    logger.info('PnL reconciliation worker started', { intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('PnL reconciliation worker stopped');
    }
  }

  async run(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      await this.reconcileClosedPositions();
      await this.reconcileOpenPositions();
    } finally {
      this.isRunning = false;
    }
  }

  private async reconcileClosedPositions(): Promise<void> {
    const result = await db.query(
      `SELECT position_id, entry_price, exit_price, quantity,
              COALESCE(multiplier, 100) AS multiplier,
              COALESCE(position_side, 'LONG') AS position_side,
              realized_pnl
       FROM refactored_positions
       WHERE status = 'closed'
         AND exit_price IS NOT NULL
         AND realized_pnl IS NOT NULL
       ORDER BY last_updated DESC
       LIMIT $1`,
      [BATCH_SIZE]
    );

    let driftCount = 0;
    for (const row of result.rows) {
      const expected = calculateRealizedPnL({
        entry_price: Number(row.entry_price),
        exit_price: Number(row.exit_price),
        quantity: Number(row.quantity),
        multiplier: Number(row.multiplier),
        position_side: row.position_side,
      });

      const stored = Number(row.realized_pnl);
      const diff = Math.abs(expected - stored);
      const pctDiff = stored !== 0 ? (diff / Math.abs(stored)) * 100 : diff > 0 ? 100 : 0;

      if (diff > DRIFT_THRESHOLD_DOLLARS && pctDiff > DRIFT_THRESHOLD_PERCENT) {
        driftCount++;
        logger.warn('PnL drift detected (closed position)', {
          positionId: row.position_id,
          stored,
          expected,
          diff,
          pctDiff: pctDiff.toFixed(2),
          positionSide: row.position_side,
        });
      }
    }

    if (driftCount > 0) {
      logger.warn('PnL reconciliation: closed positions with drift', {
        driftCount,
        totalChecked: result.rows.length,
      });
    } else {
      logger.debug('PnL reconciliation: all closed positions match', {
        totalChecked: result.rows.length,
      });
    }
  }

  private async reconcileOpenPositions(): Promise<void> {
    const result = await db.query(
      `SELECT position_id, entry_price, current_price, quantity,
              COALESCE(multiplier, 100) AS multiplier,
              COALESCE(position_side, 'LONG') AS position_side,
              unrealized_pnl
       FROM refactored_positions
       WHERE status = 'open'
         AND current_price IS NOT NULL
         AND unrealized_pnl IS NOT NULL
       ORDER BY last_updated DESC
       LIMIT $1`,
      [BATCH_SIZE]
    );

    let driftCount = 0;
    for (const row of result.rows) {
      const expected = calculateUnrealizedPnL({
        entry_price: Number(row.entry_price),
        current_price: Number(row.current_price),
        quantity: Number(row.quantity),
        multiplier: Number(row.multiplier),
        position_side: row.position_side,
      });

      const stored = Number(row.unrealized_pnl);
      const diff = Math.abs(expected - stored);
      const pctDiff = stored !== 0 ? (diff / Math.abs(stored)) * 100 : diff > 0 ? 100 : 0;

      if (diff > DRIFT_THRESHOLD_DOLLARS && pctDiff > DRIFT_THRESHOLD_PERCENT) {
        driftCount++;
        logger.warn('PnL drift detected (open position)', {
          positionId: row.position_id,
          stored,
          expected,
          diff,
          pctDiff: pctDiff.toFixed(2),
          positionSide: row.position_side,
        });
      }
    }

    if (driftCount > 0) {
      logger.warn('PnL reconciliation: open positions with drift', {
        driftCount,
        totalChecked: result.rows.length,
      });
    } else {
      logger.debug('PnL reconciliation: all open positions match', {
        totalChecked: result.rows.length,
      });
    }
  }
}
