-- Migration 001: Create Engine 1 database tables
-- Description: Core tables for traditional signal processing (Engine 1)

-- signals: Stores incoming trading signals from TradingView
CREATE TABLE IF NOT EXISTS signals (
  signal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(20) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('long', 'short')),
  timeframe VARCHAR(10) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON signals(timestamp DESC);

-- refactored_signals: Enhanced signal tracking with validation results
CREATE TABLE IF NOT EXISTS refactored_signals (
  refactored_signal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL REFERENCES signals(signal_id) ON DELETE CASCADE,
  enriched_data JSONB,
  risk_check_result JSONB,
  rejection_reason TEXT,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refactored_signals_signal_id ON refactored_signals(signal_id);

-- orders: Tracks all orders (paper and live)
CREATE TABLE IF NOT EXISTS orders (
  order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID REFERENCES signals(signal_id) ON DELETE SET NULL,
  symbol VARCHAR(20) NOT NULL,
  option_symbol VARCHAR(50) NOT NULL,
  strike DECIMAL(10, 2) NOT NULL,
  expiration DATE NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('call', 'put')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  order_type VARCHAR(20) NOT NULL CHECK (order_type IN ('paper', 'live')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending_execution' CHECK (status IN ('pending_execution', 'filled', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_signal_id ON orders(signal_id);
CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol);
CREATE INDEX IF NOT EXISTS idx_orders_order_type ON orders(order_type);

-- trades: Records of executed trades
CREATE TABLE IF NOT EXISTS trades (
  trade_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  fill_price DECIMAL(10, 4) NOT NULL,
  fill_quantity INTEGER NOT NULL,
  fill_timestamp TIMESTAMPTZ NOT NULL,
  commission DECIMAL(10, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_order_id ON trades(order_id);
CREATE INDEX IF NOT EXISTS idx_trades_fill_timestamp ON trades(fill_timestamp DESC);

-- refactored_positions: Tracks open and closed positions
CREATE TABLE IF NOT EXISTS refactored_positions (
  position_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

CREATE INDEX IF NOT EXISTS idx_positions_status ON refactored_positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_symbol ON refactored_positions(symbol);
CREATE INDEX IF NOT EXISTS idx_positions_expiration ON refactored_positions(expiration);

-- exit_rules: Configuration for exit conditions
CREATE TABLE IF NOT EXISTS exit_rules (
  rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name VARCHAR(50) NOT NULL,
  profit_target_percent DECIMAL(5, 2),
  stop_loss_percent DECIMAL(5, 2),
  max_hold_time_hours INTEGER,
  min_dte_exit INTEGER,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default exit rule
INSERT INTO exit_rules (rule_name, profit_target_percent, stop_loss_percent, max_hold_time_hours, min_dte_exit, enabled)
VALUES ('default', 50.00, 50.00, 120, 1, true)
ON CONFLICT DO NOTHING;

-- risk_limits: Risk management configuration
CREATE TABLE IF NOT EXISTS risk_limits (
  limit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  max_position_size INTEGER,
  max_total_exposure DECIMAL(10, 2),
  max_exposure_percent DECIMAL(5, 2),
  max_positions_per_symbol INTEGER,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default risk limits
INSERT INTO risk_limits (max_position_size, max_total_exposure, max_exposure_percent, max_positions_per_symbol, enabled)
VALUES (10, 10000.00, 20.00, 3, true)
ON CONFLICT DO NOTHING;

-- Comments for documentation
COMMENT ON TABLE signals IS 'Incoming trading signals from TradingView webhooks';
COMMENT ON TABLE refactored_signals IS 'Enriched signals with market context and risk checks';
COMMENT ON TABLE orders IS 'All orders (paper and live) created from approved signals';
COMMENT ON TABLE trades IS 'Executed trade records with fill prices and timestamps';
COMMENT ON TABLE refactored_positions IS 'Open and closed positions with P&L tracking';
COMMENT ON TABLE exit_rules IS 'Configuration for automatic exit conditions';
COMMENT ON TABLE risk_limits IS 'Risk management limits and constraints';
