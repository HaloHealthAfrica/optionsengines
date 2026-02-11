-- ============================================================================
-- PIPELINE DIAGNOSTIC SUMMARY REPORT
-- Purpose: Generate executive summary of all pipeline stages
-- ============================================================================

SET timezone = 'America/New_York';

\echo '============================================================================'
\echo 'EXECUTIVE SUMMARY: PIPELINE HEALTH BY STAGE'
\echo '============================================================================'
\echo ''

-- Create temporary table for stage summary
CREATE TEMP TABLE IF NOT EXISTS stage_summary (
  stage TEXT,
  total INT,
  passed INT,
  failed INT,
  pending INT,
  top_failure_reason TEXT
);

-- Stage 1: Webhook Validation
INSERT INTO stage_summary
SELECT 
  'Webhook Validation' AS stage,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE status IN ('processed', 'accepted')) AS passed,
  COUNT(*) FILTER (WHERE status IN ('error', 'invalid_signature', 'invalid_payload')) AS failed,
  COUNT(*) FILTER (WHERE status = 'pending') AS pending,
  (SELECT error_message FROM webhook_events 
   WHERE created_at >= CURRENT_DATE 
     AND COALESCE(is_test, false) = false
     AND error_message IS NOT NULL
   GROUP BY error_message 
   ORDER BY COUNT(*) DESC 
   LIMIT 1) AS top_failure_reason
FROM webhook_events
WHERE created_at >= CURRENT_DATE
  AND COALESCE(is_test, false) = false;

-- Stage 2: Deduplication
INSERT INTO stage_summary
SELECT 
  'Deduplication' AS stage,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE status != 'duplicate') AS passed,
  COUNT(*) FILTER (WHERE status = 'duplicate') AS failed,
  0 AS pending,
  'Duplicate signal within 60s window' AS top_failure_reason
FROM webhook_events
WHERE created_at >= CURRENT_DATE
  AND COALESCE(is_test, false) = false;

-- Stage 3: Signal Persistence
INSERT INTO stage_summary
SELECT 
  'Signal Persistence' AS stage,
  COUNT(*) FILTER (WHERE status = 'processed') AS total,
  COUNT(*) FILTER (WHERE signal_id IS NOT NULL) AS passed,
  COUNT(*) FILTER (WHERE status = 'processed' AND signal_id IS NULL) AS failed,
  0 AS pending,
  'Signal insert failed silently' AS top_failure_reason
FROM webhook_events
WHERE created_at >= CURRENT_DATE
  AND COALESCE(is_test, false) = false;

-- Stage 4: Enrichment
INSERT INTO stage_summary
SELECT 
  'Enrichment' AS stage,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE has_enrichment) AS passed,
  COUNT(*) FILTER (WHERE NOT has_enrichment) AS failed,
  0 AS pending,
  CASE 
    WHEN COUNT(*) FILTER (WHERE NOT has_gex) > COUNT(*) FILTER (WHERE NOT has_market_data) 
    THEN 'GEX data not fetched'
    ELSE 'Market data not fetched'
  END AS top_failure_reason
FROM (
  SELECT 
    s.signal_id,
    rs.enriched_data IS NOT NULL AS has_enrichment,
    gs.snapshot_id IS NOT NULL AS has_gex,
    mc.context_id IS NOT NULL AS has_market_data
  FROM signals s
  LEFT JOIN LATERAL (
    SELECT enriched_data
    FROM refactored_signals rs
    WHERE rs.signal_id = s.signal_id
    ORDER BY processed_at DESC
    LIMIT 1
  ) rs ON true
  LEFT JOIN LATERAL (
    SELECT snapshot_id
    FROM gex_snapshots gs
    WHERE gs.symbol = s.symbol
      AND gs.created_at BETWEEN s.created_at - INTERVAL '5 minutes' AND s.created_at + INTERVAL '10 minutes'
    ORDER BY gs.created_at DESC
    LIMIT 1
  ) gs ON true
  LEFT JOIN LATERAL (
    SELECT context_id
    FROM market_contexts mc
    WHERE mc.signal_id = s.signal_id
    ORDER BY created_at DESC
    LIMIT 1
  ) mc ON true
  WHERE s.created_at >= CURRENT_DATE
    AND COALESCE(s.is_test, false) = false
) enrichment_data;

-- Stage 5: Risk Checks
INSERT INTO stage_summary
SELECT 
  'Risk Checks' AS stage,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE s.status != 'rejected') AS passed,
  COUNT(*) FILTER (WHERE s.status = 'rejected') AS failed,
  0 AS pending,
  (SELECT rejection_reason FROM signals 
   WHERE created_at >= CURRENT_DATE 
     AND COALESCE(is_test, false) = false
     AND rejection_reason IS NOT NULL
   GROUP BY rejection_reason 
   ORDER BY COUNT(*) DESC 
   LIMIT 1) AS top_failure_reason
FROM signals s
WHERE s.created_at >= CURRENT_DATE
  AND COALESCE(s.is_test, false) = false;

-- Stage 6: Experiment Assignment
INSERT INTO stage_summary
SELECT 
  'Experiment Assignment' AS stage,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE experiment_id IS NOT NULL) AS passed,
  COUNT(*) FILTER (WHERE experiment_id IS NULL) AS failed,
  0 AS pending,
  'No experiment assigned' AS top_failure_reason
FROM signals
WHERE created_at >= CURRENT_DATE
  AND COALESCE(is_test, false) = false
  AND status != 'rejected';

-- Stage 7: Recommendations
INSERT INTO stage_summary
SELECT 
  'Recommendations' AS stage,
  COUNT(DISTINCT s.signal_id) AS total,
  COUNT(DISTINCT dr.recommendation_id) AS passed,
  COUNT(DISTINCT s.signal_id) FILTER (WHERE dr.recommendation_id IS NULL) AS failed,
  0 AS pending,
  'No recommendation generated' AS top_failure_reason
FROM signals s
LEFT JOIN decision_recommendations dr ON dr.signal_id = s.signal_id
WHERE s.created_at >= CURRENT_DATE
  AND COALESCE(s.is_test, false) = false
  AND s.status != 'rejected';

-- Stage 8: Order Creation
INSERT INTO stage_summary
SELECT 
  'Order Creation' AS stage,
  COUNT(DISTINCT s.signal_id) AS total,
  COUNT(DISTINCT o.order_id) AS passed,
  COUNT(DISTINCT s.signal_id) FILTER (WHERE o.order_id IS NULL) AS failed,
  0 AS pending,
  'Order not created from recommendation' AS top_failure_reason
FROM signals s
LEFT JOIN orders o ON o.signal_id = s.signal_id
WHERE s.created_at >= CURRENT_DATE
  AND COALESCE(s.is_test, false) = false
  AND s.status != 'rejected';

-- Stage 9: Fills
INSERT INTO stage_summary
SELECT 
  'Fills' AS stage,
  COUNT(DISTINCT o.order_id) AS total,
  COUNT(DISTINCT t.trade_id) AS passed,
  COUNT(DISTINCT o.order_id) FILTER (WHERE t.trade_id IS NULL) AS failed,
  COUNT(DISTINCT o.order_id) FILTER (WHERE o.status = 'pending') AS pending,
  'Order not filled' AS top_failure_reason
FROM orders o
LEFT JOIN trades t ON t.order_id = o.order_id
WHERE o.created_at >= CURRENT_DATE;

-- Display summary table
\echo ''
SELECT 
  stage,
  total,
  passed,
  failed,
  pending,
  ROUND(passed * 100.0 / NULLIF(total, 0), 1) AS pass_rate_pct,
  top_failure_reason
FROM stage_summary
ORDER BY 
  CASE stage
    WHEN 'Webhook Validation' THEN 1
    WHEN 'Deduplication' THEN 2
    WHEN 'Signal Persistence' THEN 3
    WHEN 'Enrichment' THEN 4
    WHEN 'Risk Checks' THEN 5
    WHEN 'Experiment Assignment' THEN 6
    WHEN 'Recommendations' THEN 7
    WHEN 'Order Creation' THEN 8
    WHEN 'Fills' THEN 9
  END;

\echo ''
\echo '============================================================================'
\echo 'ROOT CAUSE ANALYSIS CHECKLIST'
\echo '============================================================================'
\echo ''

-- Check for common issues
\echo 'Data Pipeline Issues:'
SELECT 
  'GEX Snapshots Today' AS check_item,
  COUNT(*) AS count,
  CASE WHEN COUNT(*) = 0 THEN '❌ CRITICAL' ELSE '✅ OK' END AS status
FROM gex_snapshots
WHERE created_at >= CURRENT_DATE;

SELECT 
  'GEX Data All Zeros' AS check_item,
  COUNT(*) AS count,
  CASE WHEN COUNT(*) > 0 THEN '⚠️ WARNING' ELSE '✅ OK' END AS status
FROM gex_snapshots
WHERE created_at >= CURRENT_DATE
  AND total_call_gex = 0 
  AND total_put_gex = 0;

SELECT 
  'Enrichment Without GEX' AS check_item,
  COUNT(*) AS count,
  CASE WHEN COUNT(*) > 0 THEN '⚠️ WARNING' ELSE '✅ OK' END AS status
FROM (
  SELECT s.signal_id
  FROM signals s
  LEFT JOIN LATERAL (
    SELECT enriched_data
    FROM refactored_signals rs
    WHERE rs.signal_id = s.signal_id
    ORDER BY processed_at DESC
    LIMIT 1
  ) rs ON true
  LEFT JOIN LATERAL (
    SELECT snapshot_id
    FROM gex_snapshots gs
    WHERE gs.symbol = s.symbol
      AND gs.created_at BETWEEN s.created_at - INTERVAL '5 minutes' AND s.created_at + INTERVAL '10 minutes'
    ORDER BY gs.created_at DESC
    LIMIT 1
  ) gs ON true
  WHERE s.created_at >= CURRENT_DATE
    AND COALESCE(s.is_test, false) = false
    AND rs.enriched_data IS NOT NULL
    AND gs.snapshot_id IS NULL
) missing_gex;

\echo ''
\echo 'Decision Engine Issues:'
SELECT 
  'Recommendations Without Strike' AS check_item,
  COUNT(*) AS count,
  CASE WHEN COUNT(*) > 0 THEN '❌ CRITICAL' ELSE '✅ OK' END AS status
FROM decision_recommendations
WHERE created_at >= CURRENT_DATE
  AND strike IS NULL;

SELECT 
  'Recommendations Without GEX Context' AS check_item,
  COUNT(*) AS count,
  CASE WHEN COUNT(*) > 0 THEN '⚠️ WARNING' ELSE '✅ OK' END AS status
FROM decision_recommendations
WHERE created_at >= CURRENT_DATE
  AND rationale->>'gammaRegime' IS NULL;

\echo ''
\echo '============================================================================'
\echo 'FINAL VERDICT'
\echo '============================================================================'
\echo ''
\echo 'Run the following to see detailed root causes:'
\echo '  psql -f scripts/diagnostics/pipeline-forensics.sql'
\echo '  psql -f scripts/diagnostics/gex-deep-dive.sql'
\echo '  psql -f scripts/diagnostics/trade-quality-forensics.sql'
\echo ''

-- Cleanup
DROP TABLE IF EXISTS stage_summary;
