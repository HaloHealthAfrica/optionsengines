-- ============================================================================
-- TRADE QUALITY FORENSICS
-- Purpose: Analyze why trades "made no sense" given GEX data
-- ============================================================================

SET timezone = 'America/New_York';

\echo '============================================================================'
\echo 'PART 3: TRADE QUALITY FORENSICS'
\echo '============================================================================'

\echo ''
\echo 'Query 1: Full Trade Audit Trail'
\echo '============================================================================'

SELECT 
  we.event_id,
  we.created_at AS webhook_time,
  s.signal_id,
  s.symbol,
  s.direction,
  s.timeframe,
  e.variant,
  -- Enrichment quality
  gs.net_gex,
  gs.zero_gamma_level,
  mc.current_price AS entry_market_price,
  -- What we recommended
  dr.engine AS rec_engine,
  dr.strike AS rec_strike,
  dr.expiration AS rec_expiration,
  dr.quantity AS rec_quantity,
  dr.rationale->>'confidence' AS rec_confidence,
  -- What we actually did
  o.order_type,
  o.option_symbol,
  t.fill_price,
  t.fill_quantity,
  t.fill_timestamp,
  -- Outcome
  p.unrealized_pnl,
  p.realized_pnl,
  p.status AS position_status,
  -- Timing
  EXTRACT(EPOCH FROM (t.fill_timestamp - we.created_at)) AS webhook_to_fill_seconds
FROM webhook_events we
JOIN signals s ON s.signal_id = we.signal_id
LEFT JOIN experiments e ON e.experiment_id = COALESCE(we.experiment_id, s.experiment_id)
LEFT JOIN LATERAL (
  SELECT net_gex, zero_gamma_level
  FROM gex_snapshots gs
  WHERE gs.symbol = s.symbol
    AND gs.created_at BETWEEN s.created_at - INTERVAL '5 minutes' AND s.created_at + INTERVAL '10 minutes'
  ORDER BY gs.created_at DESC
  LIMIT 1
) gs ON true
LEFT JOIN LATERAL (
  SELECT current_price
  FROM market_contexts mc
  WHERE mc.signal_id = s.signal_id
  ORDER BY created_at DESC
  LIMIT 1
) mc ON true
LEFT JOIN decision_recommendations dr ON dr.signal_id = s.signal_id
LEFT JOIN orders o ON o.signal_id = s.signal_id
LEFT JOIN trades t ON t.order_id = o.order_id
LEFT JOIN positions p ON p.signal_id = s.signal_id
WHERE we.created_at >= CURRENT_DATE
  AND COALESCE(we.is_test, false) = false
  AND we.status = 'processed'
ORDER BY we.created_at;

\echo ''
\echo 'Query 2: Trades That Violated GEX Logic'
\echo '============================================================================'

SELECT 
  s.signal_id,
  s.symbol,
  s.direction,
  o.option_symbol,
  t.fill_price,
  gs.net_gex,
  gs.zero_gamma_level,
  mc.current_price,
  -- Flag issues
  ARRAY_REMOVE(ARRAY[
    CASE WHEN gs.net_gex IS NULL THEN 'NO_GEX_DATA' END,
    CASE WHEN gs.net_gex < 0 AND dr.rationale->>'sizeMultiplier' IS NULL THEN 'SHORT_GAMMA_NO_SIZE_REDUCTION' END,
    CASE WHEN gs.net_gex < 0 AND (dr.quantity)::int > 1 THEN 'SHORT_GAMMA_OVERSIZED' END,
    CASE WHEN mc.current_price < gs.zero_gamma_level AND s.direction = 'long' THEN 'LONG_BELOW_ZERO_GAMMA' END,
    CASE WHEN mc.current_price > gs.zero_gamma_level AND s.direction = 'short' THEN 'SHORT_ABOVE_ZERO_GAMMA' END,
    CASE WHEN (rs.enriched_data->>'putCallRatio')::float > 1.3 AND s.direction = 'long' THEN 'LONG_AGAINST_BEARISH_FLOW' END,
    CASE WHEN (rs.enriched_data->>'putCallRatio')::float < 0.7 AND s.direction = 'short' THEN 'SHORT_AGAINST_BULLISH_FLOW' END,
    CASE WHEN dr.strike IS NULL THEN 'NO_STRIKE_SELECTED' END,
    CASE WHEN dr.expiration IS NULL THEN 'NO_EXPIRATION_SELECTED' END,
    CASE WHEN t.fill_price IS NULL THEN 'NEVER_FILLED' END
  ], NULL) AS violations
FROM signals s
JOIN orders o ON o.signal_id = s.signal_id
LEFT JOIN trades t ON t.order_id = o.order_id
LEFT JOIN decision_recommendations dr ON dr.signal_id = s.signal_id
LEFT JOIN LATERAL (
  SELECT net_gex, zero_gamma_level
  FROM gex_snapshots gs
  WHERE gs.symbol = s.symbol
    AND gs.created_at BETWEEN s.created_at - INTERVAL '5 minutes' AND s.created_at + INTERVAL '10 minutes'
  ORDER BY gs.created_at DESC
  LIMIT 1
) gs ON true
LEFT JOIN LATERAL (
  SELECT current_price
  FROM market_contexts mc
  WHERE mc.signal_id = s.signal_id
  ORDER BY created_at DESC
  LIMIT 1
) mc ON true
LEFT JOIN LATERAL (
  SELECT enriched_data
  FROM refactored_signals rs
  WHERE rs.signal_id = s.signal_id
  ORDER BY processed_at DESC
  LIMIT 1
) rs ON true
WHERE s.created_at >= CURRENT_DATE
  AND COALESCE(s.is_test, false) = false
ORDER BY s.created_at;

\echo ''
\echo 'Violation Summary:'
SELECT 
  unnest(violations) AS violation_type,
  COUNT(*) AS occurrence_count
FROM (
  SELECT 
    ARRAY_REMOVE(ARRAY[
      CASE WHEN gs.net_gex IS NULL THEN 'NO_GEX_DATA' END,
      CASE WHEN gs.net_gex < 0 AND dr.rationale->>'sizeMultiplier' IS NULL THEN 'SHORT_GAMMA_NO_SIZE_REDUCTION' END,
      CASE WHEN gs.net_gex < 0 AND (dr.quantity)::int > 1 THEN 'SHORT_GAMMA_OVERSIZED' END,
      CASE WHEN mc.current_price < gs.zero_gamma_level AND s.direction = 'long' THEN 'LONG_BELOW_ZERO_GAMMA' END,
      CASE WHEN mc.current_price > gs.zero_gamma_level AND s.direction = 'short' THEN 'SHORT_ABOVE_ZERO_GAMMA' END,
      CASE WHEN (rs.enriched_data->>'putCallRatio')::float > 1.3 AND s.direction = 'long' THEN 'LONG_AGAINST_BEARISH_FLOW' END,
      CASE WHEN (rs.enriched_data->>'putCallRatio')::float < 0.7 AND s.direction = 'short' THEN 'SHORT_AGAINST_BULLISH_FLOW' END,
      CASE WHEN dr.strike IS NULL THEN 'NO_STRIKE_SELECTED' END,
      CASE WHEN dr.expiration IS NULL THEN 'NO_EXPIRATION_SELECTED' END,
      CASE WHEN t.fill_price IS NULL THEN 'NEVER_FILLED' END
    ], NULL) AS violations
  FROM signals s
  JOIN orders o ON o.signal_id = s.signal_id
  LEFT JOIN trades t ON t.order_id = o.order_id
  LEFT JOIN decision_recommendations dr ON dr.signal_id = s.signal_id
  LEFT JOIN LATERAL (
    SELECT net_gex, zero_gamma_level
    FROM gex_snapshots gs
    WHERE gs.symbol = s.symbol
      AND gs.created_at BETWEEN s.created_at - INTERVAL '5 minutes' AND s.created_at + INTERVAL '10 minutes'
    ORDER BY gs.created_at DESC
    LIMIT 1
  ) gs ON true
  LEFT JOIN LATERAL (
    SELECT current_price
    FROM market_contexts mc
    WHERE mc.signal_id = s.signal_id
    ORDER BY created_at DESC
    LIMIT 1
  ) mc ON true
  LEFT JOIN LATERAL (
    SELECT enriched_data
    FROM refactored_signals rs
    WHERE rs.signal_id = s.signal_id
    ORDER BY processed_at DESC
    LIMIT 1
  ) rs ON true
  WHERE s.created_at >= CURRENT_DATE
    AND COALESCE(s.is_test, false) = false
) violation_analysis
WHERE array_length(violations, 1) > 0
GROUP BY violation_type
ORDER BY occurrence_count DESC;
