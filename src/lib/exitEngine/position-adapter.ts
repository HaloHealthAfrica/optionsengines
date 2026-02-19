/**
 * Adapter to build ExitDecisionInput from refactored_positions + exit_rules + market data.
 * Used by Exit Monitor to integrate the Exit Decision Engine for paper positions.
 */

import type { ExitDecisionInput } from './types.js';
import type { Greeks, RegimeType, SetupType } from '../shared/types.js';
import { deriveSetupTypeFromDte } from '../shared/setup-type.js';
import { EXIT_POLICIES } from './constants.js';

const ZERO_GREEKS: Greeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };

export interface PositionRow {
  position_id: string;
  symbol: string;
  option_symbol: string;
  strike: number;
  expiration: Date;
  type: 'call' | 'put';
  quantity: number;
  entry_price: number;
  entry_timestamp: Date;
  engine?: 'A' | 'B' | null;
}

export interface ExitRuleRow {
  profit_target_percent?: number;
  stop_loss_percent?: number;
  max_hold_time_hours?: number;
  min_dte_exit?: number;
}

export interface MarketSnapshot {
  underlyingPrice: number;
  optionMid: number;
  optionBid?: number;
  optionAsk?: number;
}

export interface OptionSnapshot {
  bid: number;
  ask: number;
  mid: number;
  greeks: Greeks;
  iv: number;
}

export type GEXState = 'POSITIVE_HIGH' | 'POSITIVE_LOW' | 'NEUTRAL' | 'NEGATIVE_LOW' | 'NEGATIVE_HIGH';

export interface ExitAdapterContext {
  optionSnapshot?: OptionSnapshot | null;
  regime?: RegimeType;
  setupType?: SetupType;
  /** Gamma regime from positioning (enables REGIME_FLIP / gamma-aware exits when GEX available) */
  gexState?: GEXState;
}

/**
 * Build ExitDecisionInput from position, exit_rules, and market snapshot.
 * Uses EXIT_POLICIES for setup-specific guardrails when DB rules don't override.
 * Wires real Greeks, regime, and spread when context provides them.
 */
export function buildExitDecisionInput(
  position: PositionRow,
  rule: ExitRuleRow,
  market: MarketSnapshot,
  now: Date,
  context?: ExitAdapterContext
): ExitDecisionInput {
  const entryTs = new Date(position.entry_timestamp);
  const expiryDate = new Date(position.expiration);
  const dteAtEntry = Math.max(
    0,
    (expiryDate.getTime() - entryTs.getTime()) / 86400000
  );
  const dteNow = Math.max(
    0,
    (expiryDate.getTime() - now.getTime()) / 86400000
  );

  const setupType = context?.setupType ?? deriveSetupTypeFromDte(dteAtEntry);
  const policy = EXIT_POLICIES[setupType];

  const stopLossPercent = rule.stop_loss_percent ?? 50;
  const profitTargetPercent = rule.profit_target_percent ?? 50;
  const maxHoldHours = rule.max_hold_time_hours ?? policy.maxHoldMinutes / 60;

  const progressChecks = policy.progressChecks.map((p) => ({
    atMinute: p.atMinute,
    minProfitPercent: p.minProfitPercent,
  }));
  const timeStopsMinutes = policy.timeStops.map((t) => t.atDay * 24 * 60);
  timeStopsMinutes.push(maxHoldHours * 60);

  const partialTargets = policy.profitPartials.map((p) => p.atPercent);

  const snapshot = context?.optionSnapshot;
  const currentGreeks = snapshot?.greeks ?? ZERO_GREEKS;
  const currentIV = snapshot?.iv ?? 0;
  const bid = snapshot?.bid ?? market.optionBid ?? market.optionMid * 0.99;
  const ask = snapshot?.ask ?? market.optionAsk ?? market.optionMid * 1.01;
  const spreadPercent =
    bid > 0 && ask > 0 ? ((ask - bid) / ((bid + ask) / 2)) * 100 : 0;
  const regime = context?.regime ?? 'NEUTRAL';
  const gexState = context?.gexState ?? 'NEUTRAL';

  return {
    tradePosition: {
      id: position.position_id,
      symbol: position.symbol,
      direction: position.type === 'call' ? 'CALL' : 'PUT',
      setupType,
    },
    entryData: {
      timestamp: entryTs.getTime(),
      underlyingEntryPrice: market.underlyingPrice,
      optionEntryPrice: position.entry_price,
      contracts: position.quantity,
    },
    contractDetails: {
      expiry: expiryDate.toISOString().slice(0, 10),
      dteAtEntry: Math.round(dteAtEntry * 10) / 10,
      strike: position.strike,
      greeksAtEntry: ZERO_GREEKS,
      ivAtEntry: snapshot?.iv,
    },
    guardrails: {
      maxHoldTime: maxHoldHours * 60,
      timeStops: timeStopsMinutes,
      progressChecks,
      thetaBurnLimit: policy.thetaBurnLimit,
      invalidationLevels: {
        stopLoss: -stopLossPercent,
        thesisInvalidation: -30,
      },
      minDteExit: rule.min_dte_exit,
    },
    targets: {
      partialTakeProfitPercent: partialTargets,
      fullTakeProfitPercent: profitTargetPercent,
      stopLossPercent,
    },
    liveMarket: {
      timestamp: now.getTime(),
      underlyingPrice: market.underlyingPrice,
      optionBid: bid,
      optionAsk: ask,
      optionMid: market.optionMid,
      currentGreeks,
      currentIV,
      currentDTE: Math.round(dteNow * 10) / 10,
      spreadPercent,
      regime,
      gexState,
    },
  };
}
