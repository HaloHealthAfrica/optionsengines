-- Migration 017: Add processing retry fields for signals
-- Description: Track attempts and schedule retries for failed processing

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS processing_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_signals_next_retry_at ON signals(next_retry_at);
