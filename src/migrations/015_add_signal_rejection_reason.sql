-- Migration 015: Add rejection_reason to signals
-- Description: Persist rejection reason for audit and gating

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
