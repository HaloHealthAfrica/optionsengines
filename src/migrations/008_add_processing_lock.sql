-- Migration 008: Add processing_lock to signals for concurrency control
-- Description: Prevent duplicate processing by multiple workers

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS processing_lock BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_signals_processing_lock
  ON signals(processing_lock)
  WHERE processing_lock = FALSE;
