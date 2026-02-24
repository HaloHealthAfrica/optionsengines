-- UDC Decision Snapshots — persisted audit trail for Unified Decision Core
-- Every UDC run produces a snapshot regardless of trading mode.

CREATE TABLE IF NOT EXISTS decision_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id       TEXT NOT NULL,
  status          TEXT NOT NULL,
  reason          TEXT,
  order_plan_json JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decision_snapshots_signal_id
  ON decision_snapshots (signal_id);

CREATE INDEX IF NOT EXISTS idx_decision_snapshots_status
  ON decision_snapshots (status);

CREATE INDEX IF NOT EXISTS idx_decision_snapshots_created_at
  ON decision_snapshots (created_at DESC);
