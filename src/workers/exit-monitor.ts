// Exit Monitor Worker - Creates exit orders when positions meet exit rules
import { db } from '../services/database.service.js';
import { marketData } from '../services/market-data.js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/sleep.js';
import { publishPositionUpdate, publishRiskUpdate } from '../services/realtime-updates.service.js';
import * as Sentry from '@sentry/node';
import { registerWorkerErrorHandlers } from '../services/worker-observability.service.js';
import { updateWorkerStatus } from '../services/trade-engine-health.service.js';
import { config } from '../config/index.js';
import { evaluateExitDecision } from '../lib/exitEngine/index.js';
import { buildExitDecisionInput } from '../lib/exitEngine/position-adapter.js';
import { evaluateExitAdjustments } from '../services/exit-intelligence/index.js';
import { getCurrentState } from '../services/bias-state-aggregator/bias-state-aggregator.service.js';

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
  engine?: 'A' | 'B' | null;
  experiment_id?: string | null;
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
    registerWorkerErrorHandlers('ExitMonitorWorker');
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
      Sentry.captureException(error, { tags: { worker: 'ExitMonitorWorker' } });
    });

    logger.info('Exit monitor worker started', { intervalMs });
    updateWorkerStatus('ExitMonitorWorker', { running: true });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Exit monitor worker stopped');
      updateWorkerStatus('ExitMonitorWorker', { running: false });
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
    updateWorkerStatus('ExitMonitorWorker', { lastRunAt: new Date() });

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
          const [currentPrice, underlyingPrice] = await Promise.all([
            marketData.getOptionPrice(
              position.symbol,
              position.strike,
              new Date(position.expiration),
              position.type
            ),
            marketData.getStockPrice(position.symbol),
          ]);

          if (currentPrice == null || !Number.isFinite(currentPrice)) {
            logger.debug('Exit monitor skipped - no option price available', {
              positionId: position.position_id,
              symbol: position.symbol,
              optionSymbol: position.option_symbol,
            });
            continue;
          }

          const unrealizedPnl =
            (currentPrice - position.entry_price) * position.quantity * 100;
          const costBasis = position.entry_price * position.quantity * 100;
          const pnlPercent = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0;

          const hoursInPosition =
            (now.getTime() - new Date(position.entry_timestamp).getTime()) / 3600000;
          const timeInTradeMinutes = hoursInPosition * 60;
          const daysToExpiration =
            (new Date(position.expiration).getTime() - now.getTime()) / 86400000;

          let exitReason: string | null = null;
          let exitQuantity = position.quantity;
          let exitIntelligenceAudit: { reasonCodes: string[]; finalExitAction: string } | null = null;

          // Exit Intelligence: bias-aware adjustments (runs before stop/target evaluation)
          if (config.enableExitIntelligence && !exitReason) {
            const marketState = await getCurrentState(position.symbol);
            const adjustments = evaluateExitAdjustments({
              openPosition: {
                positionId: position.position_id,
                symbol: position.symbol,
                direction: position.type === 'call' ? 'long' : 'short',
                type: position.type,
                quantity: position.quantity,
                entryPrice: position.entry_price,
                entryTimestamp: new Date(position.entry_timestamp),
                entryRegimeType: (position as { entry_regime_type?: string }).entry_regime_type,
                entryStrategyType: (position as { entry_mode_hint?: string }).entry_mode_hint as
                  | 'BREAKOUT'
                  | 'PULLBACK'
                  | 'MEAN_REVERT'
                  | undefined,
              },
              marketState,
              unrealizedPnL: unrealizedPnl,
              unrealizedPnLPercent: pnlPercent,
              timeInTradeMinutes,
              strategyType: 'SWING',
            });
            exitIntelligenceAudit = {
              reasonCodes: adjustments.reasonCodes,
              finalExitAction: adjustments.audit.finalExitAction,
            };
            if (adjustments.forceFullExit) {
              exitReason =
                adjustments.reasonCodes[0]?.toLowerCase().replace(/_/g, ' ') ?? 'exit_intelligence';
              exitQuantity = position.quantity;
            } else if (adjustments.forcePartialExit !== undefined) {
              exitQuantity = Math.max(1, Math.round(position.quantity * adjustments.forcePartialExit));
              exitReason =
                adjustments.reasonCodes[0]?.toLowerCase().replace(/_/g, ' ') ?? 'exit_intelligence_partial';
            }
          }

          if (!exitReason && config.enableExitDecisionEngine) {
            const underlying = Number.isFinite(underlyingPrice) ? underlyingPrice : position.entry_price * 100;
            const input = buildExitDecisionInput(
              position,
              rule,
              {
                underlyingPrice: underlying,
                optionMid: currentPrice,
              },
              now
            );
            const result = evaluateExitDecision(input);
            if (result.action === 'FULL_EXIT' || result.action === 'PARTIAL_EXIT') {
              exitReason =
                result.triggeredRules.length > 0
                  ? result.triggeredRules[0].rule.toLowerCase()
                  : 'exit_engine';
              if (result.action === 'PARTIAL_EXIT' && result.sizePercent !== undefined) {
                exitQuantity = Math.max(
                  1,
                  Math.round(position.quantity * (result.sizePercent / 100))
                );
              } else {
                exitQuantity = position.quantity;
              }
            }
          }

          if (!exitReason) {
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
          }

          if (!exitReason) {
            continue;
          }

          // Atomic position update + exit order creation to prevent double-close race
          const isPartialExit = exitQuantity < position.quantity;
          let updateResult;
          if (isPartialExit) {
            updateResult = await db.query(
              `UPDATE refactored_positions
               SET quantity = quantity - $1,
                   last_updated = $2
               WHERE position_id = $3 AND status = 'open' AND quantity >= $1
               RETURNING position_id`,
              [exitQuantity, now, position.position_id]
            );
          } else {
            updateResult = await db.query(
              `UPDATE refactored_positions
               SET status = $1,
                   exit_reason = $2,
                   last_updated = $3
               WHERE position_id = $4 AND status = 'open'
               RETURNING position_id`,
              ['closing', exitReason, now, position.position_id]
            );
          }

          // Guard: if no rows updated, another process already closed/is closing this position
          if (!updateResult.rows.length) {
            logger.info('Position already closing/closed, skipping exit order', {
              positionId: position.position_id,
              exitReason,
            });
            continue;
          }

          await publishPositionUpdate(position.position_id);
          await publishRiskUpdate();

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
              null,
              position.symbol,
              position.option_symbol,
              position.strike,
              position.expiration,
              position.type,
              exitQuantity,
              position.engine ?? null,
              position.experiment_id ?? null,
              'paper',
              'pending_execution',
            ]
          );

          if (exitIntelligenceAudit) {
            logger.info('Exit intelligence applied', {
              positionId: position.position_id,
              reasonCodes: exitIntelligenceAudit.reasonCodes,
              finalExitAction: exitIntelligenceAudit.finalExitAction,
              exitQuantity,
              isPartial: isPartialExit,
            });
          }

          exitsCreated += 1;
        } catch (error) {
          // Skip position if market data unavailable (missing API keys)
          logger.debug('Exit monitor skipped - market data unavailable', {
            positionId: position.position_id,
            symbol: position.symbol
          });
          Sentry.captureException(error, {
            tags: { worker: 'ExitMonitorWorker', positionId: position.position_id },
          });
          // Don't track as error if it's just missing API keys
        }
      }

      logger.info('Exit monitor completed', {
        exitsCreated,
        durationMs: Date.now() - startTime,
      });
    } finally {
      updateWorkerStatus('ExitMonitorWorker', {
        lastDurationMs: Date.now() - startTime,
      });
      this.isRunning = false;
    }
  }
}
