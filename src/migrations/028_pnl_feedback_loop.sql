-- Migration 028: P&L Feedback Loop - Trade outcome capture and adaptive tuning

-- Add entry/exit state snapshots to refactored_positions for performance correlation
ALTER TABLE refactored_positions ADD COLUMN IF NOT EXISTS entry_state_json JSONB;
ALTER TABLE refactored_positions ADD COLUMN IF NOT EXISTS entry_macro_class VARCHAR(50);
ALTER TABLE refactored_positions ADD COLUMN IF NOT EXISTS entry_acceleration_state_strength_delta DECIMAL(10,4);
ALTER TABLE refactored_positions ADD COLUMN IF NOT EXISTS exit_state_json JSONB;
ALTER TABLE refactored_positions ADD COLUMN IF NOT EXISTS exit_reason_codes TEXT[];

-- bias_trade_performance: Captured on trade close for rolling analysis
CREATE TABLE IF NOT EXISTS bias_trade_performance (
  id BIGSERIAL PRIMARY KEY,
  position_id UUID,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),
  pnl_r DECIMAL(12,4) NOT NULL,
  pnl_percent DECIMAL(10,4) NOT NULL,
  duration_minutes INTEGER NOT NULL,
  entry_bias_score DECIMAL(10,4),
  entry_macro_class VARCHAR(50),
  entry_regime VARCHAR(30),
  entry_intent VARCHAR(30),
  entry_acceleration DECIMAL(10,4),
  exit_reason_codes TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bias_trade_performance_symbol ON bias_trade_performance(symbol);
CREATE INDEX IF NOT EXISTS idx_bias_trade_performance_created ON bias_trade_performance(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bias_trade_performance_regime ON bias_trade_performance(entry_regime);
CREATE INDEX IF NOT EXISTS idx_bias_trade_performance_macro ON bias_trade_performance(entry_macro_class);

COMMENT ON TABLE bias_trade_performance IS 'Trade outcomes for P&L feedback - correlates with entry state';

-- bias_adaptive_config_history: Tracks parameter adjustments (reversible)
CREATE TABLE IF NOT EXISTS bias_adaptive_config_history (
  id BIGSERIAL PRIMARY KEY,
  config_key VARCHAR(50) NOT NULL,
  parameter_name VARCHAR(80) NOT NULL,
  previous_value JSONB NOT NULL,
  new_value JSONB NOT NULL,
  reason TEXT,
  rolling_metrics JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bias_adaptive_config_history_created ON bias_adaptive_config_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bias_adaptive_config_history_key ON bias_adaptive_config_history(config_key);

COMMENT ON TABLE bias_adaptive_config_history IS 'Adaptive tuning parameter change history - reversible';

-- Initial adaptive config (macro drift threshold, enabled, etc.)
INSERT INTO bias_config (config_key, config_json, updated_at)
VALUES (
  'adaptive',
  '{"macroDriftThreshold": 0.18, "enabled": true}'::jsonb,
  NOW()
)
ON CONFLICT (config_key) DO NOTHING;
