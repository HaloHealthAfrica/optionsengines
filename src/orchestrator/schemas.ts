// Trading Orchestrator Agent - Validation Schemas
// Zod schemas for runtime validation of orchestrator data structures

import { z } from 'zod';

/**
 * Signal Schema
 */
export const SignalSchema = z.object({
  signal_id: z.string().uuid(),
  symbol: z.string().min(1).max(20),
  direction: z.enum(['long', 'short']),
  timeframe: z.string().min(1).max(10),
  timestamp: z.date(),
  signal_hash: z.string().length(64), // SHA-256 hash
  raw_payload: z.record(z.any()),
  processed: z.boolean(),
  experiment_id: z.string().uuid().optional(),
  status: z.string().optional(),
  created_at: z.date().optional(),
});

/**
 * MarketContext Schema
 */
export const MarketContextSchema = z.object({
  context_id: z.string().uuid().optional(),
  signal_id: z.string().uuid(),
  timestamp: z.date(),
  symbol: z.string().min(1).max(10),
  current_price: z.number().positive(),
  bid: z.number().positive(),
  ask: z.number().positive(),
  volume: z.number().int().nonnegative(),
  indicators: z.record(z.number()),
  marketIntel: z
    .object({
      gamma: z
        .object({
          regime: z.enum(['LONG_GAMMA', 'SHORT_GAMMA', 'NEUTRAL']),
          zeroGammaLevel: z.number().optional(),
          distanceATR: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
  context_hash: z.string().length(64), // SHA-256 hash
  created_at: z.date().optional(),
});

/**
 * Experiment Schema
 */
export const ExperimentSchema = z.object({
  experiment_id: z.string().uuid(),
  signal_id: z.string().uuid(),
  variant: z.enum(['A', 'B']),
  assignment_hash: z.string().length(64), // SHA-256 hash
  split_percentage: z.number().min(0).max(1),
  policy_version: z.string().min(1).max(20),
  created_at: z.date().optional(),
});

/**
 * ExecutionMode Schema
 */
export const ExecutionModeSchema = z.enum([
  'SHADOW_ONLY',
  'ENGINE_A_PRIMARY',
  'ENGINE_B_PRIMARY',
  'SPLIT_CAPITAL',
]);

/**
 * ExecutionPolicy Schema
 */
export const ExecutionPolicySchema = z.object({
  policy_id: z.string().uuid().optional(),
  experiment_id: z.string().uuid(),
  execution_mode: ExecutionModeSchema,
  executed_engine: z.enum(['A', 'B']).nullable(),
  shadow_engine: z.enum(['A', 'B']).nullable(),
  reason: z.string().min(1),
  policy_version: z.string().min(1).max(20),
  created_at: z.date().optional(),
});

/**
 * TradeRecommendation Schema
 */
export const TradeRecommendationSchema = z.object({
  experiment_id: z.string().uuid(),
  engine: z.enum(['A', 'B']),
  symbol: z.string().min(1).max(20),
  direction: z.enum(['long', 'short']),
  strike: z.number().positive(),
  expiration: z.date(),
  quantity: z.number().int().positive(),
  entry_price: z.number().positive(),
  stop_loss: z.number().positive().optional(),
  take_profit: z.number().positive().optional(),
  is_shadow: z.boolean(),
});

/**
 * TradeOutcome Schema
 */
export const TradeOutcomeSchema = z.object({
  outcome_id: z.string().uuid().optional(),
  experiment_id: z.string().uuid(),
  engine: z.enum(['A', 'B']),
  trade_id: z.string().uuid(),
  entry_price: z.number().positive(),
  exit_price: z.number().positive(),
  pnl: z.number(),
  exit_reason: z.string().min(1).max(20),
  entry_time: z.date(),
  exit_time: z.date(),
  is_shadow: z.boolean(),
  created_at: z.date().optional(),
});

/**
 * ExperimentResult Schema
 */
export const ExperimentResultSchema = z.object({
  experiment: ExperimentSchema,
  policy: ExecutionPolicySchema,
  market_context: MarketContextSchema,
  engine_a_recommendation: TradeRecommendationSchema.optional(),
  engine_b_recommendation: TradeRecommendationSchema.optional(),
  success: z.boolean(),
  error: z.string().optional(),
});

/**
 * PerformanceMetrics Schema
 */
export const PerformanceMetricsSchema = z.object({
  engine: z.enum(['A', 'B']),
  total_trades: z.number().int().nonnegative(),
  winning_trades: z.number().int().nonnegative(),
  losing_trades: z.number().int().nonnegative(),
  win_rate: z.number().min(0).max(100),
  total_pnl: z.number(),
  average_pnl: z.number(),
  max_win: z.number(),
  max_loss: z.number(),
  sharpe_ratio: z.number().optional(),
});

/**
 * OrchestratorConfig Schema
 */
export const OrchestratorConfigSchema = z.object({
  execution_mode: ExecutionModeSchema,
  split_percentage: z.number().min(0).max(1),
  policy_version: z.string().min(1).max(20),
  engine_a_enabled: z.boolean(),
  engine_b_enabled: z.boolean(),
  polling_interval_ms: z.number().int().positive(),
  batch_size: z.number().int().positive(),
});

/**
 * Webhook Payload Schema (for validation at webhook handler)
 */
export const WebhookPayloadSchema = z.object({
  symbol: z.string().min(1).max(20),
  direction: z.enum(['long', 'short']),
  timeframe: z.string().min(1).max(10),
  timestamp: z.string().datetime(), // ISO8601 string
  // Additional fields are optional and stored in raw_payload
}).passthrough(); // Allow additional fields

/**
 * Type inference helpers
 */
export type SignalInput = z.infer<typeof SignalSchema>;
export type MarketContextInput = z.infer<typeof MarketContextSchema>;
export type ExperimentInput = z.infer<typeof ExperimentSchema>;
export type ExecutionPolicyInput = z.infer<typeof ExecutionPolicySchema>;
export type TradeRecommendationInput = z.infer<typeof TradeRecommendationSchema>;
export type TradeOutcomeInput = z.infer<typeof TradeOutcomeSchema>;
export type ExperimentResultInput = z.infer<typeof ExperimentResultSchema>;
export type PerformanceMetricsInput = z.infer<typeof PerformanceMetricsSchema>;
export type OrchestratorConfigInput = z.infer<typeof OrchestratorConfigSchema>;
export type WebhookPayloadInput = z.infer<typeof WebhookPayloadSchema>;
