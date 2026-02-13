-- Migration 018: Schema hardening - symbol and error_message to TEXT, indexes
-- Description: Prevents truncation for long symbols; error_message already TEXT in webhook_events
-- Run with: SKIP_MIGRATIONS=false

-- signals: symbol VARCHAR(20) -> TEXT
ALTER TABLE signals ALTER COLUMN symbol TYPE TEXT USING symbol::TEXT;

-- orders: symbol VARCHAR(20) -> TEXT, option_symbol VARCHAR(50) -> TEXT
ALTER TABLE orders ALTER COLUMN symbol TYPE TEXT USING symbol::TEXT;
ALTER TABLE orders ALTER COLUMN option_symbol TYPE TEXT USING option_symbol::TEXT;

-- refactored_positions: symbol VARCHAR(20) -> TEXT, option_symbol VARCHAR(50) -> TEXT
ALTER TABLE refactored_positions ALTER COLUMN symbol TYPE TEXT USING symbol::TEXT;
ALTER TABLE refactored_positions ALTER COLUMN option_symbol TYPE TEXT USING option_symbol::TEXT;

-- webhook_events: symbol VARCHAR(20) -> TEXT (error_message already TEXT)
ALTER TABLE webhook_events ALTER COLUMN symbol TYPE TEXT USING symbol::TEXT;

-- Add composite index for position lookups (status + symbol)
CREATE INDEX IF NOT EXISTS idx_refactored_positions_status_symbol 
  ON refactored_positions(status, symbol);
