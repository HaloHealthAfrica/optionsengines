const pg = require('pg');
const { config } = require('../dist/config/index.js');
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });

async function run() {
  // 1. Signal status breakdown
  const signals = await pool.query(
    `SELECT status, COUNT(*)::int as cnt,
            SUM(CASE WHEN processing_lock THEN 1 ELSE 0 END)::int as locked,
            MAX(timestamp) as latest
     FROM signals
     GROUP BY status ORDER BY cnt DESC`
  );
  console.log('=== SIGNAL STATUS ===');
  console.table(signals.rows);

  // 2. Rejection reasons for rejected signals
  const rejections = await pool.query(
    `SELECT rejection_reason, COUNT(*)::int as cnt, MAX(timestamp) as latest
     FROM signals WHERE status = 'rejected'
     GROUP BY rejection_reason ORDER BY cnt DESC`
  );
  console.log('=== REJECTION REASONS ===');
  console.table(rejections.rows);

  // 3. Recent signals (last 24h) with their status
  const recent = await pool.query(
    `SELECT signal_id, symbol, status, rejection_reason, processing_lock,
            processing_attempts, timestamp, next_retry_at
     FROM signals
     WHERE timestamp >= NOW() - INTERVAL '24 hours'
     ORDER BY timestamp DESC
     LIMIT 15`
  );
  console.log('=== RECENT SIGNALS (24h) ===');
  console.table(recent.rows);

  // 4. Pending signals detail
  const pending = await pool.query(
    `SELECT signal_id, symbol, status, processing_lock, locked_by,
            processing_attempts, queued_until, next_retry_at, timestamp
     FROM signals
     WHERE status = 'pending' OR status IS NULL
     ORDER BY timestamp DESC
     LIMIT 10`
  );
  console.log('=== PENDING SIGNALS ===');
  console.table(pending.rows);

  // 5. Decision/recommendation records
  const decisions = await pool.query(
    `SELECT COUNT(*)::int as total,
            MAX(created_at) as latest
     FROM decision_recommendations`
  );
  console.log('=== DECISION RECOMMENDATIONS ===');
  console.table(decisions.rows);

  // 6. Orders status
  const orders = await pool.query(
    `SELECT status, COUNT(*)::int as cnt, MAX(created_at) as latest
     FROM orders
     GROUP BY status ORDER BY cnt DESC`
  );
  console.log('=== ORDERS ===');
  console.table(orders.rows);

  // 7. Experiments
  const experiments = await pool.query(
    `SELECT COUNT(*)::int as total, MAX(created_at) as latest
     FROM experiments`
  );
  console.log('=== EXPERIMENTS ===');
  console.table(experiments.rows);

  // 8. Recent webhook events
  const webhooks = await pool.query(
    `SELECT status, COUNT(*)::int as cnt, MAX(created_at) as latest
     FROM webhook_events
     WHERE created_at >= NOW() - INTERVAL '24 hours'
     GROUP BY status ORDER BY cnt DESC`
  );
  console.log('=== WEBHOOKS (24h) ===');
  console.table(webhooks.rows);

  // 9. Config check
  console.log('\n=== ACTIVE CONFIG ===');
  console.log('MARKET_DATA_PROVIDER:', config.marketDataProvider);
  console.log('MARKET_DATA_PROVIDER_PRIORITY:', config.marketDataProviderPriority);
  console.log('ENABLE_ORCHESTRATOR:', config.enableOrchestrator);
  console.log('ORCHESTRATOR_INTERVAL_MS:', config.orchestratorIntervalMs);
  console.log('ORCHESTRATOR_BATCH_SIZE:', config.orchestratorBatchSize);
  console.log('TWELVE_DATA_API_KEY set:', !!config.twelveDataApiKey);
  console.log('MARKET_DATA_API_KEY set:', !!config.marketDataApiKey);
  console.log('DECISION_ONLY_WHEN_MARKET_CLOSED:', config.decisionOnlyWhenMarketClosed);
  console.log('E2E_TEST_MODE:', config.e2eTestMode);

  // 10. Are there any approved signals that never got orders?
  const approvedNoOrders = await pool.query(
    `SELECT s.signal_id, s.symbol, s.status, s.timestamp, s.experiment_id
     FROM signals s
     LEFT JOIN orders o ON o.signal_id = s.signal_id
     WHERE s.status = 'approved' AND o.order_id IS NULL
     LIMIT 5`
  );
  console.log('=== APPROVED BUT NO ORDERS ===');
  console.table(approvedNoOrders.rows);

  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
