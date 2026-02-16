-- Migration 031: Phase 2b + 3a + 3b schema changes
-- Phase 2b: Fix refactored_signals unique constraint for ON CONFLICT
-- Phase 3a: Add is_test columns to orders, refactored_positions, trades
-- Phase 3b: Add instance isolation columns to signals

-- Phase 2b: Add UNIQUE constraint to refactored_signals(signal_id)
-- Required for ON CONFLICT (signal_id) DO UPDATE to work
CREATE UNIQUE INDEX IF NOT EXISTS idx_refactored_signals_signal_id_unique
  ON refactored_signals(signal_id);

-- Phase 3a: Propagate is_test flag through the full pipeline
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE;

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE;

ALTER TABLE refactored_positions
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_orders_is_test ON orders(is_test) WHERE is_test = TRUE;
CREATE INDEX IF NOT EXISTS idx_positions_is_test ON refactored_positions(is_test) WHERE is_test = TRUE;

-- Phase 3b: Instance isolation — track which instance claimed a signal
ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS locked_by TEXT,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_signals_locked_by ON signals(locked_by) WHERE locked_by IS NOT NULL;
