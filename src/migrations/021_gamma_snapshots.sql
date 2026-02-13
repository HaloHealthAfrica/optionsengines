-- Gamma snapshots for GammaDealerStrategy
-- Stores Unusual Whales gamma exposure data for regime detection and strategy decisions

CREATE TABLE IF NOT EXISTS gamma_snapshots (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  net_gamma DECIMAL(24, 4) NOT NULL,
  gamma_flip DECIMAL(18, 4),
  call_gamma DECIMAL(24, 4),
  put_gamma DECIMAL(24, 4),
  total_call_oi BIGINT,
  total_put_oi BIGINT,
  zero_dte_gamma DECIMAL(24, 4),
  gamma_by_strike JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source VARCHAR(50) DEFAULT 'unusualwhales'
);

CREATE INDEX IF NOT EXISTS idx_gamma_snapshots_symbol_created
  ON gamma_snapshots (symbol, created_at DESC);

COMMENT ON TABLE gamma_snapshots IS 'Gamma exposure snapshots from Unusual Whales for GammaDealerStrategy';

-- Add meta_gamma to shadow_trades, refactored_signals, and signals for gamma strategy metadata
ALTER TABLE shadow_trades ADD COLUMN IF NOT EXISTS meta_gamma JSONB;
ALTER TABLE refactored_signals ADD COLUMN IF NOT EXISTS meta_gamma JSONB;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS meta_gamma JSONB;
