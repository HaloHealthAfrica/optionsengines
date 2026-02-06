-- Migration 003: Create webhook events table for monitoring
-- Description: Track webhook processing outcomes for diagnostics

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL,
  signal_id UUID REFERENCES signals(signal_id) ON DELETE SET NULL,
  experiment_id UUID REFERENCES experiments(experiment_id) ON DELETE SET NULL,
  variant VARCHAR(1) CHECK (variant IN ('A', 'B')),
  status VARCHAR(30) NOT NULL CHECK (
    status IN ('accepted', 'duplicate', 'invalid_signature', 'invalid_payload', 'error')
  ),
  error_message TEXT,
  symbol VARCHAR(20),
  direction VARCHAR(10),
  timeframe VARCHAR(10),
  processing_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON webhook_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_variant ON webhook_events(variant);
CREATE INDEX IF NOT EXISTS idx_webhook_events_signal_id ON webhook_events(signal_id);

COMMENT ON TABLE webhook_events IS 'Webhook processing outcomes for monitoring and troubleshooting';
