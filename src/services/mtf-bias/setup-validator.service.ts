/**
 * MTF Bias Setup Validator
 * Consumes setup_validation_stream. Gates entries based on regime, confidence, conflict, space.
 */

import { mtfBiasStreamService, MTF_BIAS_STREAMS } from '../mtf-bias-stream.service.js';
import { logger } from '../../utils/logger.js';
import type { SymbolMarketState } from '../../lib/mtfBias/types.js';
import { riskModelService } from './risk-model.service.js';
import { portfolioGuardService } from './portfolio-guard.service.js';

export type SetupStatus = 'VALID' | 'WAIT' | 'REJECT';

export interface SetupValidationResult {
  setup_status: SetupStatus;
  reason_codes: string[];
  state: SymbolMarketState;
  position_size?: number;
  risk_per_trade?: number;
  guard_result?: 'ALLOW' | 'DOWNGRADE' | 'BLOCK';
}

const MIN_CONFIDENCE = 0.6;
const MAX_CONFLICT = 50;
const MAX_CHOP_RANGE = 65;
const MIN_DIST_TO_RES_ATR = 0.5;

export function validateSetup(
  state: SymbolMarketState,
  context: {
    currentPrice?: number;
    atr?: number;
    distToResAtr?: number;
    orbBreak?: boolean;
    volatilityExpanding?: boolean;
    priceNearEma21?: boolean;
    priceNearVwap?: boolean;
    extremeDistanceFromVwap?: boolean;
  }
): SetupValidationResult {
  const reasonCodes: string[] = [];

  if (state.regime_type === 'RANGE' && state.chop_score > MAX_CHOP_RANGE) {
    reasonCodes.push('RANGE_CHOP_HIGH');
  }
  if (state.confidence_score < MIN_CONFIDENCE) {
    reasonCodes.push('LOW_CONFIDENCE');
  }
  if (state.conflict_score > MAX_CONFLICT) {
    reasonCodes.push('HIGH_CONFLICT');
  }
  if (
    context.distToResAtr != null &&
    context.distToResAtr < MIN_DIST_TO_RES_ATR
  ) {
    reasonCodes.push('NO_SPACE_TO_MOVE');
  }

  if (state.entry_mode_hint === 'BREAKOUT') {
    if (!context.orbBreak && !context.volatilityExpanding) {
      reasonCodes.push('BREAKOUT_NO_ORB_OR_VOL');
    }
  } else if (state.entry_mode_hint === 'PULLBACK') {
    if (!context.priceNearEma21 && !context.priceNearVwap) {
      reasonCodes.push('PULLBACK_NOT_NEAR_SUPPORT');
    }
  } else if (state.entry_mode_hint === 'MEAN_REVERT') {
    if (state.regime_type !== 'RANGE' || !context.extremeDistanceFromVwap) {
      reasonCodes.push('MEAN_REVERT_INVALID_CONTEXT');
    }
  }

  const hasReject = reasonCodes.some((r) =>
    ['RANGE_CHOP_HIGH', 'LOW_CONFIDENCE', 'HIGH_CONFLICT', 'NO_SPACE_TO_MOVE'].includes(r)
  );
  const hasWait = reasonCodes.some((r) =>
    ['BREAKOUT_NO_ORB_OR_VOL', 'PULLBACK_NOT_NEAR_SUPPORT', 'MEAN_REVERT_INVALID_CONTEXT'].includes(r)
  );

  let setupStatus: SetupStatus = 'VALID';
  if (hasReject) setupStatus = 'REJECT';
  else if (hasWait) setupStatus = 'WAIT';

  return {
    setup_status: setupStatus,
    reason_codes: reasonCodes,
    state,
  };
}

export async function processSetupValidationInput(
  payload: Record<string, unknown>
): Promise<void> {
  const eventType = payload.event_type as string;
  const symbol = (payload.symbol as string)?.toUpperCase();
  const state = payload.state as SymbolMarketState;

  if (eventType !== 'SETUP_VALIDATION_INPUT' || !symbol || !state) {
    return;
  }

  const result = validateSetup(state, {
    distToResAtr: 1.0,
    priceNearVwap: true,
  });

  if (result.setup_status === 'REJECT') {
    logger.info('MTF bias setup rejected', { symbol, reason_codes: result.reason_codes });
    return;
  }

  const guardResult = await portfolioGuardService.check(symbol, state);
  if (guardResult === 'BLOCK') {
    logger.info('MTF bias portfolio guard block', { symbol });
    return;
  }

  const riskResult = await riskModelService.computePositionSize(state, {
    entryPrice: 500,
    atr: 2.0,
    accountRiskPercent: 1,
  });

  await mtfBiasStreamService.publishTradeExecution({
    event_type: 'SETUP_VALIDATED',
    symbol,
    setup_status: result.setup_status,
    state,
    position_size: riskResult?.positionSize,
    risk_per_trade: riskResult?.riskPerTrade,
    guard_result: guardResult,
    timestamp: Date.now(),
  });
}

export async function pollAndProcessSetupValidationStream(): Promise<number> {
  const messages = await mtfBiasStreamService.read(
    MTF_BIAS_STREAMS.SETUP_VALIDATION,
    2000
  );
  let processed = 0;

  for (const { id, payload } of messages) {
    await processSetupValidationInput(payload);
    processed++;
    await mtfBiasStreamService.ack(MTF_BIAS_STREAMS.SETUP_VALIDATION, id);
  }

  return processed;
}
