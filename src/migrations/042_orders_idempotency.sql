-- Migration 042: Orders idempotency (P0 Safety Gate)
-- Prevents duplicate orders per (signal_id, engine, order_type) for entry orders.
-- Run scripts/run-p0-verification.js first; migration fails if duplicates exist.
--
-- Partial index: only entry orders (signal_id NOT NULL, engine NOT NULL).
-- Exit orders (signal_id NULL) are excluded.

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_signal_engine_order_type_unique
  ON orders (signal_id, engine, order_type)
  WHERE signal_id IS NOT NULL AND engine IS NOT NULL;

COMMENT ON INDEX idx_orders_signal_engine_order_type_unique IS
  'P0 idempotency: one order per signal+engine+order_type for entry orders';
