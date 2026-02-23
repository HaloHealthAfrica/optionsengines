-- Options Engine: System State (Epic 15)
-- Global kill switch with immutable transition log

CREATE TABLE IF NOT EXISTS oe_system_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (state IN ('ACTIVE', 'PAUSED', 'EMERGENCY_STOP')),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT 'SYSTEM'
);

CREATE TABLE IF NOT EXISTS oe_system_state_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_state TEXT NOT NULL
    CHECK (from_state IN ('ACTIVE', 'PAUSED', 'EMERGENCY_STOP')),
  to_state TEXT NOT NULL
    CHECK (to_state IN ('ACTIVE', 'PAUSED', 'EMERGENCY_STOP')),
  trigger TEXT NOT NULL,
  triggered_by TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oe_system_state_log_timestamp
  ON oe_system_state_log(timestamp DESC);

-- Seed initial ACTIVE state
INSERT INTO oe_system_state (state, updated_by)
SELECT 'ACTIVE', 'MIGRATION'
WHERE NOT EXISTS (SELECT 1 FROM oe_system_state LIMIT 1);
