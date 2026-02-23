-- Options Engine: Attribution rows and strategy weights
-- Migration 055

-- Per-trade attribution records
CREATE TABLE IF NOT EXISTS oe_attribution_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES oe_trading_accounts(id),
  position_id UUID NOT NULL,
  strategy_tag TEXT NOT NULL,
  underlying TEXT NOT NULL,
  structure TEXT NOT NULL,
  iv_regime TEXT NOT NULL,
  term_shape TEXT NOT NULL,
  entry_date TIMESTAMP NOT NULL,
  exit_date TIMESTAMP,
  dte_at_entry INT NOT NULL,
  delta_at_entry DECIMAL(8,5),
  contracts INT NOT NULL,
  entry_price DECIMAL(10,4) NOT NULL,
  exit_price DECIMAL(10,4),
  realized_pnl DECIMAL(14,2),
  max_favorable_excursion DECIMAL(14,2),
  max_adverse_excursion DECIMAL(14,2),
  holding_period_days INT,
  slippage_dollars DECIMAL(10,4),
  liquidity_score_at_entry DECIMAL(8,5),
  regime_tag TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oe_attribution_account
  ON oe_attribution_rows(account_id);
CREATE INDEX IF NOT EXISTS idx_oe_attribution_strategy
  ON oe_attribution_rows(account_id, strategy_tag);
CREATE INDEX IF NOT EXISTS idx_oe_attribution_position
  ON oe_attribution_rows(position_id);

-- Strategy weights (current active weights)
CREATE TABLE IF NOT EXISTS oe_strategy_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES oe_trading_accounts(id),
  strategy_tag TEXT NOT NULL,
  weight DECIMAL(5,4) NOT NULL DEFAULT 1.0,
  sample_count INT NOT NULL DEFAULT 0,
  win_rate DECIMAL(5,4),
  avg_pnl DECIMAL(14,2),
  edge_score DECIMAL(8,5),
  last_updated TIMESTAMP NOT NULL DEFAULT NOW(),
  cooldown_remaining INT NOT NULL DEFAULT 0,
  UNIQUE(account_id, strategy_tag)
);

-- Strategy weight change log (immutable audit trail)
CREATE TABLE IF NOT EXISTS oe_strategy_weights_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES oe_trading_accounts(id),
  strategy_tag TEXT NOT NULL,
  from_weight DECIMAL(5,4) NOT NULL,
  to_weight DECIMAL(5,4) NOT NULL,
  reason TEXT NOT NULL,
  sample_count INT NOT NULL,
  win_rate DECIMAL(5,4),
  avg_pnl DECIMAL(14,2),
  timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oe_weights_log_account
  ON oe_strategy_weights_log(account_id, timestamp DESC);
