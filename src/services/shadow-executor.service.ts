// Shadow Executor - simulates Engine 2 trades without live orders
import { db } from './database.service.js';
import { marketData } from './market-data.js';
import { logger } from '../utils/logger.js';
import { MetaDecision, EnrichedSignal } from '../types/index.js';
import { config } from '../config/index.js';
import * as Sentry from '@sentry/node';

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
  return direction === 'long' ? Math.ceil(price) : Math.floor(price);
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

export class ShadowExecutor {
  async simulateExecution(
    decision: MetaDecision,
    signal: EnrichedSignal,
    experimentId: string,
    metaGamma?: string
  ): Promise<void> {
    if (decision.decision !== 'approve') {
      logger.info('Shadow execution skipped (decision reject)', {
        experimentId,
        signalId: signal.signalId,
      });
      return;
    }

    Sentry.addBreadcrumb({
      category: 'shadow',
      message: 'Shadow trade start',
      level: 'info',
      data: { experimentId, signalId: signal.signalId },
    });
    const price = await marketData.getStockPrice(signal.symbol);
    const strike = calculateStrike(price, signal.direction);
    const expiration = calculateExpiration(config.maxHoldDays);
    const optionType = signal.direction === 'long' ? 'call' : 'put';
    const optionSymbol = buildOptionSymbol(signal.symbol, expiration, optionType, strike);
    const quantity = Math.max(1, config.maxPositionSize);

    const optionPrice = await marketData.getOptionPrice(
      signal.symbol,
      strike,
      expiration,
      optionType
    );

    if (optionPrice == null || !Number.isFinite(optionPrice)) {
      logger.warn('Shadow trade skipped - option price unavailable', {
        experimentId,
        signalId: signal.signalId,
        symbol: signal.symbol,
      });
      return;
    }

    const entryTimestamp = new Date();

    const tradeResult = await db.query(
      `INSERT INTO shadow_trades (
        experiment_id,
        signal_id,
        symbol,
        option_symbol,
        strike,
        expiration,
        type,
        quantity,
        entry_price,
        entry_timestamp,
        contributing_agents,
        meta_confidence,
        meta_gamma
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING shadow_trade_id`,
      [
        experimentId,
        signal.signalId,
        signal.symbol,
        optionSymbol,
        strike,
        expiration,
        optionType,
        quantity,
        optionPrice,
        entryTimestamp,
        JSON.stringify(decision.contributingAgents),
        decision.finalConfidence,
        metaGamma ?? null,
      ]
    );

    const shadowTradeId = tradeResult.rows[0].shadow_trade_id;

    await db.query(
      `INSERT INTO shadow_positions (
        shadow_trade_id,
        symbol,
        option_symbol,
        strike,
        expiration,
        type,
        quantity,
        entry_price,
        status,
        entry_timestamp,
        last_updated
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
      [
        shadowTradeId,
        signal.symbol,
        optionSymbol,
        strike,
        expiration,
        optionType,
        quantity,
        optionPrice,
        'open',
        entryTimestamp,
      ]
    );

    logger.info('Shadow trade simulated', {
      experimentId,
      signalId: signal.signalId,
      shadowTradeId,
    });
  }

  async refreshShadowPositions(): Promise<void> {
    const positions = await db.query(
      `SELECT * FROM shadow_positions WHERE status = $1 ORDER BY entry_timestamp ASC LIMIT 200`,
      ['open']
    );

    for (const position of positions.rows) {
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
      await db.query(
        `UPDATE shadow_positions
         SET current_price = $1,
             unrealized_pnl = $2,
             last_updated = $3
         WHERE shadow_position_id = $4`,
        [currentPrice, unrealizedPnl, new Date(), position.shadow_position_id]
      );
    }
  }

  async monitorShadowExits(): Promise<void> {
    const ruleResult = await db.query(
      `SELECT * FROM exit_rules WHERE enabled = true ORDER BY created_at DESC LIMIT 1`
    );
    const rule = ruleResult.rows[0];
    if (!rule) return;

    const positions = await db.query(
      `SELECT * FROM shadow_positions WHERE status = $1 ORDER BY entry_timestamp ASC LIMIT 200`,
      ['open']
    );

    for (const position of positions.rows) {
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
      const pnlPercent = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0;
      const now = new Date();
      const hoursInPosition =
        (now.getTime() - new Date(position.entry_timestamp).getTime()) / 3600000;
      const daysToExpiration =
        (new Date(position.expiration).getTime() - now.getTime()) / 86400000;

      let exitReason: string | null = null;
      if (rule.profit_target_percent !== undefined && pnlPercent >= rule.profit_target_percent) {
        exitReason = 'profit_target';
      } else if (rule.stop_loss_percent !== undefined && pnlPercent <= -Math.abs(rule.stop_loss_percent)) {
        exitReason = 'stop_loss';
      } else if (rule.max_hold_time_hours !== undefined && hoursInPosition >= rule.max_hold_time_hours) {
        exitReason = 'max_hold_time';
      } else if (rule.min_dte_exit !== undefined && daysToExpiration <= rule.min_dte_exit) {
        exitReason = 'min_dte_exit';
      }

      if (!exitReason) {
        continue;
      }

      const realizedPnl = unrealizedPnl;
      await db.query(
        `UPDATE shadow_positions
         SET status = $1,
             exit_reason = $2,
             exit_timestamp = $3,
             realized_pnl = $4,
             last_updated = $3
         WHERE shadow_position_id = $5`,
        ['closed', exitReason, now, realizedPnl, position.shadow_position_id]
      );
    }
  }
}

export const shadowExecutor = new ShadowExecutor();
