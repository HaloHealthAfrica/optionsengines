-- Persist the StrategyCandidate (trade intent + confidence) alongside the order plan.
-- This powers the dashboard "why this trade?" context without re-deriving from signal data.

ALTER TABLE decision_snapshots
  ADD COLUMN IF NOT EXISTS strategy_json JSONB;
