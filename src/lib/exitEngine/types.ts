import type { GEXState, Guardrails, Greeks, RegimeType, SetupType } from '../shared/types.js';

export interface ExitDecisionInput {
  tradePosition: {
    id: string;
    symbol: string;
    direction: 'CALL' | 'PUT';
    setupType: SetupType;
  };
  entryData: {
    timestamp: number;
    underlyingEntryPrice: number;
    optionEntryPrice: number;
    contracts: number;
  };
  contractDetails: {
    expiry: string;
    dteAtEntry: number;
    strike: number;
    greeksAtEntry: Greeks;
    ivAtEntry?: number;
  };
  guardrails: Guardrails;
  targets: {
    partialTakeProfitPercent: number[];
    fullTakeProfitPercent: number;
    stopLossPercent: number;
  };
  liveMarket: {
    timestamp: number;
    underlyingPrice: number;
    optionBid: number;
    optionAsk: number;
    optionMid: number;
    currentGreeks: Greeks;
    currentIV: number;
    currentDTE: number;
    spreadPercent: number;
    regime: RegimeType;
    gexState: GEXState;
  };
  thesisStatus?: {
    confidenceNow: number;
    thesisValid: boolean;
    htfInvalidation: boolean;
  };
}

export interface ExitDecisionOutput {
  action: 'HOLD' | 'PARTIAL_EXIT' | 'FULL_EXIT' | 'TIGHTEN_STOP';
  urgency: 'LOW' | 'MEDIUM' | 'HIGH';
  sizePercent?: number;
  newStopLevel?: number;
  triggeredRules: RuleResult[];
  rationale: string[];
  metrics: {
    timeInTradeMinutes: number;
    optionPnLPercent: number;
    underlyingMovePercent: number;
    thetaBurnEstimate: number;
    deltaChange: number;
    ivChange: number;
    spreadPercent: number;
  };
  timestamp: number;
}

export interface RuleResult {
  tier: 1 | 2 | 3 | 4;
  rule: string;
  triggered: boolean;
  message: string;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface ExitPolicy {
  maxHoldMinutes: number;
  progressChecks: { atMinute: number; minProfitPercent: number }[];
  thetaBurnLimit: number;
  profitPartials: { atPercent: number; exitPercent: number }[];
  timeStops: { atDay: number; action: 'CHECK_PROGRESS' | 'EXIT_IF_FLAT' | 'TIGHTEN_STOP' | 'REVIEW_THESIS' }[];
}
