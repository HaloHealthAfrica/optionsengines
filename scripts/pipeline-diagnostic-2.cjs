const pg = require('pg');
const { config } = require('../dist/config/index.js');
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });

async function run() {
  // 1. market_data_unavailable rejections over time (hourly buckets last 24h)
  const mdTimeline = await pool.query(
    `SELECT date_trunc('hour', created_at) as hour,
            COUNT(*)::int as cnt
     FROM signals
     WHERE rejection_reason = 'market_data_unavailable'
       AND created_at >= NOW() - INTERVAL '24 hours'
     GROUP BY 1 ORDER BY 1 DESC LIMIT 24`
  );
  console.log('=== market_data_unavailable by hour (last 24h) ===');
  console.table(mdTimeline.rows);

  // 2. Stale-locked signals count
  const staleLocks = await pool.query(
    `SELECT COUNT(*)::int as stale_locked,
            MIN(created_at) as oldest,
            MAX(created_at) as newest
     FROM signals
     WHERE processing_lock = true AND processed = false
       AND created_at >= NOW() - INTERVAL '7 days'`
  );
  console.log('=== STALE LOCKED SIGNALS ===');
  console.table(staleLocks.rows);

  // 3. The few signals that DID make it through — what happened?
  const successful = await pool.query(
    `SELECT s.signal_id, s.symbol, s.direction, s.status, s.created_at,
            s.rejection_reason,
            e.variant, e.created_at as experiment_created
     FROM signals s
     LEFT JOIN experiments e ON e.signal_id = s.signal_id
     WHERE s.processed = true AND s.status = 'approved'
       AND s.created_at >= NOW() - INTERVAL '7 days'
     ORDER BY s.created_at DESC LIMIT 10`
  );
  console.log('=== SUCCESSFUL SIGNALS (approved + processed, last 7d) ===');
  console.table(successful.rows);

  // 4. Refactored signals rejection reasons breakdown
  const enrichReject = await pool.query(
    `SELECT rejection_reason, COUNT(*)::int as cnt
     FROM refactored_signals
     WHERE processed_at >= NOW() - INTERVAL '7 days'
       AND rejection_reason IS NOT NULL
     GROUP BY rejection_reason ORDER BY cnt DESC LIMIT 10`
  );
  console.log('=== ENRICHMENT REJECTION REASONS ===');
  console.table(enrichReject.rows);

  // 5. Invalid payload webhook samples
  const invalidSamples = await pool.query(
    `SELECT webhook_event_id, created_at,
            LEFT(payload::text, 200) as payload_preview
     FROM webhook_events
     WHERE status = 'invalid_payload'
     ORDER BY created_at DESC LIMIT 3`
  );
  console.log('=== INVALID PAYLOAD WEBHOOK SAMPLES ===');
  for (const row of invalidSamples.rows) {
    console.log('---');
    console.log('id:', row.webhook_event_id, 'at:', row.created_at);
    console.log('payload:', row.payload_preview);
  }

  // 6. Config flags
  console.log('\n=== RELEVANT CONFIG ===');
  console.log('marketDataProvider:', config.marketDataProvider);
  console.log('marketDataApiKey set:', !!config.marketDataApiKey);
  console.log('marketDataBaseUrl:', config.marketDataBaseUrl);
  console.log('marketDataProxyUrl:', config.marketDataProxyUrl || '(not set)');
  console.log('polygonApiKey set:', !!config.polygonApiKey);
  console.log('alpacaApiKey set:', !!config.alpacaApiKey);
  console.log('twelveDataApiKey set:', !!config.twelveDataApiKey);
  console.log('unusualWhalesApiKey set:', !!config.unusualWhalesApiKey);
  console.log('marketDataProviderPriority:', config.marketDataProviderPriority);
  console.log('lockStalenessMinutes:', config.lockStalenessMinutes);

  await pool.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
