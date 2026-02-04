import type { GEXState, LiquidityState, RegimeType, SetupType } from '../shared/types.js';

export interface EntryDecisionInput {
  symbol: string;
  timestamp: number;
  direction: 'CALL' | 'PUT';
  setupType: SetupType;
  signal: {
    confidence: number;
    pattern: string;
    timeframe: string;
    confirmationPending?: boolean;
  };
  marketContext: {
    price: number;
    regime: RegimeType;
    gexState: GEXState;
    volatility: number;
    ivPercentile: number;
  };
  timingContext: {
    session: 'PRE_MARKET' | 'OPEN' | 'MORNING' | 'LUNCH' | 'AFTERNOON' | 'CLOSE' | 'AFTER_HOURS';
    minutesFromOpen: number;
    liquidityState: LiquidityState;
  };
  riskContext: {
    dailyPnL: number;
    openTradesCount: number;
    portfolioDelta: number;
    portfolioTheta: number;
  };
}

export interface EntryDecisionOutput {
  action: 'ENTER' | 'WAIT' | 'BLOCK';
  urgency: 'LOW' | 'MEDIUM' | 'HIGH';
  entryInstructions?: EntryInstructions;
  triggeredRules: RuleResult[];
  rationale: string[];
  timestamp: number;
}

export interface EntryInstructions {
  entryType: 'MARKET' | 'LIMIT' | 'STOP_LIMIT';
  confirmationRequired: boolean;
  maxWaitMinutes: number;
}

export interface RuleResult {
  tier: 1 | 2 | 3;
  rule: string;
  triggered: boolean;
  message: string;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH';
}
