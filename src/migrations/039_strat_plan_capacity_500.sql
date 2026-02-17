-- Migration 039: Increase max concurrent plans to 500 for performance data collection
UPDATE strat_plan_config SET config_value = '500', updated_at = NOW()
WHERE config_key = 'max_concurrent_plans';
