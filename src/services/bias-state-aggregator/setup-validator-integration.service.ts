/**
 * Setup Validator Integration - UnifiedBiasState-aware entry quality control.
 * Blocks low-quality trades: breakout without space, no trigger, liquidity trap, range suppression.
 */

import { logger } from '../../utils/logger.js';
import type { UnifiedBiasState } from '../../lib/mtfBias/types-v3.js';
import type { IntentTypeValue, RegimeTypeV3 } from '../../lib/mtfBias/constants-v3.js';

export type StrategyType = 'BREAKOUT' | 'PULLBACK' | 'MEAN_REVERT' | 'SWING';

export interface ValidateEntryInput {
  entryModeHint: string;
  intentType: IntentTypeValue;
  trigger: { triggered: boolean };
  space: { roomToResistance: string; roomToSupport: string };
  liquidity: { sweepHigh: boolean; sweepLow: boolean; reclaim: boolean };
  regimeType: RegimeTypeV3;
  strategyType?: StrategyType;
  direction?: 'long' | 'short';
  allowAnticipatoryEntry?: boolean;
}

export interface ValidateEntryOutput {
  valid: boolean;
  rejectReasons: string[];
}

/**
 * Validate entry using UnifiedBiasState fields.
 * Returns structured rejection reasons for monitoring.
 */
export function validateEntry(
  input: ValidateEntryInput,
  marketState?: UnifiedBiasState | null
): ValidateEntryOutput {
  const rejectReasons: string[] = [];

  const intent = input.intentType ?? marketState?.intentType;
  const trigger = input.trigger ?? marketState?.trigger;
  const space = input.space ?? marketState?.space;
  const liquidity = input.liquidity ?? marketState?.liquidity;
  const regimeType = input.regimeType ?? marketState?.regimeType ?? 'RANGE';
  const strategyType = input.strategyType ?? 'SWING';
  const direction = input.direction ?? 'long';

  if (intent === 'BREAKOUT' && space?.roomToResistance === 'LOW') {
    rejectReasons.push('BREAKOUT_WITHOUT_SPACE');
  }

  if (trigger?.triggered === false && !input.allowAnticipatoryEntry) {
    rejectReasons.push('NO_TRIGGER_CONFIRMATION');
  }

  if (
    liquidity?.sweepHigh === true &&
    liquidity?.reclaim === false &&
    direction === 'long'
  ) {
    rejectReasons.push('LIQUIDITY_TRAP_CONTINUATION');
  }

  if (regimeType === 'RANGE' && strategyType !== 'MEAN_REVERT') {
    rejectReasons.push('RANGE_SUPPRESSION_NON_MEAN_REVERT');
  }

  const valid = rejectReasons.length === 0;

  if (!valid) {
    logger.info('Setup validator rejected entry', {
      symbol: marketState?.symbol,
      rejectReasons,
    });
  }

  return { valid, rejectReasons };
}
