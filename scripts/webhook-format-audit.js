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

  const webhookColumns = await runQuery(
    'webhook_events columns',
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'webhook_events'
     ORDER BY ordinal_position`
  );
  const webhookColumnNames = new Set(
    webhookColumns.rows.map((row) => String(row.column_name))
  );
  const hasWebhookRawPayload = webhookColumnNames.has('raw_payload');

  const results = [];

  logSection('Step 1: Raw Payloads of Failed Webhooks');
  if (hasWebhookRawPayload) {
    results.push(
      await runQuery(
        'Failed webhooks raw payloads',
        `SELECT
           event_id,
           created_at,
           status,
           error_message,
           symbol,
           direction,
           timeframe,
           raw_payload,
           CASE
             WHEN raw_payload->>'meta' IS NOT NULL
               AND raw_payload->'meta'->>'engine' = 'SATY_PO'
               THEN 'SATY_PHASE'
             WHEN raw_payload->>'journal' IS NOT NULL
               AND raw_payload->'journal'->>'engine' = 'STRAT_V6_FULL'
               THEN 'STRAT'
             WHEN raw_payload->>'timeframes' IS NOT NULL
               AND raw_payload->>'bias' IS NOT NULL
               THEN 'TREND'
             WHEN raw_payload->>'indicator' IS NOT NULL
               AND raw_payload->>'indicator' IN ('ORB', 'Stretch', 'BHCH', 'EMA')
               THEN 'ORB'
             WHEN raw_payload->>'trend' IS NOT NULL
               AND raw_payload->>'score' IS NOT NULL
               AND raw_payload->>'signal' IS NOT NULL
               THEN 'SIGNALS'
             ELSE 'UNKNOWN / GENERIC_TV'
           END AS detected_source,
           raw_payload->>'direction' AS field_direction,
           raw_payload->>'action' AS field_action,
           raw_payload->>'side' AS field_side,
           raw_payload->>'trend' AS field_trend,
           raw_payload->>'bias' AS field_bias,
           raw_payload->'signal'->>'side' AS field_signal_side,
           raw_payload->'regime_context'->>'local_bias' AS field_local_bias,
           raw_payload->'execution_guidance'->>'bias' AS field_exec_bias
         FROM webhook_events
         WHERE created_at >= CURRENT_DATE
           AND status = 'invalid_payload'
           AND COALESCE(is_test, false) = false
         ORDER BY created_at`
      )
    );
  } else {
    results.push({
      name: 'Failed webhooks raw payloads',
      rows: [],
      error: 'webhook_events.raw_payload column missing',
    });
  }

  logSection('Step 2: Raw Payloads of Successful Webhooks (Sample)');
  results.push(
    await runQuery(
      'Successful webhooks raw payloads (sample)',
      `SELECT
         we.event_id,
         we.created_at,
         we.status,
         we.symbol,
         we.direction,
         s.raw_payload,
         CASE
           WHEN s.raw_payload->>'meta' IS NOT NULL
             AND s.raw_payload->'meta'->>'engine' = 'SATY_PO'
             THEN 'SATY_PHASE'
           WHEN s.raw_payload->>'journal' IS NOT NULL
             AND s.raw_payload->'journal'->>'engine' = 'STRAT_V6_FULL'
             THEN 'STRAT'
           WHEN s.raw_payload->>'timeframes' IS NOT NULL
             AND s.raw_payload->>'bias' IS NOT NULL
             THEN 'TREND'
           WHEN s.raw_payload->>'indicator' IS NOT NULL
             AND s.raw_payload->>'indicator' IN ('ORB', 'Stretch', 'BHCH', 'EMA')
             THEN 'ORB'
           WHEN s.raw_payload->>'trend' IS NOT NULL
             AND s.raw_payload->>'score' IS NOT NULL
             AND s.raw_payload->>'signal' IS NOT NULL
             THEN 'SIGNALS'
           ELSE 'UNKNOWN / GENERIC_TV'
         END AS detected_source,
         s.raw_payload->>'direction' AS field_direction,
         s.raw_payload->>'action' AS field_action,
         s.raw_payload->>'trend' AS field_trend,
         s.raw_payload->>'bias' AS field_bias,
         s.raw_payload->'signal'->>'side' AS field_signal_side
       FROM webhook_events we
       LEFT JOIN signals s ON s.signal_id = we.signal_id
       WHERE we.created_at >= CURRENT_DATE
         AND we.status IN ('accepted', 'processed')
         AND COALESCE(we.is_test, false) = false
       ORDER BY we.created_at
       LIMIT 10`
    )
  );

  logSection('Step 3: Failure Patterns by Detected Source');
  if (hasWebhookRawPayload) {
    results.push(
      await runQuery(
        'Failure patterns by detected_source',
        `SELECT
           detected_source,
           COUNT(*) AS total_failures,
           COUNT(*) FILTER (WHERE raw_payload->>'direction' IS NOT NULL) AS has_direction,
           COUNT(*) FILTER (WHERE raw_payload->>'action' IS NOT NULL) AS has_action,
           COUNT(*) FILTER (WHERE raw_payload->>'side' IS NOT NULL) AS has_side,
           COUNT(*) FILTER (WHERE raw_payload->>'trend' IS NOT NULL) AS has_trend,
           COUNT(*) FILTER (WHERE raw_payload->>'bias' IS NOT NULL) AS has_bias,
           COUNT(*) FILTER (WHERE raw_payload->'signal'->>'side' IS NOT NULL) AS has_signal_side,
           COUNT(*) FILTER (WHERE raw_payload->'regime_context'->>'local_bias' IS NOT NULL) AS has_local_bias,
           COUNT(*) FILTER (WHERE raw_payload->'execution_guidance'->>'bias' IS NOT NULL) AS has_exec_bias,
           ARRAY_AGG(DISTINCT key) AS payload_key_samples
         FROM (
           SELECT
             raw_payload,
             CASE
               WHEN raw_payload->>'meta' IS NOT NULL
                 AND raw_payload->'meta'->>'engine' = 'SATY_PO'
                 THEN 'SATY_PHASE'
               WHEN raw_payload->>'journal' IS NOT NULL
                 AND raw_payload->'journal'->>'engine' = 'STRAT_V6_FULL'
                 THEN 'STRAT'
               WHEN raw_payload->>'timeframes' IS NOT NULL
                 AND raw_payload->>'bias' IS NOT NULL
                 THEN 'TREND'
               WHEN raw_payload->>'indicator' IS NOT NULL
                 AND raw_payload->>'indicator' IN ('ORB', 'Stretch', 'BHCH', 'EMA')
                 THEN 'ORB'
               WHEN raw_payload->>'trend' IS NOT NULL
                 AND raw_payload->>'score' IS NOT NULL
                 AND raw_payload->>'signal' IS NOT NULL
                 THEN 'SIGNALS'
               ELSE 'UNKNOWN / GENERIC_TV'
             END AS detected_source,
             jsonb_object_keys(raw_payload) AS key
           FROM webhook_events
           WHERE created_at >= CURRENT_DATE
             AND status = 'invalid_payload'
             AND COALESCE(is_test, false) = false
         ) sub
         GROUP BY detected_source
         ORDER BY total_failures DESC`
      )
    );
  } else {
    results.push({
      name: 'Failure patterns by detected_source',
      rows: [],
      error: 'webhook_events.raw_payload column missing',
    });
  }

  logSection('Step 4: Top-Level Keys on Failed Payloads');
  if (hasWebhookRawPayload) {
    results.push(
      await runQuery(
        'Failed payload top-level keys',
        `SELECT
           key,
           COUNT(*) AS occurrences,
           COUNT(DISTINCT event_id) AS distinct_webhooks
         FROM webhook_events,
           LATERAL jsonb_object_keys(raw_payload) AS key
         WHERE created_at >= CURRENT_DATE
           AND status = 'invalid_payload'
           AND COALESCE(is_test, false) = false
         GROUP BY key
         ORDER BY occurrences DESC`
      )
    );
  } else {
    results.push({
      name: 'Failed payload top-level keys',
      rows: [],
      error: 'webhook_events.raw_payload column missing',
    });
  }

  logSection('Step 5: Sample Raw Payload per Detected Source (All)');
  if (hasWebhookRawPayload) {
    results.push(
      await runQuery(
        'Sample raw payload per detected_source',
        `SELECT DISTINCT ON (detected_source)
           detected_source,
           raw_payload,
           status,
           created_at
         FROM (
           SELECT
             raw_payload,
             status,
             created_at,
             CASE
               WHEN raw_payload->>'meta' IS NOT NULL
                 AND raw_payload->'meta'->>'engine' = 'SATY_PO'
                 THEN 'SATY_PHASE'
               WHEN raw_payload->>'journal' IS NOT NULL
                 AND raw_payload->'journal'->>'engine' = 'STRAT_V6_FULL'
                 THEN 'STRAT'
               WHEN raw_payload->>'timeframes' IS NOT NULL
                 AND raw_payload->>'bias' IS NOT NULL
                 THEN 'TREND'
               WHEN raw_payload->>'indicator' IS NOT NULL
                 AND raw_payload->>'indicator' IN ('ORB', 'Stretch', 'BHCH', 'EMA')
                 THEN 'ORB'
               WHEN raw_payload->>'trend' IS NOT NULL
                 AND raw_payload->>'score' IS NOT NULL
                 AND raw_payload->>'signal' IS NOT NULL
                 THEN 'SIGNALS'
               ELSE 'UNKNOWN / GENERIC_TV'
             END AS detected_source
           FROM webhook_events
           WHERE created_at >= CURRENT_DATE
             AND COALESCE(is_test, false) = false
             AND raw_payload IS NOT NULL
         ) sub
         ORDER BY detected_source, created_at DESC`
      )
    );
  } else {
    results.push({
      name: 'Sample raw payload per detected_source',
      rows: [],
      error: 'webhook_events.raw_payload column missing',
    });
  }

  for (const result of results) {
    logResult(result);
  }

  const outputPath = path.join(outputDir, `webhook-format-audit-${reportDate}.json`);
  await fs.writeFile(
    outputPath,
    JSON.stringify(
      {
        results,
        hasWebhookRawPayload,
        webhookColumnNames: [...webhookColumnNames],
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`\nSaved JSON report to ${outputPath}`);
  await pool.end();
}

main().catch(async (error) => {
  console.error('Webhook format audit failed:', error);
  await pool.end();
  process.exit(1);
});
