-- Backfill entry/exit prices for decision_snapshots that have invalidation_price
-- but no entry/exit levels (signals without explicit entry/target in raw_payload).
-- Falls back to raw_payload.price (snapshot price at signal time) for entry,
-- and derives a 2:1 R:R target from entry + invalidation.

-- Step 1: Fill entry from raw_payload.price when entry fields are still null
UPDATE decision_snapshots ds
SET
  entry_price_low = (s.raw_payload->>'price')::numeric,
  entry_price_high = (s.raw_payload->>'price')::numeric + 1
FROM signals s
WHERE s.signal_id = ds.signal_id::uuid
  AND ds.entry_price_low IS NULL
  AND (s.raw_payload->>'price')::numeric > 0;

-- Step 2: Derive exit targets (2:1 R:R) for snapshots that now have entry + invalidation but no exit
UPDATE decision_snapshots ds
SET
  exit_price_partial = CASE
    WHEN ds.strategy_json->'intent'->>'direction' = 'BEAR'
      THEN ROUND(ds.entry_price_low - ABS(ds.entry_price_low - ds.invalidation_price) * 2, 2)
    ELSE ROUND(ds.entry_price_low + ABS(ds.entry_price_low - ds.invalidation_price) * 2, 2)
  END,
  exit_price_full = CASE
    WHEN ds.strategy_json->'intent'->>'direction' = 'BEAR'
      THEN ROUND(ds.entry_price_low - ABS(ds.entry_price_low - ds.invalidation_price) * 2, 2)
    ELSE ROUND(ds.entry_price_low + ABS(ds.entry_price_low - ds.invalidation_price) * 2, 2)
  END
WHERE ds.exit_price_partial IS NULL
  AND ds.entry_price_low IS NOT NULL
  AND ds.invalidation_price IS NOT NULL
  AND ds.invalidation_price > 0
  AND ABS(ds.entry_price_low - ds.invalidation_price) > 0;
