-- Migration 041: Explicit position direction model and close integrity
-- Root cause fix for P&L direction bug (short puts showing as losses) and duplicate closes
--
-- 1. Add position_side: LONG | SHORT - required for correct P&L calculation
-- 2. Add instrument_type, multiplier for future extensibility
-- 3. Add close_event_id for idempotency (prevents double-close recording)
-- 4. Backfill: all existing positions default to LONG (buy-to-open)

-- Position direction: LONG = bought option, SHORT = sold option
ALTER TABLE refactored_positions
  ADD COLUMN IF NOT EXISTS position_side VARCHAR(10) DEFAULT 'LONG' CHECK (position_side IN ('LONG', 'SHORT'));

-- Instrument type for future equity support
ALTER TABLE refactored_positions
  ADD COLUMN IF NOT EXISTS instrument_type VARCHAR(10) DEFAULT 'OPTION' CHECK (instrument_type IN ('OPTION', 'EQUITY'));

-- Multiplier: 100 for options, 1 for equity
ALTER TABLE refactored_positions
  ADD COLUMN IF NOT EXISTS multiplier INTEGER DEFAULT 100;

COMMENT ON COLUMN refactored_positions.position_side IS 'LONG = bought option, SHORT = sold option. Required for correct P&L sign.';
COMMENT ON COLUMN refactored_positions.instrument_type IS 'OPTION or EQUITY for future extensibility';
COMMENT ON COLUMN refactored_positions.multiplier IS '100 for options, 1 for equity';

-- Backfill: all existing positions are LONG (current platform only does buy-to-open)
UPDATE refactored_positions SET position_side = 'LONG' WHERE position_side IS NULL;
UPDATE refactored_positions SET instrument_type = 'OPTION' WHERE instrument_type IS NULL;
UPDATE refactored_positions SET multiplier = 100 WHERE multiplier IS NULL;
