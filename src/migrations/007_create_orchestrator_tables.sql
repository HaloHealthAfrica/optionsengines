-- Migration 007: Create Trading Orchestrator Agent tables
-- Description: Tables for experiment tracking, execution policies, market contexts, and trade outcomes

-- Update signals table to add orchestrator fields
ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS processed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS experiment_id UUID;

CREATE INDEX IF NOT EXISTS idx_signals_processed ON signals(processed) WHERE processed = FALSE;
CREATE INDEX IF NOT EXISTS idx_signals_experiment_id ON signals(experiment_id);

-- experiments: Tracks variant assignments per signal
CREATE TABLE IF NOT EXISTS experiments (
  experiment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL REFERENCES signals(signal_id) ON DELETE CASCADE,
  variant VARCHAR(1) NOT NULL CHECK (variant IN ('A', 'B')),
  assignment_hash VARCHAR(64) NOT NULL,
  split_percentage DECIMAL(3,2) NOT NULL DEFAULT 0.50,
  policy_version VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(signal_id)
);

CREATE INDEX IF NOT EXISTS idx_experiments_variant ON experiments(variant);
CREATE INDEX IF NOT EXISTS idx_experiments_created_at ON experiments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_experiments_signal_id ON experiments(signal_id);

-- execution_policies: Records execution decisions per experiment
CREATE TABLE IF NOT EXISTS execution_policies (
  policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES experiments(experiment_id) ON DELETE CASCADE,
  execution_mode VARCHAR(30) NOT NULL CHECK (execution_mode IN ('SHADOW_ONLY', 'ENGINE_A_PRIMARY', 'ENGINE_B_PRIMARY', 'SPLIT_CAPITAL')),
  executed_engine VARCHAR(1) CHECK (executed_engine IN ('A', 'B')),
  shadow_engine VARCHAR(1) CHECK (shadow_engine IN ('A', 'B')),
  reason TEXT NOT NULL,
  policy_version VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_execution_policies_experiment ON execution_policies(experiment_id);
CREATE INDEX IF NOT EXISTS idx_execution_policies_mode ON execution_policies(execution_mode);

-- market_contexts: Stores market snapshots for audit and replay
CREATE TABLE IF NOT EXISTS market_contexts (
  context_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL REFERENCES signals(signal_id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  symbol VARCHAR(10) NOT NULL,
  current_price DECIMAL(10,2) NOT NULL,
  bid DECIMAL(10,2) NOT NULL,
  ask DECIMAL(10,2) NOT NULL,
  volume INTEGER NOT NULL,
  indicators JSONB NOT NULL,
  context_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_contexts_signal ON market_contexts(signal_id);
CREATE INDEX IF NOT EXISTS idx_market_contexts_timestamp ON market_contexts(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_market_contexts_context_hash ON market_contexts(context_hash);

-- trade_outcomes: Links trades to experiments for performance attribution
CREATE TABLE IF NOT EXISTS trade_outcomes (
  outcome_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES experiments(experiment_id) ON DELETE CASCADE,
  engine VARCHAR(1) NOT NULL CHECK (engine IN ('A', 'B')),
  trade_id UUID NOT NULL,
  entry_price DECIMAL(10,2) NOT NULL,
  exit_price DECIMAL(10,2) NOT NULL,
  pnl DECIMAL(10,2) NOT NULL,
  exit_reason VARCHAR(20) NOT NULL,
  entry_time TIMESTAMPTZ NOT NULL,
  exit_time TIMESTAMPTZ NOT NULL,
  is_shadow BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_outcomes_experiment ON trade_outcomes(experiment_id);
CREATE INDEX IF NOT EXISTS idx_trade_outcomes_engine ON trade_outcomes(engine);
CREATE INDEX IF NOT EXISTS idx_trade_outcomes_is_shadow ON trade_outcomes(is_shadow);
CREATE INDEX IF NOT EXISTS idx_trade_outcomes_entry_time ON trade_outcomes(entry_time DESC);

-- Comments for documentation
COMMENT ON TABLE experiments IS 'Tracks which engine variant (A or B) was assigned to process each signal';
COMMENT ON TABLE execution_policies IS 'Records execution policy decisions (which engine executes real vs shadow trades)';
COMMENT ON TABLE market_contexts IS 'Stores market state snapshots at signal time for deterministic replay';
COMMENT ON TABLE trade_outcomes IS 'Links trade results to experiments for performance attribution and comparison';

COMMENT ON COLUMN signals.processed IS 'Whether the signal has been processed by the orchestrator';
COMMENT ON COLUMN signals.experiment_id IS 'Link to the experiment created for this signal';
COMMENT ON COLUMN experiments.variant IS 'Engine variant assigned (A=rule-based, B=multi-agent AI)';
COMMENT ON COLUMN experiments.assignment_hash IS 'Deterministic hash used for variant assignment';
COMMENT ON COLUMN execution_policies.execution_mode IS 'Execution policy mode (SHADOW_ONLY, ENGINE_A_PRIMARY, etc.)';
COMMENT ON COLUMN market_contexts.context_hash IS 'SHA-256 hash of market context for verification';
COMMENT ON COLUMN trade_outcomes.is_shadow IS 'Whether this is a shadow trade (not executed with real capital)';
