-- Options Engine: Research Dashboard - rollups, drift detection, context performance
-- Migration 060

-- Strategy performance rollups (computed nightly + intraday)
CREATE TABLE IF NOT EXISTS oe_strategy_rollups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES oe_trading_accounts(id),
  strategy_tag TEXT NOT NULL,
  period TEXT NOT NULL,
  computed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  sample_count INT NOT NULL,
  win_rate DECIMAL(5,4),
  avg_pnl DECIMAL(14,2),
  total_pnl DECIMAL(14,2),
  avg_r_multiple DECIMAL(8,4),
  avg_slippage DECIMAL(10,4),
  sharpe DECIMAL(8,4),
  max_drawdown DECIMAL(14,2),
  max_drawdown_pct DECIMAL(8,5),
  profit_factor DECIMAL(8,4),
  avg_holding_days DECIMAL(8,2),
  by_regime JSONB,
  by_dte_bucket JSONB,
  by_hour JSONB,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_oe_rollups_account_strategy
  ON oe_strategy_rollups(account_id, strategy_tag, computed_at DESC);

-- Drift detection events
CREATE TABLE IF NOT EXISTS oe_drift_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES oe_trading_accounts(id),
  strategy_tag TEXT NOT NULL,
  detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  drift_type TEXT NOT NULL,
  baseline_value DECIMAL(10,5) NOT NULL,
  current_value DECIMAL(10,5) NOT NULL,
  delta DECIMAL(10,5) NOT NULL,
  threshold DECIMAL(10,5) NOT NULL,
  baseline_window INT NOT NULL,
  rolling_window INT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'WARNING',
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMP,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_oe_drift_account_strategy
  ON oe_drift_events(account_id, strategy_tag, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_oe_drift_unresolved
  ON oe_drift_events(account_id, resolved) WHERE resolved = false;

-- Context performance (IV bucket, term shape, liquidity groupings)
CREATE TABLE IF NOT EXISTS oe_context_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES oe_trading_accounts(id),
  strategy_tag TEXT NOT NULL,
  context_type TEXT NOT NULL,
  context_value TEXT NOT NULL,
  computed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  sample_count INT NOT NULL,
  win_rate DECIMAL(5,4),
  avg_pnl DECIMAL(14,2),
  total_pnl DECIMAL(14,2),
  sharpe DECIMAL(8,4),
  avg_slippage DECIMAL(10,4),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_oe_ctx_perf_lookup
  ON oe_context_performance(account_id, strategy_tag, context_type, computed_at DESC);
