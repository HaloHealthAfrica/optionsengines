-- Engine B Rebuild: Dynamic agent weighting and trade attribution

-- Agent weight configuration (dynamic weights updated daily)
CREATE TABLE IF NOT EXISTS agent_weight_config (
  agent_name VARCHAR(50) PRIMARY KEY,
  current_weight DECIMAL(6, 4) NOT NULL DEFAULT 0.10,
  previous_weight DECIMAL(6, 4),
  rolling_sharpe DECIMAL(8, 4),
  trade_count INTEGER DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agent weight change history (audit trail)
CREATE TABLE IF NOT EXISTS agent_weight_history (
  id SERIAL PRIMARY KEY,
  snapshot_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-agent trade P&L attribution for dynamic weighting
CREATE TABLE IF NOT EXISTS agent_trade_attribution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id UUID NOT NULL,
  experiment_id UUID,
  agent_name VARCHAR(50) NOT NULL,
  agent_bias VARCHAR(10) NOT NULL,
  agent_confidence DECIMAL(5, 2) NOT NULL,
  pnl_contribution DECIMAL(10, 4),
  trade_pnl DECIMAL(10, 4),
  agent_weight_at_entry DECIMAL(6, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_trade_attr_agent
  ON agent_trade_attribution (agent_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_trade_attr_position
  ON agent_trade_attribution (position_id);

-- Seed default weights for all Engine B agents
INSERT INTO agent_weight_config (agent_name, current_weight, active, updated_at) VALUES
  ('context',           0.12, true, NOW()),
  ('technical',         0.18, true, NOW()),
  ('risk',              0.15, true, NOW()),
  ('regime_classifier', 0.12, true, NOW()),
  ('volatility',        0.10, true, NOW()),
  ('liquidity',         0.08, true, NOW()),
  ('correlation_risk',  0.08, true, NOW()),
  ('mtf_trend',         0.07, true, NOW()),
  ('gamma_flow',        0.10, true, NOW()),
  ('orb_specialist',    0.10, true, NOW()),
  ('strat_specialist',  0.10, true, NOW()),
  ('ttm_specialist',    0.10, true, NOW())
ON CONFLICT (agent_name) DO NOTHING;
