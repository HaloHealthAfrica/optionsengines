-- Migration 013: Repair webhook testing metadata defaults
-- Description: Ensure test columns exist and defaults are applied

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS test_session_id TEXT,
  ADD COLUMN IF NOT EXISTS test_scenario TEXT;

ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS test_session_id TEXT,
  ADD COLUMN IF NOT EXISTS test_scenario TEXT;

CREATE TABLE IF NOT EXISTS test_sessions (
  test_session_id TEXT PRIMARY KEY,
  scenario TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'processing',
  total_webhooks INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

UPDATE signals SET is_test = FALSE WHERE is_test IS NULL;
UPDATE webhook_events SET is_test = FALSE WHERE is_test IS NULL;
