// Exit Monitor Worker - Creates exit orders when positions meet exit rules
// P0 Hardened: staleness-aware pricing, stuck position cleanup, idempotent exits,
// emergency kill switch, transactional exit orders, risk alerts
import { db } from '../services/database.service.js';
import { marketData } from '../services/market-data.js';
import { logger } from '../utils/logger.js';
import { calculateUnrealizedPnL } from '../lib/pnl/calculate-realized-pnl.js';
import { sleep } from '../utils/sleep.js';
import { publishPositionUpdate, publishRiskUpdate } from '../services/realtime-updates.service.js';
import * as Sentry from '@sentry/node';
import { registerWorkerErrorHandlers } from '../services/worker-observability.service.js';
import { updateWorkerStatus } from '../services/trade-engine-health.service.js';
import { config } from '../config/index.js';
import { evaluateExitDecision } from '../lib/exitEngine/index.js';
import { buildExitDecisionInput, type GEXState } from '../lib/exitEngine/position-adapter.js';
import { positioningService } from '../services/positioning.service.js';
import { evaluateExitAdjustments } from '../services/exit-intelligence/index.js';
import { getCurrentState } from '../services/bias-state-aggregator/bias-state-aggregator.service.js';
import { shadowExecutor } from '../services/shadow-executor.service.js';
import { sendRiskAlert } from '../services/alert.service.js';

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
  high_water_mark?: number | null;
  trailing_stop_price?: number | null;
  position_side?: string | null;
  multiplier?: number | null;
  greeks_at_entry?: Record<string, number> | null;
  iv_at_entry?: number | null;
}

interface ExitRule {
  profit_target_percent?: number;
  stop_loss_percent?: number;
  max_hold_time_hours?: number;
  min_dte_exit?: number;
  trailing_stop_percent?: number;
  trailing_stop_activation_percent?: number;
}

/** P0: Stale-price stop tightening factor — when using stale data, stops are tightened by this multiplier */
const STALE_PRICE_STOP_TIGHTENING = 0.5;
/** P0: If stale price age exceeds this, force-close losing positions */
const STALE_FORCE_CLOSE_AGE_MS = 180_000;

export class ExitMonitorWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private consecutiveStaleCount = 0;

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
      // P0: Emergency kill switch — force-close everything
      if (config.emergencyRiskOff) {
        await this.emergencyCloseAll();
        return;
      }

      const ruleResult = await db.query<ExitRule>(
        `SELECT * FROM exit_rules WHERE enabled = true ORDER BY created_at DESC LIMIT 1`
      );
      const rule = ruleResult.rows[0];
      const positions = await db.query<OpenPosition>(
        `SELECT * FROM refactored_positions WHERE status = $1 ORDER BY entry_timestamp ASC LIMIT 200`,
        ['open']
      );

      let exitsCreated = 0;
      let staleSkips = 0;
      if (rule && positions.rows.length > 0) {
      for (const position of positions.rows) {
        try {
          const now = new Date();

          // P0: Use staleness-aware price fetching
          const [optionResult, underlyingResult] = await Promise.all([
            marketData.getOptionPriceWithStaleness(
              position.symbol,
              position.strike,
              new Date(position.expiration),
              position.type
            ),
            marketData.getStockPriceWithStaleness(position.symbol),
          ]);

          const currentPrice = optionResult.price;
          const underlyingPrice = underlyingResult.price;
          const priceIsStale = optionResult.stale;

          if (currentPrice == null || !Number.isFinite(currentPrice)) {
            logger.warn('Exit monitor: no price available (fresh or stale)', {
              positionId: position.position_id,
              symbol: position.symbol,
              optionSymbol: position.option_symbol,
            });
            staleSkips++;
            continue;
          }

          // P0: If price is stale and very old, force-close losing positions
          if (priceIsStale && optionResult.ageMs > STALE_FORCE_CLOSE_AGE_MS) {
            const costBasis = position.entry_price * position.quantity * (position.multiplier ?? 100);
            const roughPnl = calculateUnrealizedPnL({
              entry_price: position.entry_price,
              current_price: currentPrice,
              quantity: position.quantity,
              multiplier: position.multiplier ?? 100,
              position_side: position.position_side ?? 'LONG',
            });
            const roughPnlPct = costBasis > 0 ? (roughPnl / costBasis) * 100 : 0;

            if (roughPnlPct < -10) {
              logger.error('STALE PRICE + LOSING POSITION — force closing', {
                positionId: position.position_id,
                symbol: position.symbol,
                staleAgeMs: optionResult.ageMs,
                roughPnlPct,
              });
              await this.createExitOrder(position, 'stale_data_force_close', position.quantity, now);
              exitsCreated++;
              await sendRiskAlert({
                type: 'STALE_PRICE_FORCE_CLOSE',
                symbol: position.symbol,
                details: `Position ${position.position_id} force-closed: stale price (${Math.round(optionResult.ageMs / 1000)}s old), P&L ${roughPnlPct.toFixed(1)}%`,
              }).catch(() => {});
              continue;
            }
          }

          const unrealizedPnl = calculateUnrealizedPnL({
            entry_price: position.entry_price,
            current_price: currentPrice,
            quantity: position.quantity,
            multiplier: position.multiplier ?? 100,
            position_side: position.position_side ?? 'LONG',
          });
          const costBasis = position.entry_price * position.quantity * (position.multiplier ?? 100);
          const pnlPercent = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0;

          const hoursInPosition =
            (now.getTime() - new Date(position.entry_timestamp).getTime()) / 3600000;
          const timeInTradeMinutes = hoursInPosition * 60;
          const daysToExpiration =
            (new Date(position.expiration).getTime() - now.getTime()) / 86400000;

          let exitReason: string | null = null;
          let exitQuantity = position.quantity;
          let exitIntelligenceAudit: { reasonCodes: string[]; finalExitAction: string } | null = null;

          if (daysToExpiration <= 0) {
            exitReason = '0dte_force_close';
            exitQuantity = position.quantity;
            logger.warn('0DTE force-close triggered', {
              positionId: position.position_id,
              symbol: position.symbol,
              expiration: position.expiration,
              daysToExpiration,
            });
          }

          // Grace period: skip all exit logic (except 0DTE) if position was just opened
          if (!exitReason && timeInTradeMinutes < config.minHoldMinutesBeforeExit) {
            continue;
          }

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

          const isShortPosition = (position.position_side ?? 'LONG') === 'SHORT';

          // P0: Trailing stop with stale-data tightening
          if (!exitReason && position.trailing_stop_price) {
            let effectiveTrailingStop = position.trailing_stop_price;
            if (priceIsStale) {
              // When data is stale, tighten the trailing stop toward entry price
              const tightenAmount = Math.abs(position.entry_price - position.trailing_stop_price) * STALE_PRICE_STOP_TIGHTENING;
              effectiveTrailingStop = isShortPosition
                ? position.trailing_stop_price - tightenAmount
                : position.trailing_stop_price + tightenAmount;
              logger.info('Stale data: tightened trailing stop', {
                positionId: position.position_id,
                originalStop: position.trailing_stop_price,
                effectiveStop: effectiveTrailingStop,
                staleAgeMs: optionResult.ageMs,
              });
            }

            const trailingStopBreached = isShortPosition
              ? currentPrice >= effectiveTrailingStop
              : currentPrice <= effectiveTrailingStop;
            if (trailingStopBreached) {
              exitReason = priceIsStale ? 'trailing_stop_stale' : 'trailing_stop';
              exitQuantity = position.quantity;
              logger.info('Trailing stop triggered', {
                positionId: position.position_id,
                symbol: position.symbol,
                currentPrice,
                trailingStopPrice: position.trailing_stop_price,
                effectiveStop: effectiveTrailingStop,
                highWaterMark: position.high_water_mark,
                entryPrice: position.entry_price,
                stale: priceIsStale,
              });
            }
          }

          if (!exitReason && config.enableExitDecisionEngine) {
            const underlying = Number.isFinite(underlyingPrice) ? underlyingPrice! : position.entry_price * 100;
            const [optionSnapshot, marketState, gexData] = await Promise.all([
              marketData.getOptionSnapshot(
                position.symbol,
                position.strike,
                new Date(position.expiration),
                position.type
              ),
              getCurrentState(position.symbol),
              positioningService.getGexSnapshot(position.symbol).catch(() => null),
            ]);
            const regime = marketState?.bias === 'BULLISH' ? 'BULL' : marketState?.bias === 'BEARISH' ? 'BEAR' : 'NEUTRAL';
            const gexState: GEXState =
              gexData?.dealerPosition === 'long_gamma'
                ? (gexData.netGex != null && Math.abs(gexData.netGex) > 1e8 ? 'POSITIVE_HIGH' : 'POSITIVE_LOW')
                : gexData?.dealerPosition === 'short_gamma'
                  ? (gexData.netGex != null && Math.abs(gexData.netGex) > 1e8 ? 'NEGATIVE_HIGH' : 'NEGATIVE_LOW')
                  : 'NEUTRAL';
            const input = buildExitDecisionInput(
              position,
              rule,
              {
                underlyingPrice: underlying,
                optionMid: currentPrice,
                optionBid: optionSnapshot?.bid,
                optionAsk: optionSnapshot?.ask,
              },
              now,
              { optionSnapshot: optionSnapshot ?? undefined, regime, gexState }
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
            } else if (result.action === 'TIGHTEN_STOP' && result.newStopLevel) {
              const currentStop = Number(position.trailing_stop_price) || 0;
              const isTighter = isShortPosition
                ? (currentStop === 0 || result.newStopLevel < currentStop)
                : result.newStopLevel > currentStop;
              if (isTighter) {
                await db.query(
                  `UPDATE refactored_positions SET trailing_stop_price = $1, last_updated = $2 WHERE position_id = $3`,
                  [result.newStopLevel, now, position.position_id]
                );
                logger.info('Exit engine tightened trailing stop', {
                  positionId: position.position_id,
                  symbol: position.symbol,
                  previousStop: currentStop,
                  newStop: result.newStopLevel,
                  trigger: result.triggeredRules[0]?.rule,
                });
              }
            }
          }

          if (!exitReason && !config.exitEngineSoleAuthority) {
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

          // P0: Idempotent exit order creation via transaction
          const created = await this.createExitOrder(position, exitReason, exitQuantity, now);
          if (created) {
            exitsCreated++;

            if (exitIntelligenceAudit) {
              logger.info('Exit intelligence applied', {
                positionId: position.position_id,
                reasonCodes: exitIntelligenceAudit.reasonCodes,
                finalExitAction: exitIntelligenceAudit.finalExitAction,
                exitQuantity,
                isPartial: exitQuantity < position.quantity,
              });
            }
          }
        } catch (error) {
          logger.debug('Exit monitor skipped - market data unavailable', {
            positionId: position.position_id,
            symbol: position.symbol
          });
          Sentry.captureException(error, {
            tags: { worker: 'ExitMonitorWorker', positionId: position.position_id },
          });
        }
      }
      }

      // P0: Track consecutive stale cycles for alerting
      if (staleSkips > 0 && positions.rows.length > 0 && staleSkips === positions.rows.length) {
        this.consecutiveStaleCount++;
        if (this.consecutiveStaleCount >= 3) {
          await sendRiskAlert({
            type: 'ALL_PROVIDERS_DOWN',
            symbol: 'SYSTEM',
            details: `Exit monitor unable to fetch prices for ${this.consecutiveStaleCount} consecutive cycles. ${positions.rows.length} positions unmonitored.`,
          }).catch(() => {});
        }
      } else {
        this.consecutiveStaleCount = 0;
      }

      // P0: Stuck closing position cleanup
      await this.cleanupStuckClosingPositions();

      if (config.enableShadowExecution) {
        try {
          await shadowExecutor.refreshShadowPositions();
          await shadowExecutor.monitorShadowExits();
        } catch (err) {
          logger.warn('Shadow monitor failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }

      logger.info('Exit monitor completed', {
        exitsCreated,
        staleSkips,
        durationMs: Date.now() - startTime,
      });
    } finally {
      updateWorkerStatus('ExitMonitorWorker', {
        lastDurationMs: Date.now() - startTime,
      });
      this.isRunning = false;
    }
  }

  /**
   * P0: Transactional, idempotent exit order creation.
   * Atomically updates position status and creates exit order.
   * Checks for existing pending exit orders to prevent duplicates.
   */
  private async createExitOrder(
    position: OpenPosition,
    exitReason: string,
    exitQuantity: number,
    now: Date
  ): Promise<boolean> {
    const isPartialExit = exitQuantity < position.quantity;

    try {
      return await db.transaction(async (tx) => {
        // P0: Check for existing pending exit order (idempotency guard)
        const existingExit = await tx.query(
          `SELECT order_id FROM orders
           WHERE option_symbol = $1 AND status = 'pending_execution'
           AND quantity > 0
           LIMIT 1`,
          [position.option_symbol]
        );
        if (existingExit.rows.length > 0) {
          logger.info('Exit order already exists, skipping duplicate', {
            positionId: position.position_id,
            existingOrderId: existingExit.rows[0].order_id,
            exitReason,
          });
          return false;
        }

        // Atomic position status update
        let updateResult;
        if (isPartialExit) {
          updateResult = await tx.query(
            `UPDATE refactored_positions
             SET quantity = quantity - $1,
                 last_updated = $2
             WHERE position_id = $3 AND status = 'open' AND quantity >= $1
             RETURNING position_id`,
            [exitQuantity, now, position.position_id]
          );
        } else {
          updateResult = await tx.query(
            `UPDATE refactored_positions
             SET status = $1,
                 exit_reason = $2,
                 last_updated = $3
             WHERE position_id = $4 AND status = 'open'
             RETURNING position_id`,
            ['closing', exitReason, now, position.position_id]
          );
        }

        if (!updateResult.rows.length) {
          logger.info('Position already closing/closed, skipping exit order', {
            positionId: position.position_id,
            exitReason,
          });
          return false;
        }

        // Create exit order within same transaction
        await tx.query(
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

        return true;
      });
    } catch (error) {
      logger.error('Failed to create exit order (transaction rolled back)', {
        positionId: position.position_id,
        exitReason,
        error,
      });
      Sentry.captureException(error, {
        tags: { worker: 'ExitMonitorWorker', op: 'createExitOrder' },
      });
      return false;
    } finally {
      // Publish updates outside transaction (best-effort)
      publishPositionUpdate(position.position_id).catch(() => {});
      publishRiskUpdate().catch(() => {});
    }
  }

  /**
   * P0: Emergency kill switch — force-close all open positions immediately.
   */
  private async emergencyCloseAll(): Promise<void> {
    logger.error('EMERGENCY RISK-OFF: Force-closing all open positions');
    Sentry.captureMessage('EMERGENCY RISK-OFF activated', { level: 'fatal' });

    await sendRiskAlert({
      type: 'EMERGENCY_RISK_OFF',
      symbol: 'SYSTEM',
      details: 'Emergency kill switch activated. Force-closing all open positions.',
    }).catch(() => {});

    const positions = await db.query<OpenPosition>(
      `SELECT * FROM refactored_positions WHERE status = 'open' ORDER BY entry_timestamp ASC LIMIT 200`
    );

    let closed = 0;
    for (const position of positions.rows) {
      const created = await this.createExitOrder(
        position,
        'emergency_risk_off',
        position.quantity,
        new Date()
      );
      if (created) closed++;
    }

    logger.error('EMERGENCY RISK-OFF complete', {
      totalOpen: positions.rows.length,
      exitOrdersCreated: closed,
    });
  }

  /**
   * P0: Detect and repair positions stuck in 'closing' status.
   * If a position has been in 'closing' for longer than the timeout with no pending exit order,
   * create a new exit order and alert.
   */
  private async cleanupStuckClosingPositions(): Promise<void> {
    try {
      const timeoutMinutes = config.stuckPositionTimeoutMinutes;
      const stuckPositions = await db.query<OpenPosition>(
        `SELECT p.*
         FROM refactored_positions p
         WHERE p.status = 'closing'
           AND p.last_updated < NOW() - INTERVAL '1 minute' * $1
           AND NOT EXISTS (
             SELECT 1 FROM orders o
             WHERE o.option_symbol = p.option_symbol
               AND o.status IN ('pending_execution', 'submitted')
           )
         ORDER BY p.last_updated ASC
         LIMIT 20`,
        [timeoutMinutes]
      );

      if (stuckPositions.rows.length === 0) return;

      logger.warn('Found stuck closing positions without exit orders', {
        count: stuckPositions.rows.length,
        timeoutMinutes,
      });

      for (const position of stuckPositions.rows) {
        try {
          // Create a replacement exit order
          await db.transaction(async (tx) => {
            const existingExit = await tx.query(
              `SELECT order_id FROM orders
               WHERE option_symbol = $1 AND status IN ('pending_execution', 'submitted')
               LIMIT 1`,
              [position.option_symbol]
            );
            if (existingExit.rows.length > 0) return;

            await tx.query(
              `INSERT INTO orders (
                signal_id, symbol, option_symbol, strike, expiration, type,
                quantity, engine, experiment_id, order_type, status
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [
                null,
                position.symbol,
                position.option_symbol,
                position.strike,
                position.expiration,
                position.type,
                position.quantity,
                position.engine ?? null,
                position.experiment_id ?? null,
                'paper',
                'pending_execution',
              ]
            );

            // Update last_updated to reset the timeout
            await tx.query(
              `UPDATE refactored_positions SET last_updated = NOW() WHERE position_id = $1`,
              [position.position_id]
            );
          });

          logger.warn('Created replacement exit order for stuck position', {
            positionId: position.position_id,
            symbol: position.symbol,
            optionSymbol: position.option_symbol,
          });
        } catch (err) {
          logger.error('Failed to repair stuck position', {
            positionId: position.position_id,
            error: err,
          });
        }
      }

      await sendRiskAlert({
        type: 'STUCK_POSITIONS',
        symbol: 'SYSTEM',
        details: `${stuckPositions.rows.length} position(s) stuck in 'closing' > ${timeoutMinutes}min. Replacement exit orders created. Symbols: ${stuckPositions.rows.map(p => p.symbol).join(', ')}`,
      }).catch(() => {});
    } catch (error) {
      logger.error('Stuck position cleanup failed', { error });
    }
  }
}
