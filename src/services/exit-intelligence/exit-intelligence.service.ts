/**
 * Exit Intelligence Service
 * Bias-aware exit adaptation using UnifiedBiasState signals.
 * Does NOT override hard stops. Enhances exit decisions with state signals.
 */

import { logger } from '../../utils/logger.js';
import type { UnifiedBiasState } from '../../lib/mtfBias/types-v3.js';

/** Minimum profit (in R multiples) to allow partial exit. Configurable. */
export const MIN_PROFIT_R_FOR_PARTIAL = 1;

export interface ExitIntelligenceOpenPosition {
  positionId: string;
  symbol: string;
  direction: 'long' | 'short';
  type: 'call' | 'put';
  quantity: number;
  entryPrice: number;
  entryTimestamp: Date;
  /** Optional: stateStrengthDelta at entry for decay detection */
  entryStateStrengthDelta?: number;
  /** Optional: regime at entry for flip detection */
  entryRegimeType?: string;
  /** Optional: strategy type at entry */
  entryStrategyType?: 'BREAKOUT' | 'PULLBACK' | 'MEAN_REVERT' | 'SWING';
}

export interface EvaluateExitAdjustmentsInput {
  openPosition: ExitIntelligenceOpenPosition;
  marketState: UnifiedBiasState | null;
  unrealizedPnL: number;
  /** PnL as percent of cost basis (e.g. 5 = 5% profit) */
  unrealizedPnLPercent: number;
  timeInTradeMinutes: number;
  strategyType: 'BREAKOUT' | 'PULLBACK' | 'MEAN_REVERT' | 'SWING';
  /** Optional: ATR expanding for volatility rule */
  atrExpanding?: boolean;
  /** Optional: trade aligned with macro (long + MACRO_TREND_UP, short + MACRO_TREND_DOWN) */
  tradeAlignedWithMacro?: boolean;
}

export interface ExitDecisionAudit {
  macroModifier?: number;
  accelerationModifier?: number;
  regimeModifier?: number;
  liquidityModifier?: number;
  finalExitAction: string;
  reasonCodes: string[];
}

export interface EvaluateExitAdjustmentsOutput {
  tightenStopMultiplier?: number;
  widenStopMultiplier?: number;
  forcePartialExit?: number;
  forceFullExit?: boolean;
  convertToTrailing?: boolean;
  hedgeSignal?: boolean;
  reasonCodes: string[];
  audit: ExitDecisionAudit;
}

const MACRO_DRIFT_THRESHOLD = 0.18;
const MACRO_DRIFT_EXTREME = 0.25;

/**
 * Evaluate bias-aware exit adjustments.
 * Priority: forceFullExit > forcePartialExit > tighten/widen stop > trailing conversion.
 * Never overrides hard stop breach. Enforces safety constraints.
 */
export function evaluateExitAdjustments(
  input: EvaluateExitAdjustmentsInput
): EvaluateExitAdjustmentsOutput {
  const reasonCodes: string[] = [];
  const audit: ExitDecisionAudit = {
    finalExitAction: 'HOLD',
    reasonCodes: [],
  };

  if (!input.marketState) {
    audit.reasonCodes = ['NO_MARKET_STATE'];
    return { reasonCodes: ['NO_MARKET_STATE'], audit };
  }

  const state = input.marketState;
  const acc = state.acceleration;
  const trans = state.transitions;
  const liq = state.liquidity;
  const macroDrift = acc?.macroDriftScore ?? 0;
  const stateStrengthDelta = acc?.stateStrengthDelta ?? 0;
  const trendPhase = state.trendPhase ?? 'MID';
  const regimeFlip = trans?.regimeFlip ?? false;
  const macroFlip = trans?.macroFlip ?? false;
  const direction = input.openPosition.direction;
  const strategyType = input.strategyType;

  let tightenStopMultiplier: number | undefined;
  let widenStopMultiplier: number | undefined;
  let forcePartialExit: number | undefined;
  let forceFullExit = false;
  let convertToTrailing = false;
  let hedgeSignal = false;

  // --- 1. Macro Drift Exit Pressure ---
  if (macroDrift > MACRO_DRIFT_THRESHOLD || macroFlip) {
    if (macroDrift > MACRO_DRIFT_EXTREME) {
      forceFullExit = true;
      reasonCodes.push('MACRO_DRIFT_EXIT_PRESSURE');
      audit.macroModifier = 0.5;
    } else {
      tightenStopMultiplier = 0.75;
      forcePartialExit = 0.3;
      reasonCodes.push('MACRO_DRIFT_EXIT_PRESSURE');
      audit.macroModifier = 0.75;
    }
  }

  // --- 2. Acceleration Decay Exit ---
  const entryDelta = input.openPosition.entryStateStrengthDelta ?? 10;
  const decayedNegative = stateStrengthDelta < 0 && (entryDelta > 0 || entryDelta === undefined);
  if (decayedNegative && trendPhase === 'LATE' && !forceFullExit) {
    tightenStopMultiplier = Math.min(tightenStopMultiplier ?? 1, 0.8);
    convertToTrailing = true;
    reasonCodes.push('ACCELERATION_DECAY');
    audit.accelerationModifier = 0.8;
  }

  // --- 3. Regime Flip Exit ---
  if (regimeFlip && strategyType === 'BREAKOUT') {
    forceFullExit = true;
    reasonCodes.push('REGIME_FLIP_INVALIDATION');
    audit.regimeModifier = 0;
  }

  // --- 4. Volatility Expansion Stop Widening (optional) ---
  if (
    input.atrExpanding &&
    input.tradeAlignedWithMacro &&
    !forceFullExit &&
    !forcePartialExit &&
    input.unrealizedPnLPercent > 0
  ) {
    widenStopMultiplier = 1.15;
    reasonCodes.push('VOLATILITY_EXPANSION_PROTECT_RUN');
  }

  // --- 5. Liquidity Failure Exit ---
  if (liq?.sweepHigh === true && liq?.reclaim === false && direction === 'long') {
    forceFullExit = true;
    reasonCodes.push('LIQUIDITY_TRAP_EXIT');
    audit.liquidityModifier = 0;
  }

  // --- Safety Constraints ---
  // Never tighten stop beyond entry if trade is negative
  if (tightenStopMultiplier !== undefined && input.unrealizedPnLPercent < 0) {
    tightenStopMultiplier = undefined;
    const idx = reasonCodes.indexOf('ACCELERATION_DECAY');
    if (idx >= 0) reasonCodes.splice(idx, 1);
  }

  // No widening stop on losing trade
  if (widenStopMultiplier !== undefined && input.unrealizedPnLPercent < 0) {
    widenStopMultiplier = undefined;
    const idx = reasonCodes.indexOf('VOLATILITY_EXPANSION_PROTECT_RUN');
    if (idx >= 0) reasonCodes.splice(idx, 1);
  }

  // Partial exit only if > 1R in profit (configurable)
  const costBasis = input.openPosition.entryPrice * input.openPosition.quantity * 100;
  const rMultiple = costBasis > 0 ? input.unrealizedPnL / (costBasis * 0.01) : 0;
  if (forcePartialExit !== undefined && rMultiple < MIN_PROFIT_R_FOR_PARTIAL) {
    forcePartialExit = undefined;
    if (!tightenStopMultiplier && reasonCodes.includes('MACRO_DRIFT_EXIT_PRESSURE')) {
      tightenStopMultiplier = 0.75;
    }
  }

  // Block conflicting adjustments
  if (forceFullExit) {
    forcePartialExit = undefined;
    tightenStopMultiplier = undefined;
    widenStopMultiplier = undefined;
    convertToTrailing = false;
  } else if (forcePartialExit !== undefined) {
    widenStopMultiplier = undefined;
  }

  audit.reasonCodes = [...reasonCodes];
  if (forceFullExit) audit.finalExitAction = 'FULL_EXIT';
  else if (forcePartialExit) audit.finalExitAction = `PARTIAL_EXIT_${Math.round((forcePartialExit ?? 0) * 100)}%`;
  else if (tightenStopMultiplier) audit.finalExitAction = `TIGHTEN_STOP_${tightenStopMultiplier}`;
  else if (widenStopMultiplier) audit.finalExitAction = `WIDEN_STOP_${widenStopMultiplier}`;
  else if (convertToTrailing) audit.finalExitAction = 'CONVERT_TRAILING';
  else audit.finalExitAction = 'HOLD';

  const result: EvaluateExitAdjustmentsOutput = {
    reasonCodes,
    audit,
  };
  if (tightenStopMultiplier !== undefined) result.tightenStopMultiplier = tightenStopMultiplier;
  if (widenStopMultiplier !== undefined) result.widenStopMultiplier = widenStopMultiplier;
  if (forcePartialExit !== undefined) result.forcePartialExit = forcePartialExit;
  if (forceFullExit) result.forceFullExit = true;
  if (convertToTrailing) result.convertToTrailing = true;
  if (hedgeSignal) result.hedgeSignal = true;

  logger.debug('Exit intelligence evaluation', {
    positionId: input.openPosition.positionId,
    reasonCodes,
    audit: audit.finalExitAction,
  });

  return result;
}
