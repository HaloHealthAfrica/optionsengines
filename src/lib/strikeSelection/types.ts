import type { EventRisk, GEXState, Guardrails, Greeks, RegimeType, SetupType } from '../shared/types.js';

export interface StrikeSelectionInput {
  symbol: string;
  spotPrice: number;
  direction: 'CALL' | 'PUT';
  setupType: SetupType;
  signalConfidence: number;
  expectedHoldTime: number;
  expectedMovePercent: number;
  regime: RegimeType;
  gexState: GEXState;
  ivPercentile: number;
  eventRisk: EventRisk[];
  riskBudget: {
    maxPremiumLoss: number;
    maxCapitalAllocation: number;
  };
  optionChain: OptionContract[];
}

export interface OptionContract {
  expiry: string;
  dte: number;
  strike: number;
  bid: number;
  ask: number;
  mid: number;
  openInterest: number;
  volume: number;
  greeks: Greeks;
  iv: number;
}

export interface StrikeSelectionOutput {
  success: boolean;
  tradeContract?: {
    symbol: string;
    direction: 'CALL' | 'PUT';
    setupType: SetupType;
    expiry: string;
    dte: number;
    strike: number;
    midPrice: number;
    greeksSnapshot: Greeks;
  };
  scores?: {
    overall: number;
    breakdown: {
      liquidityFitness: number;
      greeksStability: number;
      thetaSurvivability: number;
      vegaIVAlignment: number;
      costEfficiency: number;
      gexSuitability: number;
    };
    weights: {
      liquidityFitness: number;
      greeksStability: number;
      thetaSurvivability: number;
      vegaIVAlignment: number;
      costEfficiency: number;
      gexSuitability: number;
    };
  };
  guardrails?: Guardrails;
  rationale?: string[];
  failureReason?: 'NO_VALID_STRIKE';
  failedChecks?: string[];
}
