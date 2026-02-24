-- PR1: Add deterministic decision_id for idempotency.
-- Hash of (signalId + strategy + horizon + setupType).
-- Unique constraint prevents duplicate snapshots for the same decision.

ALTER TABLE decision_snapshots
  ADD COLUMN IF NOT EXISTS decision_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_snapshots_decision_id
  ON decision_snapshots (decision_id)
  WHERE decision_id IS NOT NULL;
