-- Migration 009: Ensure experiments.policy_version exists
-- Description: Add policy_version column to experiments if missing

ALTER TABLE experiments
  ADD COLUMN IF NOT EXISTS policy_version VARCHAR(20) NOT NULL DEFAULT 'v1.0';
