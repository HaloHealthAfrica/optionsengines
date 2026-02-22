-- Migration 040: Add exit_price to refactored_positions for full entry/exit tracking
-- Enables recording and displaying both entry and exit prices for all closed positions

ALTER TABLE refactored_positions
  ADD COLUMN IF NOT EXISTS exit_price DECIMAL(10, 4);

COMMENT ON COLUMN refactored_positions.exit_price IS 'Option price at position close; used with entry_price for full trade audit';

-- Backfill: derive exit_price from realized_pnl for existing closed positions (full exits only)
-- For LONG positions: exit = entry + pnl/(qty*multiplier)
-- For SHORT positions: exit = entry - pnl/(qty*multiplier)
UPDATE refactored_positions
SET exit_price = CASE
  WHEN COALESCE(position_side, 'LONG') = 'SHORT'
    THEN entry_price - (realized_pnl::numeric / (quantity * COALESCE(multiplier, 100)))
  ELSE entry_price + (realized_pnl::numeric / (quantity * COALESCE(multiplier, 100)))
END
WHERE status = 'closed'
  AND exit_price IS NULL
  AND realized_pnl IS NOT NULL
  AND quantity > 0
  AND entry_price > 0;
