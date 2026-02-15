-- Migration 025: Bias State Aggregator (V3)
-- Canonical state: bias_state_current, bias_state_history
-- Invalid payload audit: bias_webhook_events
-- Config-driven gating: bias_config

-- bias_webhook_events: audit invalid (and optionally valid) webhook payloads
CREATE TABLE IF NOT EXISTS bias_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id_raw TEXT NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'unknown',
  raw_payload JSONB,
  validation_status VARCHAR(20) NOT NULL CHECK (validation_status IN ('VALID', 'INVALID')),
  validation_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bias_webhook_events_event_id_raw
  ON bias_webhook_events(event_id_raw);
CREATE INDEX IF NOT EXISTS idx_bias_webhook_events_symbol ON bias_webhook_events(symbol);
CREATE INDEX IF NOT EXISTS idx_bias_webhook_events_created ON bias_webhook_events(created_at DESC);

COMMENT ON TABLE bias_webhook_events IS 'Bias webhook audit - invalid payloads and idempotency';

-- bias_state_current: canonical per-symbol state (replaces symbol_market_state for V3)
CREATE TABLE IF NOT EXISTS bias_state_current (
  symbol VARCHAR(20) PRIMARY KEY,
  updated_at_ms BIGINT NOT NULL,
  source VARCHAR(50) NOT NULL,
  state_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bias_state_current_updated ON bias_state_current(updated_at_ms DESC);

COMMENT ON TABLE bias_state_current IS 'Canonical bias state per symbol - V3 unified state';

-- bias_state_history: audit trail with event_id_raw for idempotency
CREATE TABLE IF NOT EXISTS bias_state_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(20) NOT NULL,
  event_id_raw TEXT NOT NULL,
  event_ts_ms BIGINT NOT NULL,
  event_id VARCHAR(64) NOT NULL,
  source VARCHAR(50) NOT NULL,
  event_type VARCHAR(50),
  state_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bias_state_history_event_id_raw
  ON bias_state_history(event_id_raw);
CREATE INDEX IF NOT EXISTS idx_bias_state_history_symbol_ts ON bias_state_history(symbol, event_ts_ms DESC);
CREATE INDEX IF NOT EXISTS idx_bias_state_history_created ON bias_state_history(created_at DESC);

COMMENT ON TABLE bias_state_history IS 'Bias state history - idempotency and audit';

-- bias_config: config-driven gating rules
CREATE TABLE IF NOT EXISTS bias_config (
  config_key VARCHAR(50) PRIMARY KEY,
  config_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO bias_config (config_key, config_json, updated_at)
VALUES (
  'gating',
  '{
    "macroSuppressLongClasses": ["MACRO_BREAKDOWN_CONFIRMED", "MACRO_TREND_DOWN"],
    "macroSuppressShortClasses": ["MACRO_TREND_UP"],
    "breakoutLowSpacePenalty": 0.25,
    "reclaimBoost": 0.08,
    "chopSuppressionThreshold": 75,
    "regimeTransitionBoost": 0.05,
    "macroConflictRiskMultiplier": 0.6
  }'::jsonb,
  NOW()
)
ON CONFLICT (config_key) DO NOTHING;

COMMENT ON TABLE bias_config IS 'Bias aggregator config - effective gating rules';
