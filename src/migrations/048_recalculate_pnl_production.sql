-- Migration 048: Production PnL recalculation
-- Fixes values that may have been stored using incorrect formulas prior to the
-- forensic audit remediation (commit 1b2be62).
--
-- What was wrong:
--   1. Drawdown circuit breaker used entry_price*quantity (missing *multiplier) — runtime only, no stored fix needed
--   2. Shadow executor used inline LONG-only PnL — shadow_positions.unrealized_pnl may be wrong
--   3. Migration 040 backfilled exit_price using hardcoded /100 instead of /multiplier
--   4. Open positions may have stale unrealized_pnl from pre-fix refresh cycles
--
-- Since all production positions are LONG (paper executor hardcodes position_side='LONG'),
-- the direction bugs did not corrupt stored realized_pnl. This migration defensively
-- recalculates everything using the canonical formulas anyway.
-- Note: the migration runner wraps this in a transaction automatically.

-- ============================================================
-- 1. Recalculate realized_pnl for all closed positions
--    Formula: (exit_price - entry_price) * quantity * multiplier  [LONG]
--             (entry_price - exit_price) * quantity * multiplier  [SHORT]
-- ============================================================
UPDATE refactored_positions
SET realized_pnl = CASE
  WHEN COALESCE(position_side, 'LONG') = 'SHORT'
    THEN (entry_price - exit_price) * quantity * COALESCE(multiplier, 100)
  ELSE (exit_price - entry_price) * quantity * COALESCE(multiplier, 100)
END
WHERE status = 'closed'
  AND exit_price IS NOT NULL
  AND entry_price IS NOT NULL
  AND quantity > 0;

-- ============================================================
-- 2. Re-derive exit_price for closed positions that have
--    realized_pnl but no exit_price (040 backfill candidates)
--    Using the corrected direction-aware formula.
-- ============================================================
UPDATE refactored_positions
SET exit_price = CASE
  WHEN COALESCE(position_side, 'LONG') = 'SHORT'
    THEN entry_price - (realized_pnl::numeric / (quantity * COALESCE(multiplier, 100)))
  ELSE entry_price + (realized_pnl::numeric / (quantity * COALESCE(multiplier, 100)))
END
WHERE status = 'closed'
  AND exit_price IS NULL
  AND realized_pnl IS NOT NULL
  AND quantity > 0
  AND entry_price > 0;

-- ============================================================
-- 3. Recalculate unrealized_pnl for open positions
--    using current_price stored from the last refresh.
--    Formula: same direction-aware logic.
-- ============================================================
UPDATE refactored_positions
SET unrealized_pnl = CASE
  WHEN COALESCE(position_side, 'LONG') = 'SHORT'
    THEN (entry_price - current_price) * quantity * COALESCE(multiplier, 100)
  ELSE (current_price - entry_price) * quantity * COALESCE(multiplier, 100)
END,
position_pnl_percent = CASE
  WHEN entry_price > 0 AND quantity > 0
    THEN (
      CASE
        WHEN COALESCE(position_side, 'LONG') = 'SHORT'
          THEN (entry_price - current_price) * quantity * COALESCE(multiplier, 100)
        ELSE (current_price - entry_price) * quantity * COALESCE(multiplier, 100)
      END
    ) / (entry_price * quantity * COALESCE(multiplier, 100)) * 100
  ELSE 0
END
WHERE status IN ('open', 'closing')
  AND current_price IS NOT NULL
  AND entry_price > 0
  AND quantity > 0;

-- ============================================================
-- 4. Recalculate shadow positions unrealized_pnl
--    Shadow positions are always LONG (no position_side column).
-- ============================================================
UPDATE shadow_positions
SET unrealized_pnl = (current_price - entry_price) * quantity * 100
WHERE status = 'open'
  AND current_price IS NOT NULL
  AND entry_price > 0
  AND quantity > 0;

-- Recalculate closed shadow positions realized_pnl
-- where we have entry and current price at close time
UPDATE shadow_positions
SET realized_pnl = (current_price - entry_price) * quantity * 100
WHERE status = 'closed'
  AND current_price IS NOT NULL
  AND entry_price > 0
  AND quantity > 0;
