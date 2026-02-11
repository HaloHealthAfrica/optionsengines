-- Migration 016: Add signal queue fields for market-closed handling
-- Description: Enables queueing signals received outside market hours

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS queued_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS queue_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_signals_queued_until ON signals(queued_until);
