-- ============================================================================
-- GEX & GAMMA DEEP DIVE: Why Didn't It Work?
-- Purpose: Analyze GEX data quality and usage in decision-making
-- ============================================================================

SET timezone = 'America/New_York';

\echo '============================================================================'
\echo 'PART 2: GEX & GAMMA ANALYSIS'
\echo '============================================================================'

\echo ''
\echo 'Query 1: GEX Data Quality Check'
\echo '============================================================================'

SELECT 
  gs.symbol,
  gs.net_gex,
  gs.total_call_gex,
  gs.total_put_gex,
  gs.zero_gamma_level,
  gs.source,
  gs.created_at,
  -- Sanity checks
  CASE WHEN gs.net_gex = 0 THEN 'SUSPICIOUS_ZERO' ELSE 'OK' END AS gex_check,
  CASE WHEN gs.zero_gamma_level IS NULL THEN 'MISSING_ZERO_GAMMA' ELSE 'OK' END AS zgamma_check,
  CASE WHEN gs.total_call_gex = 0 AND gs.total_put_gex = 0 THEN 'ALL_ZERO' ELSE 'OK' END AS data_check
FROM gex_snapshots gs
WHERE gs.created_at >= CURRENT_DATE
ORDER BY gs.created_at;

\echo ''
\echo 'GEX Data Quality Summary:'
SELECT 
  COUNT(*) AS total_snapshots,
  COUNT(*) FILTER (WHERE net_gex = 0) AS zero_net_gex,
  COUNT(*) FILTER (WHERE zero_gamma_level IS NULL) AS missing_zero_gamma,
  COUNT(*) FILTER (WHERE total_call_gex = 0 AND total_put_gex = 0) AS all_zero,
  COUNT(DISTINCT symbol) AS symbols_covered,
  COUNT(DISTINCT source) AS sources_used,
  ARRAY_AGG(DISTINCT source) AS source_list
FROM gex_snapshots
WHERE created_at >= CURRENT_DATE;

\echo ''
\echo 'Query 2: GEX Data Flow - Snapshot → Enrichment → Recommendation'
\echo '============================================================================'

SELECT 
  s.signal_id,
  s.symbol,
  s.direction,
  gs.net_gex,
  gs.zero_gamma_level,
  gs.source AS gex_source,
  -- Check if enrichment included GEX
  rs.enriched_data->>'gex' IS NOT NULL AS enrichment_has_gex,
  rs.enriched_data->>'gammaRegime' AS gamma_regime,
  rs.enriched_data->>'putCallRatio' AS pc_ratio,
  rs.enriched_data->>'maxPain' AS max_pain,
  -- Check if recommendation used GEX
  dr.rationale->>'gammaRegime' AS rec_gamma_regime,
  dr.rationale->>'gexAdjustment' AS rec_gex_adjustment,
  dr.rationale->>'sizeMultiplier' AS rec_size_multiplier,
  dr.rationale->>'confidenceAdjustment' AS rec_confidence_adj
FROM signals s
LEFT JOIN LATERAL (
  SELECT net_gex, zero_gamma_level, source
  FROM gex_snapshots gs
  WHERE gs.symbol = s.symbol
    AND gs.created_at BETWEEN s.created_at - INTERVAL '5 minutes' AND s.created_at + INTERVAL '10 minutes'
  ORDER BY gs.created_at DESC
  LIMIT 1
) gs ON true
LEFT JOIN LATERAL (
  SELECT enriched_data
  FROM refactored_signals rs
  WHERE rs.signal_id = s.signal_id
  ORDER BY processed_at DESC
  LIMIT 1
) rs ON true
LEFT JOIN LATERAL (
  SELECT rationale
  FROM decision_recommendations dr
  WHERE dr.signal_id = s.signal_id
  ORDER BY created_at DESC
  LIMIT 1
) dr ON true
WHERE s.created_at >= CURRENT_DATE
  AND COALESCE(s.is_test, false) = false
ORDER BY s.created_at;

\echo ''
\echo 'GEX Usage Summary:'
SELECT 
  COUNT(*) AS total_signals,
  COUNT(*) FILTER (WHERE gex_snapshot_exists) AS had_gex_snapshot,
  COUNT(*) FILTER (WHERE enrichment_has_gex) AS enrichment_included_gex,
  COUNT(*) FILTER (WHERE rec_used_gex) AS recommendation_used_gex,
  ROUND(COUNT(*) FILTER (WHERE gex_snapshot_exists) * 100.0 / NULLIF(COUNT(*), 0), 2) AS gex_availability_pct,
  ROUND(COUNT(*) FILTER (WHERE enrichment_has_gex) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE gex_snapshot_exists), 0), 2) AS gex_to_enrichment_pct,
  ROUND(COUNT(*) FILTER (WHERE rec_used_gex) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE enrichment_has_gex), 0), 2) AS enrichment_to_rec_pct
FROM (
  SELECT 
    s.signal_id,
    gs.net_gex IS NOT NULL AS gex_snapshot_exists,
    rs.enriched_data->>'gex' IS NOT NULL AS enrichment_has_gex,
    (dr.rationale->>'gammaRegime' IS NOT NULL OR dr.rationale->>'gexAdjustment' IS NOT NULL) AS rec_used_gex
  FROM signals s
  LEFT JOIN LATERAL (
    SELECT net_gex
    FROM gex_snapshots gs
    WHERE gs.symbol = s.symbol
      AND gs.created_at BETWEEN s.created_at - INTERVAL '5 minutes' AND s.created_at + INTERVAL '10 minutes'
    ORDER BY gs.created_at DESC
    LIMIT 1
  ) gs ON true
  LEFT JOIN LATERAL (
    SELECT enriched_data
    FROM refactored_signals rs
    WHERE rs.signal_id = s.signal_id
    ORDER BY processed_at DESC
    LIMIT 1
  ) rs ON true
  LEFT JOIN LATERAL (
    SELECT rationale
    FROM decision_recommendations dr
    WHERE dr.signal_id = s.signal_id
    ORDER BY created_at DESC
    LIMIT 1
  ) dr ON true
  WHERE s.created_at >= CURRENT_DATE
    AND COALESCE(s.is_test, false) = false
) gex_flow;


\echo ''
\echo 'Query 3: GEX vs Actual Trade Direction Alignment'
\echo '============================================================================'

SELECT 
  s.signal_id,
  s.symbol,
  s.direction AS signal_direction,
  gs.net_gex,
  CASE
    WHEN gs.net_gex > 0 THEN 'LONG_GAMMA_MEAN_REVERSION'
    WHEN gs.net_gex < 0 THEN 'SHORT_GAMMA_BREAKOUT'
    ELSE 'NEUTRAL'
  END AS gex_regime,
  CASE
    WHEN gs.net_gex > 0 AND s.direction = 'long' THEN 'ALIGNED (expect reversion up)'
    WHEN gs.net_gex > 0 AND s.direction = 'short' THEN 'ALIGNED (expect reversion down)'
    WHEN gs.net_gex < 0 AND s.direction = 'long' THEN 'BREAKOUT_LONG (high risk)'
    WHEN gs.net_gex < 0 AND s.direction = 'short' THEN 'BREAKOUT_SHORT (high risk)'
    ELSE 'NO_SIGNAL'
  END AS alignment,
  gs.zero_gamma_level,
  mc.current_price,
  CASE
    WHEN mc.current_price > gs.zero_gamma_level THEN 'ABOVE_ZERO_GAMMA'
    WHEN mc.current_price < gs.zero_gamma_level THEN 'BELOW_ZERO_GAMMA'
    ELSE 'AT_ZERO_GAMMA'
  END AS price_vs_zgamma,
  o.option_symbol,
  t.fill_price,
  p.unrealized_pnl,
  p.status AS position_status
FROM signals s
JOIN orders o ON o.signal_id = s.signal_id
LEFT JOIN trades t ON t.order_id = o.order_id
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
LEFT JOIN positions p ON p.signal_id = s.signal_id
WHERE s.created_at >= CURRENT_DATE
  AND COALESCE(s.is_test, false) = false
ORDER BY s.created_at;

\echo ''
\echo 'GEX Alignment Summary:'
SELECT 
  alignment,
  COUNT(*) AS trade_count,
  AVG(unrealized_pnl) FILTER (WHERE unrealized_pnl IS NOT NULL) AS avg_pnl,
  COUNT(*) FILTER (WHERE unrealized_pnl > 0) AS winning_trades,
  COUNT(*) FILTER (WHERE unrealized_pnl < 0) AS losing_trades
FROM (
  SELECT 
    CASE
      WHEN gs.net_gex > 0 AND s.direction = 'long' THEN 'ALIGNED_LONG'
      WHEN gs.net_gex > 0 AND s.direction = 'short' THEN 'ALIGNED_SHORT'
      WHEN gs.net_gex < 0 AND s.direction = 'long' THEN 'BREAKOUT_LONG'
      WHEN gs.net_gex < 0 AND s.direction = 'short' THEN 'BREAKOUT_SHORT'
      ELSE 'NO_GEX_DATA'
    END AS alignment,
    p.unrealized_pnl
  FROM signals s
  JOIN orders o ON o.signal_id = s.signal_id
  LEFT JOIN LATERAL (
    SELECT net_gex
    FROM gex_snapshots gs
    WHERE gs.symbol = s.symbol
      AND gs.created_at BETWEEN s.created_at - INTERVAL '5 minutes' AND s.created_at + INTERVAL '10 minutes'
    ORDER BY gs.created_at DESC
    LIMIT 1
  ) gs ON true
  LEFT JOIN positions p ON p.signal_id = s.signal_id
  WHERE s.created_at >= CURRENT_DATE
    AND COALESCE(s.is_test, false) = false
) alignment_analysis
GROUP BY alignment
ORDER BY trade_count DESC;

\echo ''
\echo 'Query 4: Options Flow Alignment'
\echo '============================================================================'

SELECT 
  s.signal_id,
  s.symbol,
  s.direction,
  rs.enriched_data->>'putCallRatio' AS pc_ratio,
  rs.enriched_data->>'flowSentiment' AS flow_sentiment,
  rs.enriched_data->>'darkPoolActivity' AS dark_pool,
  rs.enriched_data->>'unusualActivity' AS unusual_activity,
  CASE
    WHEN (rs.enriched_data->>'putCallRatio')::float < 0.7 AND s.direction = 'long' THEN 'FLOW_CONFIRMS_LONG'
    WHEN (rs.enriched_data->>'putCallRatio')::float > 1.3 AND s.direction = 'short' THEN 'FLOW_CONFIRMS_SHORT'
    WHEN (rs.enriched_data->>'putCallRatio')::float < 0.7 AND s.direction = 'short' THEN 'FLOW_CONTRADICTS (bullish flow, we went short)'
    WHEN (rs.enriched_data->>'putCallRatio')::float > 1.3 AND s.direction = 'long' THEN 'FLOW_CONTRADICTS (bearish flow, we went long)'
    ELSE 'NEUTRAL_FLOW'
  END AS flow_alignment
FROM signals s
LEFT JOIN LATERAL (
  SELECT enriched_data
  FROM refactored_signals rs
  WHERE rs.signal_id = s.signal_id
  ORDER BY processed_at DESC
  LIMIT 1
) rs ON true
WHERE s.created_at >= CURRENT_DATE
  AND COALESCE(s.is_test, false) = false
  AND s.status != 'rejected'
ORDER BY s.created_at;

\echo ''
\echo 'Options Flow Summary:'
SELECT 
  flow_alignment,
  COUNT(*) AS signal_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS percentage
FROM (
  SELECT 
    CASE
      WHEN rs.enriched_data->>'putCallRatio' IS NULL THEN 'NO_FLOW_DATA'
      WHEN (rs.enriched_data->>'putCallRatio')::float < 0.7 AND s.direction = 'long' THEN 'CONFIRMS_LONG'
      WHEN (rs.enriched_data->>'putCallRatio')::float > 1.3 AND s.direction = 'short' THEN 'CONFIRMS_SHORT'
      WHEN (rs.enriched_data->>'putCallRatio')::float < 0.7 AND s.direction = 'short' THEN 'CONTRADICTS'
      WHEN (rs.enriched_data->>'putCallRatio')::float > 1.3 AND s.direction = 'long' THEN 'CONTRADICTS'
      ELSE 'NEUTRAL'
    END AS flow_alignment
  FROM signals s
  LEFT JOIN LATERAL (
    SELECT enriched_data
    FROM refactored_signals rs
    WHERE rs.signal_id = s.signal_id
    ORDER BY processed_at DESC
    LIMIT 1
  ) rs ON true
  WHERE s.created_at >= CURRENT_DATE
    AND COALESCE(s.is_test, false) = false
    AND s.status != 'rejected'
) flow_analysis
GROUP BY flow_alignment
ORDER BY signal_count DESC;
