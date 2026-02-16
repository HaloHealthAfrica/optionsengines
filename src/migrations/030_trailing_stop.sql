-- Phase 1c: Trailing stop support
-- Adds high water mark tracking and trailing stop price to positions
-- Adds trailing stop configuration to exit rules

ALTER TABLE refactored_positions
  ADD COLUMN IF NOT EXISTS high_water_mark DECIMAL(10,4),
  ADD COLUMN IF NOT EXISTS trailing_stop_price DECIMAL(10,4);

ALTER TABLE exit_rules
  ADD COLUMN IF NOT EXISTS trailing_stop_percent DECIMAL(5,2) DEFAULT 15.00,
  ADD COLUMN IF NOT EXISTS trailing_stop_activation_percent DECIMAL(5,2) DEFAULT 20.00;

-- Backfill existing open positions: set high_water_mark to the greater of entry_price and current_price
UPDATE refactored_positions
SET high_water_mark = GREATEST(entry_price, COALESCE(current_price, entry_price))
WHERE status IN ('open', 'closing')
  AND high_water_mark IS NULL;
