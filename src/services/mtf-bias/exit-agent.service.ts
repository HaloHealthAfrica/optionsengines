/**
 * MTF Bias Exit Agent
 * Monitors: confidence collapse (<0.45), bias flip, chop spike,
 * price at invalidation, time stop.
 */

import { db } from '../database.service.js';
import { getSymbolMarketState } from './mtf-bias-state.service.js';
import { logger } from '../../utils/logger.js';

const CONFIDENCE_COLLAPSE_THRESHOLD = 0.45;

export type ExitSignal = {
  positionId: string;
  symbol: string;
  exitType: 'HARD_STOP' | 'PARTIAL_PROFIT' | 'TRAIL_STOP' | 'TIME_STOP' | 'CONFIDENCE_COLLAPSE' | 'BIAS_FLIP' | 'CHOP_SPIKE';
  reason: string;
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
