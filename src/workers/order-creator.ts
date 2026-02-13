// Order Creator Worker - Creates paper orders from approved signals
import { db } from '../services/database.service.js';
import { marketData } from '../services/market-data.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { sleep } from '../utils/sleep.js';
import { errorTracker } from '../services/error-tracker.service.js';
import * as Sentry from '@sentry/node';
import { registerWorkerErrorHandlers } from '../services/worker-observability.service.js';
import { updateWorkerStatus } from '../services/trade-engine-health.service.js';

interface ApprovedSignal {
  signal_id: string;
  symbol: string;
  direction: 'long' | 'short';
  timeframe: string;
  timestamp: Date;
  experiment_id?: string | null;
  engine?: 'A' | 'B' | null;
}

function calculateExpiration(dteDays: number): Date {
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + dteDays);

  const day = base.getUTCDay();
  const daysUntilFriday = (5 - day + 7) % 7;
  base.setUTCDate(base.getUTCDate() + daysUntilFriday);
  base.setUTCHours(0, 0, 0, 0);

  return base;
}

function calculateStrike(price: number, direction: 'long' | 'short'): number {
  if (direction === 'long') {
    return Math.ceil(price);
  }
  return Math.floor(price);
}

function buildOptionSymbol(
  symbol: string,
  expiration: Date,
  type: 'call' | 'put',
  strike: number
): string {
  const yyyy = expiration.getUTCFullYear().toString();
  const mm = String(expiration.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(expiration.getUTCDate()).padStart(2, '0');
  return `${symbol}-${yyyy}${mm}${dd}-${type.toUpperCase()}-${strike.toFixed(2)}`;
}

export class OrderCreatorWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  start(intervalMs: number): void {
    registerWorkerErrorHandlers('OrderCreatorWorker');
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.run().catch((error) => {
        logger.error('Order creator worker failed', error);
      });
    }, intervalMs);

    this.run().catch((error) => {
      logger.error('Order creator worker failed on startup', error);
      Sentry.captureException(error, { tags: { worker: 'OrderCreatorWorker' } });
    });

    logger.info('Order creator worker started', { intervalMs });
    updateWorkerStatus('OrderCreatorWorker', { running: true });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Order creator worker stopped');
      updateWorkerStatus('OrderCreatorWorker', { running: false });
    }
  }

  async stopAndDrain(timeoutMs: number): Promise<void> {
    this.stop();
    const startedAt = Date.now();
    while (this.isRunning && Date.now() - startedAt < timeoutMs) {
      await sleep(50);
    }
    if (this.isRunning) {
      logger.warn('Order creator did not stop before timeout');
    }
  }

  async run(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Order creator already running, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    updateWorkerStatus('OrderCreatorWorker', { lastRunAt: new Date() });

    try {
      const signals = await db.query<ApprovedSignal>(
        `SELECT s.signal_id, s.symbol, s.direction, s.timeframe, s.timestamp,
                s.experiment_id, e.variant AS engine
         FROM signals s
         LEFT JOIN experiments e ON e.signal_id = s.signal_id
         LEFT JOIN orders o ON o.signal_id = s.signal_id
         WHERE s.status = $1 AND o.order_id IS NULL
         ORDER BY s.created_at ASC
         LIMIT 100`,
        ['approved']
      );

      if (signals.rows.length === 0) {
        return;
      }

      let created = 0;

      const riskLimitsResult = await db.query(
        `SELECT * FROM risk_limits WHERE enabled = true ORDER BY created_at DESC LIMIT 1`
      );
      const riskLimit = riskLimitsResult.rows[0] || {};
      const maxPositionSize = riskLimit.max_position_size || config.maxPositionSize || 1;
      const openPositionsResult = await db.query(
        `SELECT COUNT(*)::int AS count FROM refactored_positions WHERE status IN ('open', 'closing')`
      );
      const openPositions = openPositionsResult.rows[0]?.count || 0;
      const capacityRatio =
        config.maxOpenPositions > 0
          ? Math.max(0.25, (config.maxOpenPositions - openPositions) / config.maxOpenPositions)
          : 1;

      for (const signal of signals.rows) {
        try {
          const price = await marketData.getStockPrice(signal.symbol);
          const strike = calculateStrike(price, signal.direction);
          const expiration = calculateExpiration(config.maxHoldDays);
          const optionType = signal.direction === 'long' ? 'call' : 'put';
          const optionSymbol = buildOptionSymbol(signal.symbol, expiration, optionType, strike);

          const quantity = Math.max(1, Math.floor(maxPositionSize * capacityRatio));

          const engine = signal.engine ?? 'A';
          const experimentId = signal.experiment_id ?? null;

          await db.query(
            `INSERT INTO orders (
              signal_id,
              symbol,
              option_symbol,
              strike,
              expiration,
              type,
              quantity,
              engine,
              experiment_id,
              order_type,
              status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              signal.signal_id,
              signal.symbol,
              optionSymbol,
              strike,
              expiration,
              optionType,
              quantity,
              engine,
              experimentId,
              'paper',
              'pending_execution',
            ]
          );

          created += 1;
        } catch (error) {
          logger.error('Order creation failed', error, { signalId: signal.signal_id });
          errorTracker.recordError('order_creator');
          Sentry.captureException(error, {
            tags: { worker: 'OrderCreatorWorker', signalId: signal.signal_id },
          });
        }
      }

      logger.info('Order creation completed', {
        created,
        durationMs: Date.now() - startTime,
      });
    } finally {
      updateWorkerStatus('OrderCreatorWorker', {
        lastDurationMs: Date.now() - startTime,
      });
      this.isRunning = false;
    }
  }
}
