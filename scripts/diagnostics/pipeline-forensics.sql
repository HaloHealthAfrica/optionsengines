-- ============================================================================
-- PIPELINE FORENSICS: End-to-End Diagnostic Analysis
-- Purpose: Identify every processing gap and explain why GEX data didn't work
-- Date: 2026-02-09
-- ============================================================================

-- Set timezone for consistent results
SET timezone = 'America/New_York';

-- ============================================================================
-- PART 1: PIPELINE HEALTH - STAGE-BY-STAGE GAP ANALYSIS
-- ============================================================================

\echo '============================================================================'
\echo 'STAGE 1: WEBHOOK INGESTION & VALIDATION'
\echo '============================================================================'

SELECT 
  status,
  COUNT(*) AS count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS percentage,
  ARRAY_AGG(DISTINCT error_message) FILTER (WHERE error_message IS NOT NULL) AS error_messages
FROM webhook_events
WHERE created_at >= CURRENT_DATE
  AND COALESCE(is_test, false) = false
GROUP BY status
ORDER BY count DESC;

\echo ''
\echo 'Webhook Processing Rate:'
SELECT 
  COUNT(*) FILTER (WHERE status IN ('processed', 'accepted')) AS processed,
  COUNT(*) AS total,
  ROUND(COUNT(*) FILTER (WHERE status IN ('processed', 'accepted')) * 100.0 / NULLIF(COUNT(*), 0), 2) AS success_rate_pct
FROM webhook_events
WHERE created_at >= CURRENT_DATE
  AND COALESCE(is_test, false) = false;

\echo ''
\echo '============================================================================'
\echo 'STAGE 2: DEDUPLICATION ANALYSIS'
\echo '============================================================================'

SELECT 
  we.symbol,
  we.timeframe,
  COUNT(*) AS duplicate_count,
  MIN(we.created_at) AS first_seen,
  MAX(we.created_at) AS last_seen,
  EXTRACT(EPOCH FROM (MAX(we.created_at) - MIN(we.created_at))) AS window_span_seconds
FROM webhook_events we
WHERE we.created_at >= CURRENT_DATE
  AND we.status = 'duplicate'
  AND COALESCE(we.is_test, false) = false
GROUP BY we.symbol, we.timeframe
ORDER BY duplicate_count DESC
LIMIT 20;

\echo ''
\echo 'Deduplication Summary:'
SELECT 
  COUNT(*) FILTER (WHERE status = 'duplicate') AS duplicates,
  COUNT(*) FILTER (WHERE status != 'duplicate') AS unique_signals,
  ROUND(COUNT(*) FILTER (WHERE status = 'duplicate') * 100.0 / NULLIF(COUNT(*), 0), 2) AS duplicate_rate_pct
FROM webhook_events
WHERE created_at >= CURRENT_DATE
  AND COALESCE(is_test, false) = false;

\echo ''
\echo '============================================================================'
\echo 'STAGE 3: SIGNAL PERSISTENCE - ORPHANED WEBHOOKS'
\echo '============================================================================'

SELECT 
  we.event_id,
  we.request_id,
  we.symbol,
  we.direction,
  we.timeframe,
  we.status,
  we.created_at,
  we.processing_time_ms
FROM webhook_events we
WHERE we.created_at >= CURRENT_DATE
  AND we.status = 'processed'
  AND we.signal_id IS NULL
  AND COALESCE(we.is_test, false) = false
ORDER BY we.created_at
LIMIT 50;

\echo ''
\echo 'Signal Persistence Rate:'
SELECT 
  COUNT(*) FILTER (WHERE signal_id IS NOT NULL) AS signals_created,
  COUNT(*) FILTER (WHERE status = 'processed') AS processed_webhooks,
  ROUND(COUNT(*) FILTER (WHERE signal_id IS NOT NULL) * 100.0 / 
        NULLIF(COUNT(*) FILTER (WHERE status = 'processed'), 0), 2) AS persistence_rate_pct
FROM webhook_events
WHERE created_at >= CURRENT_DATE
  AND COALESCE(is_test, false) = false;


\echo ''
\echo '============================================================================'
\echo 'STAGE 4: ENRICHMENT - GEX & MARKET CONTEXT'
\echo '============================================================================'

SELECT 
  s.signal_id,
  s.symbol,
  s.direction,
  s.timeframe,
  s.status,
  s.created_at AS signal_created_at,
  rs.enriched_data IS NOT NULL AS has_enrichment,
  rs.risk_check_result IS NOT NULL AS has_risk_check,
  rs.rejection_reason AS enrichment_rejection,
  mc.context_id IS NOT NULL AS has_market_context,
  mc.current_price,
  mc.volume,
  mc.indicators IS NOT NULL AS has_indicators,
  gs.snapshot_id IS NOT NULL AS has_gex_snapshot,
  gs.net_gex,
  gs.total_call_gex,
  gs.total_put_gex,
  gs.zero_gamma_level,
  gs.source AS gex_source,
  rs.processed_at AS enrichment_time,
  EXTRACT(EPOCH FROM (rs.processed_at - s.created_at)) AS enrichment_delay_seconds
FROM signals s
LEFT JOIN LATERAL (
  SELECT enriched_data, risk_check_result, rejection_reason, processed_at
  FROM refactored_signals rs
  WHERE rs.signal_id = s.signal_id
  ORDER BY processed_at DESC
  LIMIT 1
) rs ON true
LEFT JOIN LATERAL (
  SELECT context_id, current_price, volume, indicators
  FROM market_contexts mc
  WHERE mc.signal_id = s.signal_id
  ORDER BY created_at DESC
  LIMIT 1
) mc ON true
LEFT JOIN LATERAL (
  SELECT snapshot_id, net_gex, total_call_gex, total_put_gex, zero_gamma_level, source
  FROM gex_snapshots gs
  WHERE gs.symbol = s.symbol
    AND gs.created_at >= s.created_at - INTERVAL '5 minutes'
    AND gs.created_at <= s.created_at + INTERVAL '10 minutes'
  ORDER BY gs.created_at DESC
  LIMIT 1
) gs ON true
WHERE s.created_at >= CURRENT_DATE
  AND COALESCE(s.is_test, false) = false
ORDER BY s.created_at;

\echo ''
\echo 'Enrichment Coverage Summary:'
SELECT 
  COUNT(*) AS total_signals,
  COUNT(*) FILTER (WHERE has_enrichment) AS enriched,
  COUNT(*) FILTER (WHERE has_gex_snapshot) AS with_gex,
  COUNT(*) FILTER (WHERE has_market_context) AS with_market_data,
  COUNT(*) FILTER (WHERE has_indicators) AS with_indicators,
  ROUND(COUNT(*) FILTER (WHERE has_enrichment) * 100.0 / NULLIF(COUNT(*), 0), 2) AS enrichment_rate_pct,
  ROUND(COUNT(*) FILTER (WHERE has_gex_snapshot) * 100.0 / NULLIF(COUNT(*), 0), 2) AS gex_coverage_pct,
  AVG(enrichment_delay_seconds) FILTER (WHERE enrichment_delay_seconds IS NOT NULL) AS avg_enrichment_delay_sec
FROM (
  SELECT 
    s.signal_id,
    rs.enriched_data IS NOT NULL AS has_enrichment,
    gs.snapshot_id IS NOT NULL AS has_gex_snapshot,
    mc.context_id IS NOT NULL AS has_market_context,
    mc.indicators IS NOT NULL AS has_indicators,
    EXTRACT(EPOCH FROM (rs.processed_at - s.created_at)) AS enrichment_delay_seconds
  FROM signals s
  LEFT JOIN LATERAL (
    SELECT enriched_data, processed_at
    FROM refactored_signals rs
    WHERE rs.signal_id = s.signal_id
    ORDER BY processed_at DESC
    LIMIT 1
  ) rs ON true
  LEFT JOIN LATERAL (
    SELECT context_id, indicators
    FROM market_contexts mc
    WHERE mc.signal_id = s.signal_id
    ORDER BY created_at DESC
    LIMIT 1
  ) mc ON true
  LEFT JOIN LATERAL (
    SELECT snapshot_id
    FROM gex_snapshots gs
    WHERE gs.symbol = s.symbol
      AND gs.created_at >= s.created_at - INTERVAL '5 minutes'
      AND gs.created_at <= s.created_at + INTERVAL '10 minutes'
    ORDER BY gs.created_at DESC
    LIMIT 1
  ) gs ON true
  WHERE s.created_at >= CURRENT_DATE
    AND COALESCE(s.is_test, false) = false
) enrichment_stats;


\echo ''
\echo '============================================================================'
\echo 'STAGE 5: RISK CHECKS'
\echo '============================================================================'

SELECT 
  s.signal_id,
  s.symbol,
  s.direction,
  s.status AS signal_status,
  s.rejection_reason,
  rs.risk_check_result,
  rs.rejection_reason AS enrichment_rejection,
  CASE
    WHEN rs.risk_check_result->>'marketOpen' = 'false' THEN 'MARKET_CLOSED'
    WHEN (rs.risk_check_result->>'openPositions')::int >= (rs.risk_check_result->>'maxOpenPositions')::int THEN 'MAX_POSITIONS'
    WHEN (rs.risk_check_result->>'openSymbolPositions')::int >= (rs.risk_check_result->>'maxPositionsPerSymbol')::int THEN 'MAX_SYMBOL_POSITIONS'
    ELSE 'PASSED'
  END AS risk_diagnosis
FROM signals s
LEFT JOIN LATERAL (
  SELECT risk_check_result, rejection_reason
  FROM refactored_signals rs
  WHERE rs.signal_id = s.signal_id
  ORDER BY processed_at DESC
  LIMIT 1
) rs ON true
WHERE s.created_at >= CURRENT_DATE
  AND COALESCE(s.is_test, false) = false
  AND (s.rejection_reason IS NOT NULL OR rs.rejection_reason IS NOT NULL)
ORDER BY s.created_at;

\echo ''
\echo 'Risk Check Summary:'
SELECT 
  CASE
    WHEN s.rejection_reason IS NOT NULL THEN s.rejection_reason
    WHEN rs.rejection_reason IS NOT NULL THEN rs.rejection_reason
    WHEN rs.risk_check_result->>'marketOpen' = 'false' THEN 'MARKET_CLOSED'
    WHEN (rs.risk_check_result->>'openPositions')::int >= (rs.risk_check_result->>'maxOpenPositions')::int THEN 'MAX_POSITIONS'
    WHEN (rs.risk_check_result->>'openSymbolPositions')::int >= (rs.risk_check_result->>'maxPositionsPerSymbol')::int THEN 'MAX_SYMBOL_POSITIONS'
    ELSE 'PASSED'
  END AS rejection_reason,
  COUNT(*) AS count
FROM signals s
LEFT JOIN LATERAL (
  SELECT risk_check_result, rejection_reason
  FROM refactored_signals rs
  WHERE rs.signal_id = s.signal_id
  ORDER BY processed_at DESC
  LIMIT 1
) rs ON true
WHERE s.created_at >= CURRENT_DATE
  AND COALESCE(s.is_test, false) = false
GROUP BY rejection_reason
ORDER BY count DESC;

\echo ''
\echo '============================================================================'
\echo 'STAGE 6: EXPERIMENT ASSIGNMENT & EXECUTION POLICY'
\echo '============================================================================'

SELECT 
  e.variant,
  ep.execution_mode,
  ep.executed_engine,
  ep.shadow_engine,
  COUNT(DISTINCT s.signal_id) AS signal_count,
  COUNT(DISTINCT o.order_id) FILTER (WHERE o.order_id IS NOT NULL) AS orders_created,
  COUNT(DISTINCT st.shadow_trade_id) FILTER (WHERE st.shadow_trade_id IS NOT NULL) AS shadow_trades_created
FROM experiments e
JOIN signals s ON s.experiment_id = e.experiment_id
LEFT JOIN execution_policies ep ON ep.experiment_id = e.experiment_id
LEFT JOIN orders o ON o.signal_id = s.signal_id
LEFT JOIN shadow_trades st ON st.experiment_id = e.experiment_id
WHERE e.created_at >= CURRENT_DATE
GROUP BY e.variant, ep.execution_mode, ep.executed_engine, ep.shadow_engine
ORDER BY e.variant;

\echo ''
\echo 'Experiment Assignment Rate:'
SELECT 
  COUNT(*) AS total_signals,
  COUNT(*) FILTER (WHERE experiment_id IS NOT NULL) AS assigned_to_experiment,
  ROUND(COUNT(*) FILTER (WHERE experiment_id IS NOT NULL) * 100.0 / NULLIF(COUNT(*), 0), 2) AS assignment_rate_pct
FROM signals
WHERE created_at >= CURRENT_DATE
  AND COALESCE(is_test, false) = false;


\echo ''
\echo '============================================================================'
\echo 'STAGE 7: RECOMMENDATIONS'
\echo '============================================================================'

SELECT 
  s.signal_id,
  s.symbol,
  s.direction,
  e.variant,
  dr.engine,
  dr.strike,
  dr.expiration,
  dr.quantity,
  dr.entry_price,
  dr.is_shadow,
  dr.rationale->>'rejection_reason' AS rec_rejection,
  dr.rationale->>'confidence' AS confidence,
  dr.rationale->>'enriched_data' IS NOT NULL AS rec_has_enrichment,
  dr.created_at
FROM decision_recommendations dr
JOIN signals s ON s.signal_id = dr.signal_id
LEFT JOIN experiments e ON e.experiment_id = s.experiment_id
WHERE dr.created_at >= CURRENT_DATE
ORDER BY dr.created_at;

\echo ''
\echo 'Recommendation Summary:'
SELECT 
  COUNT(*) AS total_signals,
  COUNT(DISTINCT dr.recommendation_id) AS recommendations_generated,
  COUNT(*) FILTER (WHERE dr.strike IS NOT NULL) AS with_strike,
  COUNT(*) FILTER (WHERE dr.expiration IS NOT NULL) AS with_expiration,
  COUNT(*) FILTER (WHERE dr.quantity IS NOT NULL) AS with_quantity,
  ROUND(COUNT(DISTINCT dr.recommendation_id) * 100.0 / NULLIF(COUNT(*), 0), 2) AS recommendation_rate_pct
FROM signals s
LEFT JOIN decision_recommendations dr ON dr.signal_id = s.signal_id
WHERE s.created_at >= CURRENT_DATE
  AND COALESCE(s.is_test, false) = false;

\echo ''
\echo '============================================================================'
\echo 'STAGE 8: ORDERS & FILLS'
\echo '============================================================================'

SELECT 
  o.order_id,
  o.signal_id,
  s.symbol,
  s.direction,
  o.order_type,
  o.status AS order_status,
  o.engine,
  o.option_symbol,
  o.created_at AS order_created_at,
  t.fill_price,
  t.fill_quantity,
  t.fill_timestamp,
  EXTRACT(EPOCH FROM (t.fill_timestamp - s.created_at)) AS signal_to_fill_seconds
FROM orders o
JOIN signals s ON s.signal_id = o.signal_id
LEFT JOIN trades t ON t.order_id = o.order_id
WHERE o.created_at >= CURRENT_DATE
ORDER BY o.created_at;

\echo ''
\echo 'Order & Fill Summary:'
SELECT 
  COUNT(DISTINCT s.signal_id) AS total_signals,
  COUNT(DISTINCT o.order_id) AS orders_created,
  COUNT(DISTINCT t.trade_id) AS orders_filled,
  ROUND(COUNT(DISTINCT o.order_id) * 100.0 / NULLIF(COUNT(DISTINCT s.signal_id), 0), 2) AS order_creation_rate_pct,
  ROUND(COUNT(DISTINCT t.trade_id) * 100.0 / NULLIF(COUNT(DISTINCT o.order_id), 0), 2) AS fill_rate_pct,
  AVG(EXTRACT(EPOCH FROM (t.fill_timestamp - s.created_at))) FILTER (WHERE t.fill_timestamp IS NOT NULL) AS avg_signal_to_fill_sec
FROM signals s
LEFT JOIN orders o ON o.signal_id = s.signal_id
LEFT JOIN trades t ON t.order_id = o.order_id
WHERE s.created_at >= CURRENT_DATE
  AND COALESCE(s.is_test, false) = false;
