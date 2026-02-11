// Trading Orchestrator Agent - Core Type Definitions
// These types define the data structures used throughout the orchestrator system

import { MarketIntelContext } from '../types/index.js';

/**
 * Signal - A normalized trading opportunity from TradingView webhooks
 */
export interface Signal {
  signal_id: string; // UUID
  symbol: string; // e.g., "SPY"
  direction: 'long' | 'short';
  timeframe: string; // e.g., "5m", "15m", "1h"
  timestamp: Date; // ISO8601
  signal_hash: string; // SHA-256 of signal inputs
  raw_payload: Record<string, any>; // Original webhook payload
  processed: boolean; // Processing status
  experiment_id?: string; // Link to experiment (optional until created)
  status?: string; // Signal status (pending, approved, rejected)
  queued_until?: Date | null;
  queued_at?: Date | null;
  queue_reason?: string | null;
  processing_attempts?: number;
  next_retry_at?: Date | null;
  created_at?: Date;
}

/**
 * MarketContext - Complete market state snapshot at signal time
 */
export interface MarketContext {
  context_id?: string; // UUID (optional, assigned on creation)
  signal_id: string; // Foreign key to signals
  timestamp: Date; // Snapshot time
  symbol: string;
  current_price: number;
  bid: number;
  ask: number;
  volume: number;
  indicators: Record<string, number>; // Technical indicators (RSI, MACD, etc.)
  marketIntel?: MarketIntelContext;
  context_hash: string; // SHA-256 of context for audit
  created_at?: Date;
}

/**
 * Experiment - Tracks which engine variant was assigned to process a signal
 */
export interface Experiment {
  experiment_id: string; // UUID
  signal_id: string; // Foreign key to signals
  variant: 'A' | 'B'; // A=Engine A (rule-based), B=Engine B (multi-agent AI)
  assignment_hash: string; // Deterministic hash for variant assignment
  split_percentage: number; // Capital split (0.0 to 1.0)
  policy_version: string; // e.g., "v1.0"
  created_at?: Date;
}

/**
 * ExecutionMode - Supported execution policy modes
 */
export type ExecutionMode = 
  | 'SHADOW_ONLY'        // No real trades, both engines shadow
  | 'ENGINE_A_PRIMARY'   // Engine A executes real, Engine B shadows
  | 'ENGINE_B_PRIMARY'   // Engine B executes real, Engine A shadows
  | 'SPLIT_CAPITAL';     // Both engines execute with split capital

/**
 * ExecutionPolicy - Execution policy decision for an experiment
 */
export interface ExecutionPolicy {
  policy_id?: string; // UUID (optional, assigned on creation)
  experiment_id: string;
  execution_mode: ExecutionMode;
  executed_engine: 'A' | 'B' | null; // Which engine executes real trades (null for SHADOW_ONLY)
  shadow_engine: 'A' | 'B' | null; // Which engine creates shadow trades
  reason: string; // Human-readable explanation
  policy_version: string; // e.g., "v1.0"
  created_at?: Date;
}

/**
 * TradeRecommendation - Engine's trade recommendation
 */
export interface TradeRecommendation {
  experiment_id: string;
  engine: 'A' | 'B';
  symbol: string;
  direction: 'long' | 'short';
  strike: number;
  expiration: Date;
  quantity: number;
  entry_price: number;
  stop_loss?: number;
  take_profit?: number;
  is_shadow: boolean;
}

/**
 * TradeOutcome - Result of a completed trade (real or shadow)
 */
export interface TradeOutcome {
  outcome_id?: string; // UUID (optional, assigned on creation)
  experiment_id: string;
  engine: 'A' | 'B';
  trade_id: string; // Foreign key to trades or shadow_trades
  entry_price: number;
  exit_price: number;
  pnl: number;
  exit_reason: string; // "stop_loss" | "take_profit" | "manual" | "expiration"
  entry_time: Date;
  exit_time: Date;
  is_shadow: boolean;
  created_at?: Date;
}

/**
 * ExperimentResult - Result of processing a signal through the orchestrator
 */
export interface ExperimentResult {
  experiment: Experiment;
  policy: ExecutionPolicy;
  market_context: MarketContext;
  engine_a_recommendation?: TradeRecommendation;
  engine_b_recommendation?: TradeRecommendation;
  success: boolean;
  error?: string;
  duration_ms?: number;
}

/**
 * PerformanceMetrics - Aggregated performance metrics per engine
 */
export interface PerformanceMetrics {
  engine: 'A' | 'B';
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number; // Percentage (0-100)
  total_pnl: number;
  average_pnl: number;
  max_win: number;
  max_loss: number;
  sharpe_ratio?: number;
}

/**
 * OrchestratorConfig - Configuration for the orchestrator
 */
export interface OrchestratorConfig {
  execution_mode: ExecutionMode;
  split_percentage: number; // For SPLIT_CAPITAL mode
  policy_version: string;
  engine_a_enabled: boolean;
  engine_b_enabled: boolean;
  polling_interval_ms: number; // Worker polling interval
  batch_size: number; // Number of signals to process per batch
}
