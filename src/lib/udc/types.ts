export type UDCStatus =
  | 'NO_STRATEGY'
  | 'BLOCKED'
  | 'PLAN_CREATED';

export interface TradeIntent {
  strategy: string;
  symbol: string;
  direction: 'BULL' | 'BEAR';
  structure: string;
  invalidation: number;
  dteMin: number;
  dteMax: number;
  confidence: number;
}

export interface StrategyCandidate {
  intent: TradeIntent;
  confidence: number;
}

export interface GovernorResult {
  allowed: boolean;
  reason?: string;
}

export interface StrikeSelectionResult {
  symbol: string;
  structure: string;
  legs: OptionLeg[];
}

export interface OptionLeg {
  symbol: string;
  expiry: string;
  strike: number;
  type: 'CALL' | 'PUT';
  side: 'BUY' | 'SELL';
  quantity: number;
}

export interface SizedSelection extends StrikeSelectionResult {
  quantity: number;
  maxLoss: number;
}

export interface OrderPlan {
  planId: string;
  symbol: string;
  structure: string;
  legs: OptionLeg[];
  risk: {
    maxLoss: number;
  };
}

export interface PortfolioState {
  risk: {
    drawdownPct: number;
    positionCount: number;
    dailyPnL: number;
    maxDailyLoss: number;
    portfolioDelta: number;
    portfolioGamma: number;
    maxOpenPositions: number;
    dteConcentration: Record<string, number>;
    lastEntryTimestamp: number | null;
  };
}

export interface MarketSnapshot {
  symbol: string;
  price: number;
  timestamp: number;
  chain: OptionChainEntry[] | null;
  stale: boolean;
}

export interface OptionChainEntry {
  symbol: string;
  expiry: string;
  dte: number;
  strike: number;
  type: 'CALL' | 'PUT';
  bid: number;
  ask: number;
  mid: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
  volume: number;
  openInterest: number;
}

export interface UDCSignal {
  id: string;
  symbol: string;
  direction: string;
  timeframe: string;
  timestamp: number;
  pattern?: string;
  confidence?: number;
  raw_payload?: Record<string, unknown>;
}

export interface UDCResult {
  status: UDCStatus;
  reason?: string;
  plan?: OrderPlan;
  decision?: StrategyCandidate;
  decisionId: string;
  /** True when the result was returned from an existing snapshot (idempotent replay) */
  cached?: boolean;
}
