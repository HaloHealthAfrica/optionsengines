// Paper Executor Worker - Executes paper orders and updates positions
import { db } from '../services/database.service.js';
import { marketData } from '../services/market-data.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { sleep } from '../utils/sleep.js';
import { errorTracker } from '../services/error-tracker.service.js';
import { publishPositionUpdate, publishRiskUpdate } from '../services/realtime-updates.service.js';
import { captureTradeOutcome } from '../services/performance-feedback/index.js';
import { getCurrentState } from '../services/bias-state-aggregator/bias-state-aggregator.service.js';
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

async function fetchOptionPrice(
  symbol: string,
  strike: number,
  expiration: Date,
  optionType: 'call' | 'put'
): Promise<number | null> {
  return marketData.getOptionPrice(symbol, strike, expiration, optionType);
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
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Paper executor worker stopped');
      updateWorkerStatus('PaperExecutorWorker', { running: false });
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
          const price = await fetchOptionPrice(
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
            const costBasis = existingPosition.entry_price * existingPosition.quantity * 100;
            const pnlPercent = costBasis > 0 ? (realizedPnl / costBasis) * 100 : 0;
            const pnlR = costBasis > 0 ? realizedPnl / (costBasis * 0.01) : 0;
            const entryTs = new Date(existingPosition.entry_timestamp);
            const durationMinutes = Math.max(
              0,
              (fillTimestamp.getTime() - entryTs.getTime()) / 60_000
            );

            await db.query(
              `UPDATE refactored_positions
               SET status = $1,
                   exit_timestamp = $2,
                   realized_pnl = $3,
                   last_updated = $2
               WHERE position_id = $4`,
              ['closed', fillTimestamp, realizedPnl, existingPosition.position_id]
            );

            captureTradeOutcome({
              positionId: existingPosition.position_id,
              symbol: existingPosition.symbol,
              direction: existingPosition.type === 'call' ? 'long' : 'short',
              entryBiasScore: existingPosition.entry_bias_score,
              entryMacroClass: (existingPosition as { entry_macro_class?: string }).entry_macro_class,
              entryRegime: existingPosition.entry_regime_type,
              entryIntent: existingPosition.entry_mode_hint,
              entryAcceleration: existingPosition.entry_acceleration_state_strength_delta,
              pnlR,
              pnlPercent,
              durationMinutes: Math.round(durationMinutes),
              exitReasonCodes: existingPosition.exit_reason
                ? [String(existingPosition.exit_reason)]
                : [],
              timestamp: fillTimestamp,
            }).catch((err) => logger.warn('Performance capture failed', { err, positionId: existingPosition.position_id }));

            await publishPositionUpdate(existingPosition.position_id);
            await publishRiskUpdate();
          } else {
            let entryMacroClass: string | null = null;
            let entryAccel: number | null = null;
            try {
              const biasState = await getCurrentState(order.symbol);
              if (biasState) {
                entryMacroClass = biasState.macroClass;
                entryAccel = biasState.acceleration?.stateStrengthDelta ?? null;
              }
            } catch {
              /* optional */
            }

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
                last_updated,
                entry_macro_class,
                entry_acceleration_state_strength_delta
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12, $13)
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
                entryMacroClass,
                entryAccel,
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
