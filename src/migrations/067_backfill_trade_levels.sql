-- Backfill trade-level columns for existing decision_snapshots
-- using the invalidation from strategy_json and entry/target/stop
-- from the linked signal's raw_payload.

UPDATE decision_snapshots ds
SET
  invalidation_price = COALESCE(
    (ds.strategy_json->'intent'->>'invalidation')::numeric,
    ds.invalidation_price
  )
WHERE ds.strategy_json IS NOT NULL
  AND ds.invalidation_price IS NULL
  AND (ds.strategy_json->'intent'->>'invalidation')::numeric > 0;

UPDATE decision_snapshots ds
SET
  entry_price_low = COALESCE(
    (s.raw_payload->>'entry')::numeric,
    (s.raw_payload->>'entry_price')::numeric
  ),
  entry_price_high = COALESCE(
    (s.raw_payload->>'entry')::numeric,
    (s.raw_payload->>'entry_price')::numeric
  ) + 1,
  exit_price_partial = COALESCE(
    (s.raw_payload->>'target')::numeric,
    (s.raw_payload->>'target_price')::numeric
  ),
  exit_price_full = COALESCE(
    (s.raw_payload->>'target')::numeric,
    (s.raw_payload->>'target_price')::numeric
  ),
  invalidation_price = COALESCE(
    ds.invalidation_price,
    (s.raw_payload->>'stop')::numeric,
    (s.raw_payload->>'stop_loss')::numeric,
    (s.raw_payload->>'stop_price')::numeric
  )
FROM signals s
WHERE s.signal_id = ds.signal_id::uuid
  AND ds.entry_price_low IS NULL
  AND (
    (s.raw_payload->>'entry') IS NOT NULL
    OR (s.raw_payload->>'entry_price') IS NOT NULL
  );
