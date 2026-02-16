/**
 * Strat Plan Lifecycle Engine - Types
 * Focused tactical execution, max 10 tickers, controlled plan capacity
 */

export type WatchlistSource = 'manual' | 'webhook';

export type StratPlanState =
  | 'PLANNED'
  | 'QUEUED'
  | 'BLOCKED'
  | 'IN_FORCE'
  | 'TRIGGERED'
  | 'EXECUTED'
  | 'EXPIRED'
  | 'REJECTED';

export type PlanSource = 'manual' | 'webhook';

export interface WatchlistEntry {
  watchlist_id: string;
  symbol: string;
  added_at: Date;
  source: WatchlistSource;
  priority_score: number;
  active: boolean;
  created_at?: Date;
  updated_at?: Date;
}

export interface StratPlan {
  plan_id: string;
  symbol: string;
  direction: 'long' | 'short';
  timeframe: string;
  source: PlanSource;
  state: StratPlanState;
  signal_id: string | null;
  raw_payload: Record<string, unknown> | null;
  risk_reward: number | null;
  atr_percent: number | null;
  expected_move_alignment: number | null;
  gamma_bias: number | null;
  liquidity_score: number | null;
  engine_confidence: number | null;
  priority_score: number | null;
  in_force_at: Date | null;
  expires_at: Date | null;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface StratPlanConfig {
  maxWatchlistTickers: number;
  maxConcurrentPlans: number;
  maxPlansPerTicker: number;
  maxInForceSimultaneous: number;
  webhookAutoAddToWatchlist: boolean;
  killSwitchConsecutiveFailures: number;
}

export interface PlanPrioritizationInput {
  riskReward?: number;
  atrPercent?: number;
  expectedMoveAlignment?: number;
  gammaBias?: number;
  liquidityScore?: number;
  engineConfidence?: number;
  recencyBonus?: number;
}
