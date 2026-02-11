-- Migration 010: Fix experiments.split_percentage type
-- Description: Ensure split_percentage supports decimals

ALTER TABLE experiments
  ALTER COLUMN split_percentage TYPE DECIMAL(5,2)
  USING (
    CASE
      WHEN split_percentage > 1 THEN split_percentage / 100.0
      ELSE split_percentage
    END
  );
