/**
 * Adapter to build ExitDecisionInput from refactored_positions + exit_rules + market data.
 * Used by Exit Monitor to integrate the Exit Decision Engine for paper positions.
 */

import type { ExitDecisionInput } from './types.js';
import type { Greeks } from '../shared/types.js';

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

/**
 * Build ExitDecisionInput from position, exit_rules, and market snapshot.
 * Uses stub values for Greeks, regime, GEX when unavailable.
 */
export function buildExitDecisionInput(
  position: PositionRow,
  rule: ExitRuleRow,
  market: MarketSnapshot,
  now: Date
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

  const stopLossPercent = rule.stop_loss_percent ?? 50;
  const profitTargetPercent = rule.profit_target_percent ?? 50;
  const maxHoldHours = rule.max_hold_time_hours ?? 120;

  return {
    tradePosition: {
      id: position.position_id,
      symbol: position.symbol,
      direction: position.type === 'call' ? 'CALL' : 'PUT',
      setupType: 'SWING',
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
      ivAtEntry: undefined,
    },
    guardrails: {
      maxHoldTime: maxHoldHours * 60,
      timeStops: [],
      progressChecks: [
        { atMinute: 60, minProfitPercent: 0 },
        { atMinute: maxHoldHours * 30, minProfitPercent: 5 },
      ],
      thetaBurnLimit: 30,
      invalidationLevels: {
        stopLoss: -stopLossPercent,
        thesisInvalidation: -30,
      },
    },
    targets: {
      partialTakeProfitPercent: [25, 50, 80],
      fullTakeProfitPercent: profitTargetPercent,
      stopLossPercent,
    },
    liveMarket: {
      timestamp: now.getTime(),
      underlyingPrice: market.underlyingPrice,
      optionBid: market.optionBid ?? market.optionMid * 0.99,
      optionAsk: market.optionAsk ?? market.optionMid * 1.01,
      optionMid: market.optionMid,
      currentGreeks: ZERO_GREEKS,
      currentIV: 0,
      currentDTE: Math.round(dteNow * 10) / 10,
      spreadPercent: 0,
      regime: 'NEUTRAL',
      gexState: 'NEUTRAL',
    },
  };
}
