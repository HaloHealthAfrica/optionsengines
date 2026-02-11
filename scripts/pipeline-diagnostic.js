import fs from 'fs/promises';
import path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
});

async function tableExists(tableName) {
  const result = await pool.query(
    `SELECT to_regclass($1) AS regclass`,
    [`public.${tableName}`]
  );
  return Boolean(result.rows[0]?.regclass);
}

async function runQuery(name, sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return { name, rows: result.rows, error: null };
  } catch (error) {
    return { name, rows: [], error: error?.message || String(error) };
  }
}

function logSection(title) {
  console.log('\n' + '='.repeat(120));
  console.log(title);
  console.log('='.repeat(120));
}

function logResult(result) {
  console.log(`\n-- ${result.name}`);
  if (result.error) {
    console.log(`ERROR: ${result.error}`);
    return;
  }
  if (result.rows.length === 0) {
    console.log('(no rows)');
    return;
  }
  console.table(result.rows);
}

function asCountMap(rows, key, valueKey = 'count') {
  return rows.reduce((acc, row) => {
    const label = row[key] ?? 'unknown';
    acc[label] = Number(row[valueKey] ?? 0);
    return acc;
  }, {});
}

function sumCounts(map) {
  return Object.values(map).reduce((sum, value) => sum + Number(value || 0), 0);
}

function formatDateLocal(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function main() {
  const reportDate = formatDateLocal(new Date());
  const outputDir = path.resolve(process.cwd(), 'tmp');
  await fs.mkdir(outputDir, { recursive: true });

  const hasGex = await tableExists('gex_snapshots');
  const hasShadowTrades = await tableExists('shadow_trades');
  const hasPositions = await tableExists('positions');
  const hasRefactoredFailures = await tableExists('refactored_pipeline_failures');
  const hasRefactoredErrors = await tableExists('refactored_processing_errors');

  const results = [];

  logSection('Stage 1: Webhook Ingestion & Validation');
  results.push(
    await runQuery(
      'Stage1 webhook status breakdown',
      `SELECT
         status,
         COUNT(*) AS count,
         ARRAY_AGG(DISTINCT error_message) FILTER (WHERE error_message IS NOT NULL) AS error_messages
       FROM webhook_events
       WHERE created_at >= CURRENT_DATE
         AND COALESCE(is_test, false) = false
       GROUP BY status
       ORDER BY count DESC`
    )
  );

  logSection('Stage 2: Deduplication');
  results.push(
    await runQuery(
      'Stage2 duplicates by symbol/timeframe',
      `SELECT
         we.symbol,
         we.timeframe,
         COUNT(*) AS duplicate_count,
         MIN(we.created_at) AS first_seen,
         MAX(we.created_at) AS last_seen,
         MAX(we.created_at) - MIN(we.created_at) AS window_span
       FROM webhook_events we
       WHERE we.created_at >= CURRENT_DATE
         AND we.status = 'duplicate'
         AND COALESCE(we.is_test, false) = false
       GROUP BY we.symbol, we.timeframe
       ORDER BY duplicate_count DESC`
    )
  );

  logSection('Stage 3: Signal Persistence');
  results.push(
    await runQuery(
      'Stage3 processed-without-signal (status=processed)',
      `SELECT
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
       ORDER BY we.created_at`
    )
  );
  results.push(
    await runQuery(
      'Stage3 accepted-without-signal (status=accepted)',
      `SELECT
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
         AND we.status = 'accepted'
         AND we.signal_id IS NULL
         AND COALESCE(we.is_test, false) = false
       ORDER BY we.created_at`
    )
  );
  if (hasRefactoredFailures) {
    results.push(
      await runQuery(
        'Stage3 refactored_pipeline_failures',
        `SELECT * FROM refactored_pipeline_failures
         WHERE created_at >= CURRENT_DATE
         ORDER BY created_at`
      )
    );
  }
  if (hasRefactoredErrors) {
    results.push(
      await runQuery(
        'Stage3 refactored_processing_errors',
        `SELECT * FROM refactored_processing_errors
         WHERE created_at >= CURRENT_DATE
         ORDER BY created_at`
      )
    );
  }

  logSection('Stage 4: Enrichment (GEX, Market Context, Options Flow)');
  if (hasGex) {
    results.push(
      await runQuery(
        'Stage4 enrichment coverage with GEX snapshots',
        `SELECT
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
           gs.gex_snapshot_id IS NOT NULL AS has_gex_snapshot,
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
           FROM refactored_signals rs WHERE rs.signal_id = s.signal_id
           ORDER BY processed_at DESC LIMIT 1
         ) rs ON true
         LEFT JOIN LATERAL (
           SELECT context_id, current_price, volume, indicators
           FROM market_contexts mc WHERE mc.signal_id = s.signal_id
           ORDER BY created_at DESC LIMIT 1
         ) mc ON true
         LEFT JOIN LATERAL (
           SELECT gex_snapshot_id, net_gex, total_call_gex, total_put_gex, zero_gamma_level, source
           FROM gex_snapshots gs WHERE gs.symbol = s.symbol
             AND gs.created_at >= s.created_at - INTERVAL '5 minutes'
             AND gs.created_at <= s.created_at + INTERVAL '10 minutes'
           ORDER BY gs.created_at DESC LIMIT 1
         ) gs ON true
         WHERE s.created_at >= CURRENT_DATE
           AND COALESCE(s.is_test, false) = false
         ORDER BY s.created_at`
      )
    );
  } else {
    results.push({
      name: 'Stage4 enrichment coverage with GEX snapshots',
      rows: [],
      error: 'gex_snapshots table missing',
    });
  }

  logSection('Stage 5: Risk Checks');
  results.push(
    await runQuery(
      'Stage5 risk checks and rejections',
      `SELECT
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
         FROM refactored_signals rs WHERE rs.signal_id = s.signal_id
         ORDER BY processed_at DESC LIMIT 1
       ) rs ON true
       WHERE s.created_at >= CURRENT_DATE
         AND COALESCE(s.is_test, false) = false
         AND (s.rejection_reason IS NOT NULL OR rs.rejection_reason IS NOT NULL)
       ORDER BY s.created_at`
    )
  );

  logSection('Stage 6: Experiment Assignment & Execution Policy');
  if (hasShadowTrades) {
    results.push(
      await runQuery(
        'Stage6 experiment assignment summary',
        `SELECT
           e.variant,
           ep.execution_mode,
           ep.executed_engine,
           ep.shadow_engine,
           COUNT(*) AS signal_count,
           COUNT(DISTINCT o.order_id) FILTER (WHERE o.order_id IS NOT NULL) AS orders_created,
           COUNT(DISTINCT st.shadow_trade_id) FILTER (WHERE st.shadow_trade_id IS NOT NULL) AS shadow_trades_created
         FROM experiments e
         JOIN signals s ON s.experiment_id = e.experiment_id
         LEFT JOIN execution_policies ep ON ep.experiment_id = e.experiment_id
         LEFT JOIN orders o ON o.signal_id = s.signal_id
         LEFT JOIN shadow_trades st ON st.experiment_id = e.experiment_id
         WHERE e.created_at >= CURRENT_DATE
         GROUP BY e.variant, ep.execution_mode, ep.executed_engine, ep.shadow_engine
         ORDER BY e.variant`
      )
    );
  } else {
    results.push({
      name: 'Stage6 experiment assignment summary',
      rows: [],
      error: 'shadow_trades table missing',
    });
  }

  logSection('Stage 7: Recommendations');
  results.push(
    await runQuery(
      'Stage7 decision recommendations',
      `SELECT
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
       ORDER BY dr.created_at`
    )
  );

  logSection('Stage 8: Orders & Fills');
  results.push(
    await runQuery(
      'Stage8 orders and fills',
      `SELECT
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
       ORDER BY o.created_at`
    )
  );

  logSection('Part 2: GEX & Gamma Deep Dive');
  if (hasGex) {
    results.push(
      await runQuery(
        'GEX data quality check',
        `SELECT
           gs.symbol,
           gs.net_gex,
           gs.total_call_gex,
           gs.total_put_gex,
           gs.zero_gamma_level,
           gs.source,
           gs.created_at,
           CASE WHEN gs.net_gex = 0 THEN 'SUSPICIOUS_ZERO' ELSE 'OK' END AS gex_check,
           CASE WHEN gs.zero_gamma_level IS NULL THEN 'MISSING_ZERO_GAMMA' ELSE 'OK' END AS zgamma_check,
           CASE WHEN gs.total_call_gex = 0 AND gs.total_put_gex = 0 THEN 'ALL_ZERO' ELSE 'OK' END AS data_check
         FROM gex_snapshots gs
         WHERE gs.created_at >= CURRENT_DATE
         ORDER BY gs.created_at`
      )
    );
    results.push(
      await runQuery(
        'GEX data propagation to enrichment and recommendations',
        `SELECT
           s.signal_id,
           s.symbol,
           s.direction,
           gs.net_gex,
           gs.zero_gamma_level,
           gs.source AS gex_source,
           rs.enriched_data->>'gex' IS NOT NULL AS enrichment_has_gex,
           rs.enriched_data->>'gammaRegime' AS gamma_regime,
           rs.enriched_data->>'putCallRatio' AS pc_ratio,
           rs.enriched_data->>'maxPain' AS max_pain,
           dr.rationale->>'gammaRegime' AS rec_gamma_regime,
           dr.rationale->>'gexAdjustment' AS rec_gex_adjustment,
           dr.rationale->>'sizeMultiplier' AS rec_size_multiplier,
           dr.rationale->>'confidenceAdjustment' AS rec_confidence_adj
         FROM signals s
         LEFT JOIN LATERAL (
           SELECT net_gex, zero_gamma_level, source
           FROM gex_snapshots gs WHERE gs.symbol = s.symbol
             AND gs.created_at BETWEEN s.created_at - INTERVAL '5 minutes' AND s.created_at + INTERVAL '10 minutes'
           ORDER BY gs.created_at DESC LIMIT 1
         ) gs ON true
         LEFT JOIN LATERAL (
           SELECT enriched_data
           FROM refactored_signals rs WHERE rs.signal_id = s.signal_id
           ORDER BY processed_at DESC LIMIT 1
         ) rs ON true
         LEFT JOIN LATERAL (
           SELECT rationale
           FROM decision_recommendations dr WHERE dr.signal_id = s.signal_id
           ORDER BY created_at DESC LIMIT 1
         ) dr ON true
         WHERE s.created_at >= CURRENT_DATE
           AND COALESCE(s.is_test, false) = false
         ORDER BY s.created_at`
      )
    );
    if (hasPositions) {
      results.push(
        await runQuery(
          'GEX vs trade direction alignment',
          `SELECT
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
             FROM gex_snapshots gs WHERE gs.symbol = s.symbol
               AND gs.created_at BETWEEN s.created_at - INTERVAL '5 minutes' AND s.created_at + INTERVAL '10 minutes'
             ORDER BY gs.created_at DESC LIMIT 1
           ) gs ON true
           LEFT JOIN LATERAL (
             SELECT current_price
             FROM market_contexts mc WHERE mc.signal_id = s.signal_id
             ORDER BY created_at DESC LIMIT 1
           ) mc ON true
           LEFT JOIN positions p ON p.signal_id = s.signal_id
           WHERE s.created_at >= CURRENT_DATE
             AND COALESCE(s.is_test, false) = false
           ORDER BY s.created_at`
        )
      );
    } else {
      results.push({
        name: 'GEX vs trade direction alignment',
        rows: [],
        error: 'positions table missing',
      });
    }
    results.push(
      await runQuery(
        'Options flow alignment',
        `SELECT
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
           FROM refactored_signals rs WHERE rs.signal_id = s.signal_id
           ORDER BY processed_at DESC LIMIT 1
         ) rs ON true
         WHERE s.created_at >= CURRENT_DATE
           AND COALESCE(s.is_test, false) = false
           AND s.status != 'rejected'
         ORDER BY s.created_at`
      )
    );
  } else {
    results.push({
      name: 'GEX data quality check',
      rows: [],
      error: 'gex_snapshots table missing',
    });
    results.push({
      name: 'GEX data propagation to enrichment and recommendations',
      rows: [],
      error: 'gex_snapshots table missing',
    });
    results.push({
      name: 'Options flow alignment',
      rows: [],
      error: 'gex_snapshots table missing',
    });
  }

  logSection('Part 3: Trade Quality Forensics');
  results.push(
    await runQuery(
      'Full trade audit trail',
      `SELECT
         we.event_id,
         we.created_at AS webhook_time,
         s.signal_id,
         s.symbol,
         s.direction,
         s.timeframe,
         e.variant,
         gs.net_gex,
         gs.zero_gamma_level,
         mc.current_price AS entry_market_price,
         dr.engine AS rec_engine,
         dr.strike AS rec_strike,
         dr.expiration AS rec_expiration,
         dr.quantity AS rec_quantity,
         dr.rationale->>'confidence' AS rec_confidence,
         o.order_type,
         o.option_symbol,
         t.fill_price,
         t.fill_quantity,
         t.fill_timestamp,
         p.unrealized_pnl,
         p.realized_pnl,
         p.status AS position_status,
         EXTRACT(EPOCH FROM (t.fill_timestamp - we.created_at)) AS webhook_to_fill_seconds
       FROM webhook_events we
       JOIN signals s ON s.signal_id = we.signal_id
       LEFT JOIN experiments e ON e.experiment_id = COALESCE(we.experiment_id, s.experiment_id)
       LEFT JOIN LATERAL (
         SELECT net_gex, zero_gamma_level FROM gex_snapshots gs
         WHERE gs.symbol = s.symbol
           AND gs.created_at BETWEEN s.created_at - INTERVAL '5 minutes' AND s.created_at + INTERVAL '10 minutes'
         ORDER BY gs.created_at DESC LIMIT 1
       ) gs ON true
       LEFT JOIN LATERAL (
         SELECT current_price FROM market_contexts mc
         WHERE mc.signal_id = s.signal_id ORDER BY created_at DESC LIMIT 1
       ) mc ON true
       LEFT JOIN decision_recommendations dr ON dr.signal_id = s.signal_id
       LEFT JOIN orders o ON o.signal_id = s.signal_id
       LEFT JOIN trades t ON t.order_id = o.order_id
       LEFT JOIN positions p ON p.signal_id = s.signal_id
       WHERE we.created_at >= CURRENT_DATE
         AND COALESCE(we.is_test, false) = false
         AND we.status = 'processed'
       ORDER BY we.created_at`
    )
  );
  results.push(
    await runQuery(
      'Trades that violated GEX logic',
      `SELECT
         s.signal_id,
         s.symbol,
         s.direction,
         o.option_symbol,
         t.fill_price,
         gs.net_gex,
         gs.zero_gamma_level,
         mc.current_price,
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
         SELECT net_gex, zero_gamma_level FROM gex_snapshots gs
         WHERE gs.symbol = s.symbol
           AND gs.created_at BETWEEN s.created_at - INTERVAL '5 minutes' AND s.created_at + INTERVAL '10 minutes'
         ORDER BY gs.created_at DESC LIMIT 1
       ) gs ON true
       LEFT JOIN LATERAL (
         SELECT current_price FROM market_contexts mc
         WHERE mc.signal_id = s.signal_id ORDER BY created_at DESC LIMIT 1
       ) mc ON true
       LEFT JOIN LATERAL (
         SELECT enriched_data FROM refactored_signals rs
         WHERE rs.signal_id = s.signal_id ORDER BY processed_at DESC LIMIT 1
       ) rs ON true
       WHERE s.created_at >= CURRENT_DATE
         AND COALESCE(s.is_test, false) = false
       ORDER BY s.created_at`
    )
  );

  for (const result of results) {
    logResult(result);
  }

  const stage1 = results.find((r) => r.name === 'Stage1 webhook status breakdown');
  const stage1Counts = stage1?.rows ? asCountMap(stage1.rows, 'status') : {};
  const stage1Total = sumCounts(stage1Counts);
  const stage1Failed =
    (stage1Counts.invalid_signature || 0) +
    (stage1Counts.invalid_payload || 0) +
    (stage1Counts.error || 0);
  const stage1Passed = stage1Total - stage1Failed;

  const stage2Duplicates = results.find((r) => r.name === 'Stage2 duplicates by symbol/timeframe');
  const stage2Failed = stage2Duplicates?.rows?.reduce((sum, row) => sum + Number(row.duplicate_count || 0), 0) || 0;
  const stage2Passed = stage1Counts.accepted || 0;
  const stage2Total = stage2Passed + stage2Failed;

  const stage3AcceptedWithoutSignal = results.find(
    (r) => r.name === 'Stage3 accepted-without-signal (status=accepted)'
  );
  const stage3Failed = stage3AcceptedWithoutSignal?.rows?.length || 0;
  const stage3Passed = (stage1Counts.accepted || 0) - stage3Failed;

  const summary = {
    generated_at: new Date().toISOString(),
    report_date: reportDate,
    tables_present: {
      gex_snapshots: hasGex,
      shadow_trades: hasShadowTrades,
      positions: hasPositions,
      refactored_pipeline_failures: hasRefactoredFailures,
      refactored_processing_errors: hasRefactoredErrors,
    },
    stage_summary: [
      {
        stage: 'Webhook Validation',
        total: stage1Total,
        passed: stage1Passed,
        failed: stage1Failed,
        pending: 0,
        top_failure_reason: Object.entries(stage1Counts)
          .filter(([key]) => ['invalid_signature', 'invalid_payload', 'error'].includes(key))
          .sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] || 'none',
      },
      {
        stage: 'Deduplication',
        total: stage2Total,
        passed: stage2Passed,
        failed: stage2Failed,
        pending: 0,
        top_failure_reason: stage2Failed > 0 ? 'duplicate' : 'none',
      },
      {
        stage: 'Signal Persistence',
        total: stage1Counts.accepted || 0,
        passed: stage3Passed,
        failed: stage3Failed,
        pending: 0,
        top_failure_reason: stage3Failed > 0 ? 'missing_signal' : 'none',
      },
    ],
  };

  const outputPath = path.join(outputDir, `pipeline-diagnostic-${reportDate}.json`);
  await fs.writeFile(outputPath, JSON.stringify({ results, summary }, null, 2), 'utf8');
  console.log(`\nSaved JSON report to ${outputPath}`);
  await pool.end();
}

main().catch(async (error) => {
  console.error('Pipeline diagnostic failed:', error);
  await pool.end();
  process.exit(1);
});
