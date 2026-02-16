-- Migration 035: Tag bias_trade_performance with strat_plan_id and setup_type for feedback loop
ALTER TABLE bias_trade_performance
  ADD COLUMN IF NOT EXISTS strat_plan_id UUID REFERENCES strat_plans(plan_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS setup_type VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_bias_trade_performance_strat_plan ON bias_trade_performance(strat_plan_id) WHERE strat_plan_id IS NOT NULL;
