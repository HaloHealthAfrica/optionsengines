// Position Refresher Worker - Updates open positions with current prices and P&L
import { db } from '../services/database.service.js';
import { marketData } from '../services/market-data.js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/sleep.js';
import { errorTracker } from '../services/error-tracker.service.js';
import { publishPositionUpdate, publishRiskUpdate } from '../services/realtime-updates.service.js';
import * as Sentry from '@sentry/node';
import { registerWorkerErrorHandlers } from '../services/worker-observability.service.js';
import { updateWorkerStatus } from '../services/trade-engine-health.service.js';

interface OpenPosition {
  position_id: string;
  symbol: string;
  option_symbol: string;
  strike: number;
  expiration: Date;
  type: 'call' | 'put';
  quantity: number;
  entry_price: number;
}

export class PositionRefresherWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  start(intervalMs: number): void {
    registerWorkerErrorHandlers('PositionRefresherWorker');
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.run().catch((error) => {
        logger.error('Position refresher worker failed', error);
      });
    }, intervalMs);

    this.run().catch((error) => {
      logger.error('Position refresher worker failed on startup', error);
      Sentry.captureException(error, { tags: { worker: 'PositionRefresherWorker' } });
    });

    logger.info('Position refresher worker started', { intervalMs });
    updateWorkerStatus('PositionRefresherWorker', { running: true });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Position refresher worker stopped');
      updateWorkerStatus('PositionRefresherWorker', { running: false });
    }
  }

  async stopAndDrain(timeoutMs: number): Promise<void> {
    this.stop();
    const startedAt = Date.now();
    while (this.isRunning && Date.now() - startedAt < timeoutMs) {
      await sleep(50);
    }
    if (this.isRunning) {
      logger.warn('Position refresher did not stop before timeout');
    }
  }

  async run(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Position refresher already running, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    updateWorkerStatus('PositionRefresherWorker', { lastRunAt: new Date() });

    try {
      const positions = await db.query<OpenPosition>(
        `SELECT * FROM refactored_positions WHERE status = $1 ORDER BY entry_timestamp ASC LIMIT 200`,
        ['open']
      );

      if (positions.rows.length === 0) {
        return;
      }

      let updated = 0;

      for (const position of positions.rows) {
        try {
          const currentPrice = await marketData.getOptionPrice(
            position.symbol,
            position.strike,
            new Date(position.expiration),
            position.type
          );

          if (currentPrice == null || !Number.isFinite(currentPrice)) {
            continue;
          }

          const unrealizedPnl =
            (currentPrice - position.entry_price) * position.quantity * 100;
          const costBasis = position.entry_price * position.quantity * 100;
          const positionPnlPercent = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0;

          await db.query(
            `UPDATE refactored_positions
             SET current_price = $1,
                 unrealized_pnl = $2,
                 position_pnl_percent = $3,
                 last_updated = $4
             WHERE position_id = $5`,
            [currentPrice, unrealizedPnl, positionPnlPercent, new Date(), position.position_id]
          );

          await publishPositionUpdate(position.position_id);
          await publishRiskUpdate();

          updated += 1;
        } catch (error) {
          logger.warn('Position refresh failed', { positionId: position.position_id });
          errorTracker.recordError('position_refresher');
          Sentry.captureException(error, {
            tags: { worker: 'PositionRefresherWorker', positionId: position.position_id },
          });
        }
      }

      logger.info('Position refresh completed', {
        updated,
        durationMs: Date.now() - startTime,
      });
    } finally {
      updateWorkerStatus('PositionRefresherWorker', {
        lastDurationMs: Date.now() - startTime,
      });
      this.isRunning = false;
    }
  }
}
