-- Migration 012: Add webhook testing metadata and sessions
-- Description: Track test sessions and mark test webhooks/signals

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

CREATE INDEX IF NOT EXISTS idx_signals_is_test ON signals(is_test);
CREATE INDEX IF NOT EXISTS idx_signals_test_session ON signals(test_session_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_is_test ON webhook_events(is_test);
CREATE INDEX IF NOT EXISTS idx_webhook_events_test_session ON webhook_events(test_session_id);
CREATE INDEX IF NOT EXISTS idx_test_sessions_status ON test_sessions(status);
