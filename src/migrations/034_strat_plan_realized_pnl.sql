-- Migration 034: Add realized_pnl to strat_plans for position close tracking
ALTER TABLE strat_plans
  ADD COLUMN IF NOT EXISTS realized_pnl DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

COMMENT ON COLUMN strat_plans.realized_pnl IS 'Realized PnL when linked position is closed';
