-- Migration 036: Add expires_at to strat_alerts for scanner-generated alerts
ALTER TABLE strat_alerts
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_strat_alerts_expires ON strat_alerts(expires_at) WHERE expires_at IS NOT NULL;
