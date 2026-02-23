-- Options Engine: Decision Traces (Cross-cutting observability)
-- One trace per signal attempt, including replays

CREATE TABLE IF NOT EXISTS oe_decision_traces (
  decision_trace_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT NOT NULL,
  signal_id UUID NOT NULL,
  is_replay BOOLEAN NOT NULL DEFAULT FALSE,
  latency_mode TEXT NOT NULL CHECK (latency_mode IN ('CACHED', 'COLD')),
  system_state_at_decision TEXT NOT NULL
    CHECK (system_state_at_decision IN ('ACTIVE', 'PAUSED', 'EMERGENCY_STOP')),
  trade_intent_snapshot JSONB,
  sanity_validation_result JSONB,
  construction_result JSONB,
  candidates_scored_top5 JSONB,
  governor_result JSONB,
  capital_validation JSONB,
  bucket_validation JSONB,
  policy_gate_result JSONB,
  latency_budget_result JSONB,
  position_state_transition JSONB,
  final_orders JSONB,
  fills JSONB,
  slippage_audit_ids UUID[] DEFAULT '{}',
  pnl_outcome DECIMAL(14,2),
  regime_at_decision JSONB,
  underlying_liquidity_ratio DECIMAL(8,5),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_oe_dt_account
  ON oe_decision_traces(account_id);
CREATE INDEX IF NOT EXISTS idx_oe_dt_signal
  ON oe_decision_traces(signal_id);
CREATE INDEX IF NOT EXISTS idx_oe_dt_strategy
  ON oe_decision_traces((trade_intent_snapshot->>'strategyTag'));
CREATE INDEX IF NOT EXISTS idx_oe_dt_created
  ON oe_decision_traces(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oe_dt_replay
  ON oe_decision_traces(is_replay) WHERE is_replay = TRUE;
CREATE INDEX IF NOT EXISTS idx_oe_dt_system_state
  ON oe_decision_traces(system_state_at_decision);

-- Slippage audits
CREATE TABLE IF NOT EXISTS oe_slippage_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID,
  account_id TEXT NOT NULL,
  position_id UUID,
  option_ticker TEXT NOT NULL,
  expected_price DECIMAL(10,4) NOT NULL,
  submitted_limit_price DECIMAL(10,4) NOT NULL,
  fill_price DECIMAL(10,4),
  slippage_dollars DECIMAL(10,4) NOT NULL DEFAULT 0,
  slippage_pct DECIMAL(8,5) NOT NULL DEFAULT 0,
  spread_width_pct_at_submit DECIMAL(8,5) NOT NULL,
  liquidity_score_at_submit DECIMAL(8,5) NOT NULL,
  underlying_price_at_submit DECIMAL(10,4) NOT NULL,
  seconds_to_fill INT,
  reprice_count INT NOT NULL DEFAULT 0,
  fill_status TEXT NOT NULL CHECK (fill_status IN ('FILLED', 'PARTIAL', 'CANCELLED', 'TIMEOUT')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  idempotency_key UUID NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oe_slippage_account
  ON oe_slippage_audits(account_id);
CREATE INDEX IF NOT EXISTS idx_oe_slippage_position
  ON oe_slippage_audits(position_id);
CREATE INDEX IF NOT EXISTS idx_oe_slippage_idempotency
  ON oe_slippage_audits(idempotency_key);
