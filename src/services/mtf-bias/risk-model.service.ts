/**
 * MTF Bias Risk Model
 * Position sizing: risk_per_trade = baseRisk * confidence_score
 * position_size = risk_per_trade / (entry_price - invalidation_level)
 */

import type { SymbolMarketState } from '../../lib/mtfBias/types.js';

const MIN_RR = 1.5;
const MAX_RISK_PER_TRADE_PCT = 2;
const MAX_CONTRACTS = 10;

export interface RiskModelInput {
  entryPrice: number;
  atr: number;
  accountRiskPercent: number;
  baseRisk?: number;
}

export interface RiskModelOutput {
  positionSize: number;
  riskPerTrade: number;
  minRr: number;
  valid: boolean;
}

export const riskModelService = {
  async computePositionSize(
    state: SymbolMarketState,
    input: RiskModelInput
  ): Promise<RiskModelOutput | null> {
    const { entryPrice, atr, accountRiskPercent } = input;
    const baseRisk = input.baseRisk ?? (accountRiskPercent / 100);
    const invalidation = state.invalidation_level;

    if (!invalidation || invalidation >= entryPrice) {
      return null;
    }

    const riskPerTrade = baseRisk * state.confidence_score;
    const riskPerTradeCapped = Math.min(riskPerTrade, MAX_RISK_PER_TRADE_PCT / 100);
    const riskAmount = entryPrice * riskPerTradeCapped;
    const stopDistance = Math.abs(entryPrice - invalidation);

    if (stopDistance <= 0) return null;

    let positionSize = riskAmount / stopDistance;
    positionSize = Math.floor(Math.min(positionSize, MAX_CONTRACTS));
    positionSize = Math.max(1, positionSize);

    const rewardDistance = atr * MIN_RR;
    const rr = rewardDistance / stopDistance;
    const valid = rr >= MIN_RR;

    return {
      positionSize,
      riskPerTrade: riskPerTradeCapped,
      minRr: rr,
      valid,
    };
  },
};
