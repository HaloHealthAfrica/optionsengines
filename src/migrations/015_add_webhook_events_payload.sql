-- Migration 015: Store raw webhook payloads for audit
-- Description: Persist raw payloads (redacted) for invalid_payload diagnostics

ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS raw_payload JSONB;

CREATE INDEX IF NOT EXISTS idx_webhook_events_raw_payload ON webhook_events USING GIN (raw_payload);
