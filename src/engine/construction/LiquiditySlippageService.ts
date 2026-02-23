import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';
import { db } from '../../services/database.service.js';
import { getEngineConfig } from '../config/loader.js';
import { massiveOptionsService } from '../data/MassiveOptionsService.js';
import { FillStatus } from '../types/enums.js';
import type { TradePlan, SlippageAuditRecord } from '../types/index.js';

export interface SubmissionResult {
  success: boolean;
  fillStatus: FillStatus;
  fillPrice: number | null;
  slippageDollars: number;
  slippagePct: number;
  repriceCount: number;
  secondsToFill: number | null;
  auditId: string;
}

export interface QuoteInstabilityResult {
  stable: boolean;
  midMovement: number;
  underlyingMovement: number;
  reason: string | null;
}

export class LiquiditySlippageService {

  /**
   * Check quote instability before submission.
   * Compares current mid to a 15s-old reference to detect rapid movement.
   */
  checkQuoteInstability(
    currentMid: number,
    referenceMid: number,
    currentUnderlyingPrice: number,
    referenceUnderlyingPrice: number
  ): QuoteInstabilityResult {
    const cfg = getEngineConfig().slippage;

    const midMovement = referenceMid > 0
      ? Math.abs(currentMid - referenceMid) / referenceMid
      : 0;
    const underlyingMovement = referenceUnderlyingPrice > 0
      ? Math.abs(currentUnderlyingPrice - referenceUnderlyingPrice) / referenceUnderlyingPrice
      : 0;

    if (midMovement > cfg.maxMidMovement15s) {
      return {
        stable: false,
        midMovement,
        underlyingMovement,
        reason: `Option mid moved ${(midMovement * 100).toFixed(2)}% in 15s (max: ${(cfg.maxMidMovement15s * 100).toFixed(2)}%)`,
      };
    }

    if (underlyingMovement > cfg.maxUnderlyingMovement15s) {
      return {
        stable: false,
        midMovement,
        underlyingMovement,
        reason: `Underlying moved ${(underlyingMovement * 100).toFixed(3)}% in 15s (max: ${(cfg.maxUnderlyingMovement15s * 100).toFixed(3)}%)`,
      };
    }

    return { stable: true, midMovement, underlyingMovement, reason: null };
  }

  /**
   * Build a reprice ladder for limit order submission.
   * Returns the limit prices for each repricing attempt.
   *
   * For a SELL (credit spread entry): start at mid, walk DOWN toward bid
   * For a BUY (long option entry): start at mid, walk UP toward ask
   */
  buildRepriceLadder(
    expectedPrice: number,
    bid: number,
    ask: number,
    side: 'BUY' | 'SELL'
  ): number[] {
    const cfg = getEngineConfig().slippage;
    const ladder: number[] = [];

    const spread = ask - bid;
    const improvements = [0, ...cfg.repriceSpreadImprovement];

    for (let i = 0; i < cfg.repriceAttempts; i++) {
      const improvementPct = i < improvements.length ? improvements[i] : improvements[improvements.length - 1];

      let price: number;
      if (side === 'SELL') {
        // Selling: start at mid, concede toward bid
        price = expectedPrice - spread * improvementPct;
        price = Math.max(price, bid);
      } else {
        // Buying: start at mid, concede toward ask
        price = expectedPrice + spread * improvementPct;
        price = Math.min(price, ask);
      }

      ladder.push(Math.round(price * 100) / 100);
    }

    return ladder;
  }

  /**
   * Compute exit price using executable prices only (bid for sells, ask for buys).
   * No mid-price exits.
   */
  getExecutableExitPrice(
    bid: number,
    ask: number,
    side: 'BUY_TO_CLOSE' | 'SELL_TO_CLOSE'
  ): number {
    if (side === 'SELL_TO_CLOSE') {
      return bid;
    }
    return ask;
  }

  /**
   * Record a slippage audit row to DB.
   */
  async writeSlippageAudit(params: {
    tradeId: string;
    accountId: string;
    positionId: string;
    optionTicker: string;
    expectedPrice: number;
    submittedLimitPrice: number;
    fillPrice: number | null;
    spreadWidthPctAtSubmit: number;
    liquidityScoreAtSubmit: number;
    underlyingPriceAtSubmit: number;
    secondsToFill: number | null;
    repriceCount: number;
    fillStatus: FillStatus;
    idempotencyKey: string;
  }): Promise<SlippageAuditRecord> {
    const {
      tradeId, accountId, positionId, optionTicker,
      expectedPrice, submittedLimitPrice, fillPrice,
      spreadWidthPctAtSubmit, liquidityScoreAtSubmit,
      underlyingPriceAtSubmit, secondsToFill, repriceCount,
      fillStatus, idempotencyKey,
    } = params;

    // Idempotency check
    const existing = await db.query(
      'SELECT id FROM oe_slippage_audits WHERE idempotency_key = $1',
      [idempotencyKey]
    );
    if (existing.rows.length > 0) {
      logger.debug('Slippage audit already exists (idempotent)', { idempotencyKey });
      return this.fetchAuditById(existing.rows[0].id);
    }

    const slippageDollars = fillPrice !== null
      ? Math.abs(fillPrice - expectedPrice)
      : 0;
    const slippagePct = expectedPrice > 0 && fillPrice !== null
      ? slippageDollars / expectedPrice
      : 0;

    const id = randomUUID();

    await db.query(
      `INSERT INTO oe_slippage_audits (
        id, trade_id, account_id, position_id, option_ticker,
        expected_price, submitted_limit_price, fill_price,
        slippage_dollars, slippage_pct,
        spread_width_pct_at_submit, liquidity_score_at_submit,
        underlying_price_at_submit, seconds_to_fill, reprice_count,
        fill_status, idempotency_key
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        id, tradeId, accountId, positionId, optionTicker,
        expectedPrice, submittedLimitPrice, fillPrice,
        slippageDollars, slippagePct,
        spreadWidthPctAtSubmit, liquidityScoreAtSubmit,
        underlyingPriceAtSubmit, secondsToFill, repriceCount,
        fillStatus, idempotencyKey,
      ]
    );

    logger.info('Slippage audit recorded', {
      id, optionTicker, fillStatus, slippageDollars, repriceCount,
    });

    return {
      id,
      tradeId,
      accountId,
      positionId,
      optionTicker,
      expectedPrice,
      submittedLimitPrice,
      fillPrice,
      slippageDollars,
      slippagePct,
      spreadWidthPctAtSubmit,
      liquidityScoreAtSubmit,
      underlyingPriceAtSubmit,
      secondsToFill,
      repriceCount,
      fillStatus,
      createdAt: new Date(),
      idempotencyKey,
    };
  }

  /**
   * Validate that a trade plan's DTE is within the allowed range for limit orders.
   */
  validateDTERange(plan: TradePlan): { valid: boolean; reason: string | null } {
    const minDTE = plan.legs.reduce((min, leg) => Math.min(min, leg.dte), Infinity);
    if (minDTE < 7) {
      return { valid: false, reason: `DTE ${minDTE} is below minimum 7 for limit orders` };
    }
    if (minDTE > 30) {
      return { valid: false, reason: `DTE ${minDTE} exceeds maximum 30 for limit orders` };
    }
    return { valid: true, reason: null };
  }

  /**
   * Revalidate quote freshness at submission time.
   */
  async revalidateQuoteAtSubmission(optionTicker: string): Promise<{
    fresh: boolean;
    currentBid: number;
    currentAsk: number;
    currentMid: number;
  }> {
    try {
      const quote = await massiveOptionsService.getContractSnapshot(optionTicker);

      if (massiveOptionsService.isQuoteStale(quote)) {
        return { fresh: false, currentBid: quote.bid, currentAsk: quote.ask, currentMid: quote.mid };
      }

      return { fresh: true, currentBid: quote.bid, currentAsk: quote.ask, currentMid: quote.mid };
    } catch (error) {
      logger.error('Quote revalidation failed', error as Error, { optionTicker });
      return { fresh: false, currentBid: 0, currentAsk: 0, currentMid: 0 };
    }
  }

  private async fetchAuditById(id: string): Promise<SlippageAuditRecord> {
    const result = await db.query(
      'SELECT * FROM oe_slippage_audits WHERE id = $1',
      [id]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      tradeId: row.trade_id,
      accountId: row.account_id,
      positionId: row.position_id,
      optionTicker: row.option_ticker,
      expectedPrice: parseFloat(row.expected_price),
      submittedLimitPrice: parseFloat(row.submitted_limit_price),
      fillPrice: row.fill_price ? parseFloat(row.fill_price) : null,
      slippageDollars: parseFloat(row.slippage_dollars),
      slippagePct: parseFloat(row.slippage_pct),
      spreadWidthPctAtSubmit: parseFloat(row.spread_width_pct_at_submit),
      liquidityScoreAtSubmit: parseFloat(row.liquidity_score_at_submit),
      underlyingPriceAtSubmit: parseFloat(row.underlying_price_at_submit),
      secondsToFill: row.seconds_to_fill ? parseInt(row.seconds_to_fill) : null,
      repriceCount: parseInt(row.reprice_count),
      fillStatus: row.fill_status as FillStatus,
      createdAt: new Date(row.created_at),
      idempotencyKey: row.idempotency_key,
    };
  }
}

export const liquiditySlippageService = new LiquiditySlippageService();
