-- Migration 043: Add engine column to bias_trade_performance for A/B comparison
ALTER TABLE bias_trade_performance
  ADD COLUMN IF NOT EXISTS engine VARCHAR(1) CHECK (engine IN ('A', 'B'));

CREATE INDEX IF NOT EXISTS idx_bias_trade_performance_engine ON bias_trade_performance(engine) WHERE engine IS NOT NULL;
