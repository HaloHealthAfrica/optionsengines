-- Add trade-level columns to decision_snapshots so the dashboard
-- reads real data rather than deriving placeholder prices.

ALTER TABLE decision_snapshots
  ADD COLUMN IF NOT EXISTS entry_price_low     NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_price_high    NUMERIC,
  ADD COLUMN IF NOT EXISTS exit_price_partial  NUMERIC,
  ADD COLUMN IF NOT EXISTS exit_price_full     NUMERIC,
  ADD COLUMN IF NOT EXISTS invalidation_price  NUMERIC,
  ADD COLUMN IF NOT EXISTS option_stop_pct     NUMERIC DEFAULT 50;
