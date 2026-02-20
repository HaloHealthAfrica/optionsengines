-- Migration 044: Store Greeks and IV at entry time for exit engine accuracy
-- Description: Exit engine tier 4 rules (DELTA_DECAY, GAMMA_STALL, THETA_ACCELERATION,
-- VEGA_IV_SHOCK) compare current Greeks against entry Greeks. Without these columns,
-- the position adapter defaults to ZERO_GREEKS, making all change calculations meaningless.

ALTER TABLE refactored_positions
  ADD COLUMN IF NOT EXISTS greeks_at_entry JSONB,
  ADD COLUMN IF NOT EXISTS iv_at_entry DECIMAL(8, 6);
