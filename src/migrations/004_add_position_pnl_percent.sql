-- Migration 004: Add position_pnl_percent to refactored_positions
-- Description: Store position P&L percentage

ALTER TABLE refactored_positions
  ADD COLUMN IF NOT EXISTS position_pnl_percent DECIMAL(8, 4);

CREATE INDEX IF NOT EXISTS idx_positions_pnl_percent ON refactored_positions(position_pnl_percent);
