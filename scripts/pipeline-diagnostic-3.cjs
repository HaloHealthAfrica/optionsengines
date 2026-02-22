const pg = require('pg');
const { config } = require('../dist/config/index.js');
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });

async function run() {
  // 1. Invalid payload webhook samples
  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'webhook_events' ORDER BY ordinal_position`
  );
  console.log('=== WEBHOOK_EVENTS COLUMNS ===');
  console.log(cols.rows.map(r => r.column_name).join(', '));

  const invalidSamples = await pool.query(
    `SELECT *, LEFT(payload::text, 300) as payload_preview
     FROM webhook_events
     WHERE status = 'invalid_payload'
     ORDER BY created_at DESC LIMIT 3`
  );
  console.log('\n=== INVALID PAYLOAD WEBHOOK SAMPLES ===');
  for (const row of invalidSamples.rows) {
    console.log('---');
    console.log('at:', row.created_at, 'status:', row.status);
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

  // 3. What happens between signal creation and enrichment?
  // Check recent signals that were NOT market_data_unavailable but still rejected
  const otherRejects = await pool.query(
    `SELECT signal_id, symbol, direction, rejection_reason, created_at
     FROM signals
     WHERE rejection_reason IS NOT NULL
       AND rejection_reason != 'market_data_unavailable'
       AND created_at >= NOW() - INTERVAL '3 days'
     ORDER BY created_at DESC LIMIT 10`
  );
  console.log('\n=== NON-MARKET-DATA REJECTIONS (last 3d) ===');
  console.table(otherRejects.rows);

  // 4. How many signals get through during market hours vs off hours?
  const hourlySuccess = await pool.query(
    `SELECT EXTRACT(HOUR FROM created_at) as utc_hour,
            COUNT(*)::int FILTER (WHERE status = 'approved') as approved,
            COUNT(*)::int FILTER (WHERE rejection_reason = 'market_data_unavailable') as md_unavail,
            COUNT(*)::int as total
     FROM signals
     WHERE created_at >= NOW() - INTERVAL '3 days'
     GROUP BY 1 ORDER BY 1`
  );
  console.log('\n=== SIGNALS BY UTC HOUR (last 3d) ===');
  console.table(hourlySuccess.rows);

  await pool.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
