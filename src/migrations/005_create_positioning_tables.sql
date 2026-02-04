-- Migration 005: Create positioning analytics tables
-- Description: Stores GEX and options flow snapshots for historical analytics

CREATE TABLE IF NOT EXISTS gex_snapshots (
  gex_snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(20) NOT NULL,
  net_gex DECIMAL(18, 4) NOT NULL,
  total_call_gex DECIMAL(18, 4) NOT NULL,
  total_put_gex DECIMAL(18, 4) NOT NULL,
  zero_gamma_level DECIMAL(10, 4),
  dealer_position VARCHAR(20) NOT NULL CHECK (dealer_position IN ('long_gamma', 'short_gamma', 'neutral')),
  volatility_expectation VARCHAR(20) NOT NULL CHECK (volatility_expectation IN ('compressed', 'expanding', 'neutral')),
  levels JSONB,
  source VARCHAR(50) DEFAULT 'marketdata',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gex_snapshots_symbol ON gex_snapshots(symbol);
CREATE INDEX IF NOT EXISTS idx_gex_snapshots_created_at ON gex_snapshots(created_at DESC);

CREATE TABLE IF NOT EXISTS options_flow_snapshots (
  options_flow_snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(20) NOT NULL,
  total_call_volume INTEGER DEFAULT 0,
  total_put_volume INTEGER DEFAULT 0,
  entries JSONB,
  source VARCHAR(50) DEFAULT 'marketdata',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_options_flow_symbol ON options_flow_snapshots(symbol);
CREATE INDEX IF NOT EXISTS idx_options_flow_created_at ON options_flow_snapshots(created_at DESC);
