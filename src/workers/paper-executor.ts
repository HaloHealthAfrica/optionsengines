// Paper Executor Worker - Executes paper orders and updates positions
import { db } from '../services/database.service.js';
import { marketData } from '../services/market-data.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { sleep } from '../utils/sleep.js';
import { errorTracker } from '../services/error-tracker.service.js';
import { publishPositionUpdate, publishRiskUpdate } from '../services/realtime-updates.service.js';
import * as Sentry from '@sentry/node';
import { registerWorkerErrorHandlers } from '../services/worker-observability.service.js';
import { updateWorkerStatus } from '../services/trade-engine-health.service.js';

interface PendingOrder {
  order_id: string;
  signal_id: string | null;
  symbol: string;
  option_symbol: string;
  strike: number;
  expiration: Date;
  type: 'call' | 'put';
  quantity: number;
  engine?: 'A' | 'B' | null;
  experiment_id?: string | null;
}

async function fetchOptionPriceWithRetry(
  symbol: string,
  strike: number,
  expiration: Date,
  optionType: 'call' | 'put',
  maxRetries: number = 3
): Promise<number | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await marketData.getOptionPrice(symbol, strike, expiration, optionType);
    } catch (error) {
      if (attempt === maxRetries) {
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }

  return null;
}

export class PaperExecutorWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  start(intervalMs: number): void {
    registerWorkerErrorHandlers('PaperExecutorWorker');
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.run().catch((error) => {
        logger.error('Paper executor worker failed', error);
      });
    }, intervalMs);

    this.run().catch((error) => {
      logger.error('Paper executor worker failed on startup', error);
      Sentry.captureException(error, { tags: { worker: 'PaperExecutorWorker' } });
    });

    logger.info('Paper executor worker started', { intervalMs });
    updateWorkerStatus('PaperExecutorWorker', { running: true });
    Sentry.captureMessage('WORKER_START', {
      level: 'info',
      tags: { worker: 'PaperExecutorWorker' },
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Paper executor worker stopped');
      updateWorkerStatus('PaperExecutorWorker', { running: false });
      Sentry.captureMessage('WORKER_STOP', {
        level: 'info',
        tags: { worker: 'PaperExecutorWorker' },
      });
    }
  }

  async stopAndDrain(timeoutMs: number): Promise<void> {
    this.stop();
    const startedAt = Date.now();
    while (this.isRunning && Date.now() - startedAt < timeoutMs) {
      await sleep(50);
    }
    if (this.isRunning) {
      logger.warn('Paper executor did not stop before timeout');
    }
  }

  async run(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Paper executor already running, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    updateWorkerStatus('PaperExecutorWorker', { lastRunAt: new Date() });

    try {
      const orders = await db.query<PendingOrder>(
        `SELECT * FROM orders WHERE status = $1 AND order_type = $2 ORDER BY created_at ASC LIMIT 100`,
        ['pending_execution', 'paper']
      );

      if (orders.rows.length === 0) {
        return;
      }

      let filled = 0;
      let failed = 0;
      let remainingTrades = Number.POSITIVE_INFINITY;

      if (config.maxDailyTrades > 0) {
        const tradeCountResult = await db.query(
          `SELECT COUNT(*)::int AS count
           FROM trades t
           JOIN orders o ON o.order_id = t.order_id
           WHERE o.order_type = $1
             AND t.fill_timestamp >= CURRENT_DATE`,
          ['paper']
        );
        const tradeCount = tradeCountResult.rows[0]?.count || 0;
        remainingTrades = Math.max(0, config.maxDailyTrades - tradeCount);

        if (remainingTrades <= 0) {
          logger.warn('Daily trade cap reached, skipping executions', {
            maxDailyTrades: config.maxDailyTrades,
            tradeCount,
          });
          return;
        }
      }

      const maxOrders =
        remainingTrades === Number.POSITIVE_INFINITY
          ? orders.rows.length
          : Math.min(orders.rows.length, Math.max(0, remainingTrades));
      const limitedOrders = orders.rows.slice(0, maxOrders);
      const batchSize = Math.max(1, config.paperExecutorBatchSize);

      const processOrder = async (order: PendingOrder): Promise<'filled' | 'failed'> => {
        try {
          const price = await fetchOptionPriceWithRetry(
            order.symbol,
            order.strike,
            new Date(order.expiration),
            order.type
          );

          if (price === null) {
            await db.query(
              `UPDATE orders SET status = $1 WHERE order_id = $2`,
              ['failed', order.order_id]
            );
            return 'failed';
          }

          const fillTimestamp = new Date();

          await db.query(
            `INSERT INTO trades (order_id, fill_price, fill_quantity, fill_timestamp, commission, engine, experiment_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              order.order_id,
              price,
              order.quantity,
              fillTimestamp,
              0,
              order.engine ?? null,
              order.experiment_id ?? null,
            ]
          );

          await db.query(
            `UPDATE orders SET status = $1 WHERE order_id = $2`,
            ['filled', order.order_id]
          );

          const existingPositionResult = await db.query(
            `SELECT * FROM refactored_positions 
             WHERE option_symbol = $1 AND status IN ('open', 'closing')
             ORDER BY entry_timestamp DESC LIMIT 1`,
            [order.option_symbol]
          );

          const existingPosition = existingPositionResult.rows[0];
          if (existingPosition && existingPosition.status === 'closing') {
            const realizedPnl =
              (price - existingPosition.entry_price) * existingPosition.quantity * 100;

            await db.query(
              `UPDATE refactored_positions
               SET status = $1,
                   exit_timestamp = $2,
                   realized_pnl = $3,
                   last_updated = $2
               WHERE position_id = $4`,
              ['closed', fillTimestamp, realizedPnl, existingPosition.position_id]
            );
            await publishPositionUpdate(existingPosition.position_id);
            await publishRiskUpdate();
          } else {
            const insertResult = await db.query(
              `INSERT INTO refactored_positions (
                symbol,
                option_symbol,
                strike,
                expiration,
                type,
                quantity,
                entry_price,
                engine,
                experiment_id,
                status,
                entry_timestamp,
                last_updated
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
              RETURNING position_id`,
              [
                order.symbol,
                order.option_symbol,
                order.strike,
                order.expiration,
                order.type,
                order.quantity,
                price,
                order.engine ?? null,
                order.experiment_id ?? null,
                'open',
                fillTimestamp,
              ]
            );
            const positionId = insertResult.rows[0]?.position_id;
            if (positionId) {
              await publishPositionUpdate(positionId);
              await publishRiskUpdate();
            }
          }

          return 'filled';
        } catch (error) {
          logger.error('Paper execution failed', error, { orderId: order.order_id });
          errorTracker.recordError('paper_executor');
          Sentry.captureException(error, {
            tags: { worker: 'PaperExecutorWorker', orderId: order.order_id },
          });
          await db.query(`UPDATE orders SET status = $1 WHERE order_id = $2`, [
            'failed',
            order.order_id,
          ]);
          return 'failed';
        }
      };

      for (let i = 0; i < limitedOrders.length; i += batchSize) {
        const batch = limitedOrders.slice(i, i + batchSize);
        const results = await Promise.all(batch.map((order) => processOrder(order)));
        filled += results.filter((status) => status === 'filled').length;
        failed += results.filter((status) => status === 'failed').length;
        if (filled >= remainingTrades) {
          logger.warn('Daily trade cap reached mid-run, stopping executions', {
            maxDailyTrades: config.maxDailyTrades,
            filled,
          });
          break;
        }
      }

      logger.info('Paper execution completed', {
        filled,
        failed,
        durationMs: Date.now() - startTime,
      });
    } finally {
      updateWorkerStatus('PaperExecutorWorker', {
        lastDurationMs: Date.now() - startTime,
      });
      this.isRunning = false;
    }
  }
}
