-- Migration 002: Create Engine 2 database tables
-- Description: Tables for multi-agent swarm decision system and A/B testing (Engine 2)

-- experiments: A/B test configuration and assignments
CREATE TABLE IF NOT EXISTS experiments (
  experiment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL REFERENCES signals(signal_id) ON DELETE CASCADE,
  variant VARCHAR(1) NOT NULL CHECK (variant IN ('A', 'B')),
  assignment_hash VARCHAR(64) NOT NULL,
  split_percentage INTEGER NOT NULL CHECK (split_percentage >= 0 AND split_percentage <= 100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_experiments_variant ON experiments(variant);
CREATE INDEX idx_experiments_signal_id ON experiments(signal_id);
CREATE INDEX idx_experiments_created_at ON experiments(created_at DESC);

-- agent_decisions: Individual agent outputs per signal
CREATE TABLE IF NOT EXISTS agent_decisions (
  decision_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES experiments(experiment_id) ON DELETE CASCADE,
  signal_id UUID NOT NULL REFERENCES signals(signal_id) ON DELETE CASCADE,
  agent_name VARCHAR(50) NOT NULL,
  agent_type VARCHAR(20) NOT NULL CHECK (agent_type IN ('core', 'specialist', 'subagent')),
  bias VARCHAR(20) NOT NULL CHECK (bias IN ('bullish', 'bearish', 'neutral')),
  confidence INTEGER NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  reasons JSONB,
  block BOOLEAN DEFAULT false,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_decisions_experiment_id ON agent_decisions(experiment_id);
CREATE INDEX idx_agent_decisions_signal_id ON agent_decisions(signal_id);
CREATE INDEX idx_agent_decisions_agent_name ON agent_decisions(agent_name);
CREATE INDEX idx_agent_decisions_agent_type ON agent_decisions(agent_type);

-- shadow_trades: Simulated trades from Engine 2
CREATE TABLE IF NOT EXISTS shadow_trades (
  shadow_trade_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES experiments(experiment_id) ON DELETE CASCADE,
  signal_id UUID NOT NULL REFERENCES signals(signal_id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  option_symbol VARCHAR(50) NOT NULL,
  strike DECIMAL(10, 2) NOT NULL,
  expiration DATE NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('call', 'put')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  entry_price DECIMAL(10, 4) NOT NULL,
  entry_timestamp TIMESTAMPTZ NOT NULL,
  contributing_agents JSONB,
  meta_confidence INTEGER CHECK (meta_confidence >= 0 AND meta_confidence <= 100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shadow_trades_experiment_id ON shadow_trades(experiment_id);
CREATE INDEX idx_shadow_trades_signal_id ON shadow_trades(signal_id);
CREATE INDEX idx_shadow_trades_symbol ON shadow_trades(symbol);
CREATE INDEX idx_shadow_trades_entry_timestamp ON shadow_trades(entry_timestamp DESC);

-- shadow_positions: Simulated positions from Engine 2
CREATE TABLE IF NOT EXISTS shadow_positions (
  shadow_position_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shadow_trade_id UUID NOT NULL REFERENCES shadow_trades(shadow_trade_id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  option_symbol VARCHAR(50) NOT NULL,
  strike DECIMAL(10, 2) NOT NULL,
  expiration DATE NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('call', 'put')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  entry_price DECIMAL(10, 4) NOT NULL,
  current_price DECIMAL(10, 4),
  unrealized_pnl DECIMAL(10, 2),
  realized_pnl DECIMAL(10, 2),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closing', 'closed')),
  entry_timestamp TIMESTAMPTZ NOT NULL,
  exit_timestamp TIMESTAMPTZ,
  exit_reason TEXT,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shadow_positions_status ON shadow_positions(status);
CREATE INDEX idx_shadow_positions_shadow_trade_id ON shadow_positions(shadow_trade_id);
CREATE INDEX idx_shadow_positions_symbol ON shadow_positions(symbol);
CREATE INDEX idx_shadow_positions_expiration ON shadow_positions(expiration);

-- agent_performance: Performance metrics per agent
CREATE TABLE IF NOT EXISTS agent_performance (
  performance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name VARCHAR(50) NOT NULL UNIQUE,
  total_signals INTEGER DEFAULT 0,
  approved_signals INTEGER DEFAULT 0,
  rejected_signals INTEGER DEFAULT 0,
  avg_confidence DECIMAL(5, 2),
  win_rate DECIMAL(5, 2),
  avg_win DECIMAL(10, 2),
  avg_loss DECIMAL(10, 2),
  expectancy DECIMAL(10, 2),
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_performance_agent_name ON agent_performance(agent_name);

-- feature_flags: System-wide feature flag configuration
CREATE TABLE IF NOT EXISTS feature_flags (
  flag_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT false,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by VARCHAR(100)
);

CREATE INDEX idx_feature_flags_name ON feature_flags(name);
CREATE INDEX idx_feature_flags_enabled ON feature_flags(enabled);

-- Insert default feature flags (all disabled by default)
INSERT INTO feature_flags (name, enabled, description) VALUES
  ('enable_variant_b', false, 'Master switch for Engine 2 (multi-agent system)'),
  ('enable_orb_specialist', false, 'Enable Opening Range Breakout specialist agent'),
  ('enable_strat_specialist', false, 'Enable The Strat methodology specialist agent'),
  ('enable_ttm_specialist', false, 'Enable TTM Squeeze specialist agent'),
  ('enable_satyland_subagent', false, 'Enable Satyland strategies sub-agent'),
  ('enable_shadow_execution', false, 'Enable shadow trade execution for Engine 2')
ON CONFLICT (name) DO NOTHING;

-- Comments for documentation
COMMENT ON TABLE experiments IS 'A/B test assignments routing signals to Engine 1 or Engine 2';
COMMENT ON TABLE agent_decisions IS 'Individual agent outputs and decisions for each signal';
COMMENT ON TABLE shadow_trades IS 'Simulated trades from Engine 2 (no live execution)';
COMMENT ON TABLE shadow_positions IS 'Simulated positions from Engine 2 with P&L tracking';
COMMENT ON TABLE agent_performance IS 'Performance metrics and statistics per agent';
COMMENT ON TABLE feature_flags IS 'Runtime feature toggles for Engine 2 functionality';
