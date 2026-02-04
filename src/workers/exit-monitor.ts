// Exit Monitor Worker - Creates exit orders when positions meet exit rules
import { db } from '../services/database.service.js';
import { marketData } from '../services/market-data.js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/sleep.js';
import { errorTracker } from '../services/error-tracker.service.js';

interface OpenPosition {
  position_id: string;
  symbol: string;
  option_symbol: string;
  strike: number;
  expiration: Date;
  type: 'call' | 'put';
  quantity: number;
  entry_price: number;
  entry_timestamp: Date;
  status: 'open' | 'closing' | 'closed';
}

interface ExitRule {
  profit_target_percent?: number;
  stop_loss_percent?: number;
  max_hold_time_hours?: number;
  min_dte_exit?: number;
}

export class ExitMonitorWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  start(intervalMs: number): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.run().catch((error) => {
        logger.error('Exit monitor worker failed', error);
      });
    }, intervalMs);

    this.run().catch((error) => {
      logger.error('Exit monitor worker failed on startup', error);
    });

    logger.info('Exit monitor worker started', { intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Exit monitor worker stopped');
    }
  }

  async stopAndDrain(timeoutMs: number): Promise<void> {
    this.stop();
    const startedAt = Date.now();
    while (this.isRunning && Date.now() - startedAt < timeoutMs) {
      await sleep(50);
    }
    if (this.isRunning) {
      logger.warn('Exit monitor did not stop before timeout');
    }
  }

  async run(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Exit monitor already running, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      const ruleResult = await db.query<ExitRule>(
        `SELECT * FROM exit_rules WHERE enabled = true ORDER BY created_at DESC LIMIT 1`
      );
      const rule = ruleResult.rows[0];
      if (!rule) {
        return;
      }

      const positions = await db.query<OpenPosition>(
        `SELECT * FROM refactored_positions WHERE status = $1 ORDER BY entry_timestamp ASC LIMIT 200`,
        ['open']
      );

      if (positions.rows.length === 0) {
        return;
      }

      let exitsCreated = 0;

      for (const position of positions.rows) {
        try {
          const now = new Date();
          const currentPrice = await marketData.getOptionPrice(
            position.symbol,
            position.strike,
            new Date(position.expiration),
            position.type
          );

          const unrealizedPnl =
            (currentPrice - position.entry_price) * position.quantity * 100;
          const costBasis = position.entry_price * position.quantity * 100;
          const pnlPercent = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0;

          const hoursInPosition =
            (now.getTime() - new Date(position.entry_timestamp).getTime()) / 3600000;
          const daysToExpiration =
            (new Date(position.expiration).getTime() - now.getTime()) / 86400000;

          let exitReason: string | null = null;

          if (
            rule.profit_target_percent !== undefined &&
            pnlPercent >= rule.profit_target_percent
          ) {
            exitReason = 'profit_target';
          } else if (
            rule.stop_loss_percent !== undefined &&
            pnlPercent <= -Math.abs(rule.stop_loss_percent)
          ) {
            exitReason = 'stop_loss';
          } else if (
            rule.max_hold_time_hours !== undefined &&
            hoursInPosition >= rule.max_hold_time_hours
          ) {
            exitReason = 'max_hold_time';
          } else if (
            rule.min_dte_exit !== undefined &&
            daysToExpiration <= rule.min_dte_exit
          ) {
            exitReason = 'min_dte_exit';
          }

          if (!exitReason) {
            continue;
          }

          await db.query(
            `UPDATE refactored_positions
             SET status = $1,
                 exit_reason = $2,
                 last_updated = $3
             WHERE position_id = $4`,
            ['closing', exitReason, now, position.position_id]
          );

          await db.query(
            `INSERT INTO orders (
              signal_id,
              symbol,
              option_symbol,
              strike,
              expiration,
              type,
              quantity,
              order_type,
              status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              null,
              position.symbol,
              position.option_symbol,
              position.strike,
              position.expiration,
              position.type,
              position.quantity,
              'paper',
              'pending_execution',
            ]
          );

          exitsCreated += 1;
        } catch (error) {
          logger.error('Exit monitor failed for position', error, {
            positionId: position.position_id,
          });
          errorTracker.recordError('exit_monitor');
        }
      }

      logger.info('Exit monitor completed', {
        exitsCreated,
        durationMs: Date.now() - startTime,
      });
    } finally {
      this.isRunning = false;
    }
  }
}
