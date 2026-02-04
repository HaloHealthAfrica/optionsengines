-- Migration 003: Add signal_hash to signals table
-- Description: Store deterministic signal hash for auditing/deduplication

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS signal_hash VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_signals_signal_hash ON signals(signal_hash);
