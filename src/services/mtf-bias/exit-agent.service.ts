/**
 * MTF Bias Exit Agent
 * Monitors: confidence collapse (<0.45), bias flip, chop spike,
 * price at invalidation, time stop.
 * Enhanced with Exit Intelligence (UnifiedBiasState) when full position context is provided.
 */

import { db } from '../database.service.js';
import { getSymbolMarketState } from './mtf-bias-state.service.js';
import { logger } from '../../utils/logger.js';
import { evaluateExitAdjustments } from '../exit-intelligence/index.js';
import { getCurrentState } from '../bias-state-aggregator/bias-state-aggregator.service.js';

const CONFIDENCE_COLLAPSE_THRESHOLD = 0.45;

export type ExitSignal = {
  positionId: string;
  symbol: string;
  exitType: 'HARD_STOP' | 'PARTIAL_PROFIT' | 'TRAIL_STOP' | 'TIME_STOP' | 'CONFIDENCE_COLLAPSE' | 'BIAS_FLIP' | 'CHOP_SPIKE' | 'EXIT_INTELLIGENCE';
  reason: string;
  /** When from exit intelligence: partial exit fraction (0–1) or undefined for full */
  partialExitFraction?: number;
};

export async function evaluateExitConditions(
  positionId: string,
  symbol: string,
  entryBias: string,
  _entryConfidence: number
): Promise<ExitSignal | null> {
  const state = await getSymbolMarketState(symbol);
  if (!state) return null;

  if (state.confidence_score < CONFIDENCE_COLLAPSE_THRESHOLD) {
    return {
      positionId,
      symbol,
      exitType: 'CONFIDENCE_COLLAPSE',
      reason: `Confidence dropped to ${state.confidence_score}`,
    };
  }

  const currentBias = state.resolved_bias ?? state.bias_consensus;
  const biasFlipped =
    (entryBias === 'BULLISH' && (currentBias === 'BEARISH' || currentBias === 'HOLD')) ||
    (entryBias === 'BEARISH' && (currentBias === 'BULLISH' || currentBias === 'HOLD'));
  if (biasFlipped) {
    return {
      positionId,
      symbol,
      exitType: 'BIAS_FLIP',
      reason: `Bias flipped from ${entryBias} to ${currentBias}`,
    };
  }

  if (state.chop_score > 70) {
    return {
      positionId,
      symbol,
      exitType: 'CHOP_SPIKE',
      reason: `Chop score ${state.chop_score} exceeded threshold`,
    };
  }

  return null;
}

/**
 * Evaluate exit with Exit Intelligence (UnifiedBiasState).
 * Use when full position context is available. Never overrides hard stop breach.
 */
export async function evaluateExitConditionsWithIntelligence(params: {
  positionId: string;
  symbol: string;
  direction: 'long' | 'short';
  type: 'call' | 'put';
  quantity: number;
  entryPrice: number;
  entryTimestamp: Date;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  timeInTradeMinutes: number;
  strategyType: 'BREAKOUT' | 'PULLBACK' | 'MEAN_REVERT' | 'SWING';
  entryRegimeType?: string;
  entryStateStrengthDelta?: number;
}): Promise<ExitSignal | null> {
  const marketState = await getCurrentState(params.symbol);
  const adjustments = evaluateExitAdjustments({
    openPosition: {
      positionId: params.positionId,
      symbol: params.symbol,
      direction: params.direction,
      type: params.type,
      quantity: params.quantity,
      entryPrice: params.entryPrice,
      entryTimestamp: params.entryTimestamp,
      entryRegimeType: params.entryRegimeType,
      entryStateStrengthDelta: params.entryStateStrengthDelta,
    },
    marketState,
    unrealizedPnL: params.unrealizedPnL,
    unrealizedPnLPercent: params.unrealizedPnLPercent,
    timeInTradeMinutes: params.timeInTradeMinutes,
    strategyType: params.strategyType,
  });

  if (adjustments.forceFullExit) {
    return {
      positionId: params.positionId,
      symbol: params.symbol,
      exitType: 'EXIT_INTELLIGENCE',
      reason: adjustments.reasonCodes[0] ?? 'MACRO_DRIFT_EXIT_PRESSURE',
    };
  }
  if (adjustments.forcePartialExit !== undefined) {
    return {
      positionId: params.positionId,
      symbol: params.symbol,
      exitType: 'EXIT_INTELLIGENCE',
      reason: adjustments.reasonCodes[0] ?? 'MACRO_DRIFT_EXIT_PRESSURE',
      partialExitFraction: adjustments.forcePartialExit,
    };
  }
  return null;
}

export async function updatePositionExit(
  positionId: string,
  exitType: string,
  rMultiple?: number
): Promise<void> {
  try {
    await db.query(
      `UPDATE refactored_positions SET
        exit_type = $1,
        r_multiple = $2,
        status = 'closing',
        last_updated = NOW()
       WHERE position_id = $3`,
      [exitType, rMultiple ?? null, positionId]
    );
  } catch (error) {
    logger.error('Exit agent update failed', error, { positionId });
  }
}
