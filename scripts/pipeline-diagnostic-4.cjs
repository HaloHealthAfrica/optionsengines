const pg = require('pg');
const { config } = require('../dist/config/index.js');
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });

async function run() {
  // 1. Invalid payload webhook samples (correct column: raw_payload)
  const invalidSamples = await pool.query(
    `SELECT event_id, status, error_message, symbol, direction, created_at,
            LEFT(raw_payload::text, 300) as payload_preview
     FROM webhook_events
     WHERE status = 'invalid_payload'
     ORDER BY created_at DESC LIMIT 5`
  );
  console.log('=== INVALID PAYLOAD WEBHOOK SAMPLES ===');
  for (const row of invalidSamples.rows) {
    console.log('---');
    console.log('at:', row.created_at, 'error:', row.error_message);
    console.log('symbol:', row.symbol, 'dir:', row.direction);
    console.log('payload:', row.payload_preview);
  }

  // 2. Config flags
  console.log('\n=== RELEVANT CONFIG ===');
  console.log('marketDataProvider:', config.marketDataProvider);
  console.log('marketDataApiKey set:', !!config.marketDataApiKey);
  console.log('marketDataApiKey prefix:', config.marketDataApiKey ? config.marketDataApiKey.substring(0, 6) + '...' : 'NONE');
  console.log('marketDataBaseUrl:', config.marketDataBaseUrl);
  console.log('marketDataProxyUrl:', config.marketDataProxyUrl || '(not set)');
  console.log('polygonApiKey set:', !!config.polygonApiKey);
  console.log('alpacaApiKey set:', !!config.alpacaApiKey);
  console.log('twelveDataApiKey set:', !!config.twelveDataApiKey);
  console.log('unusualWhalesApiKey set:', !!config.unusualWhalesApiKey);
  console.log('marketDataProviderPriority:', config.marketDataProviderPriority);
  console.log('lockStalenessMinutes:', config.lockStalenessMinutes);
  console.log('confluenceMinThreshold:', config.confluenceMinThreshold);
  console.log('enableConfluenceGate:', config.enableConfluenceGate);

  // 3. Signals by UTC hour (last 3d) — approved vs market_data_unavailable
  const hourlySuccess = await pool.query(
    `SELECT EXTRACT(HOUR FROM created_at)::int as utc_hour,
            COUNT(*)::int FILTER (WHERE status = 'approved') as approved,
            COUNT(*)::int FILTER (WHERE rejection_reason = 'market_data_unavailable') as md_unavail,
            COUNT(*)::int as total
     FROM signals
     WHERE created_at >= NOW() - INTERVAL '3 days'
     GROUP BY 1 ORDER BY 1`
  );
  console.log('\n=== SIGNALS BY UTC HOUR (last 3d) ===');
  console.table(hourlySuccess.rows);

  // 4. Stale lock age distribution
  const lockAge = await pool.query(
    `SELECT 
       CASE 
         WHEN locked_at < NOW() - INTERVAL '24 hours' THEN '>24h'
         WHEN locked_at < NOW() - INTERVAL '1 hour' THEN '1-24h'
         WHEN locked_at < NOW() - INTERVAL '10 minutes' THEN '10min-1h'
         ELSE '<10min'
       END as age_bucket,
       COUNT(*)::int as cnt
     FROM signals
     WHERE processing_lock = true AND processed = false
       AND created_at >= NOW() - INTERVAL '7 days'
     GROUP BY 1 ORDER BY cnt DESC`
  );
  console.log('\n=== STALE LOCK AGE DISTRIBUTION ===');
  console.table(lockAge.rows);

  await pool.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
