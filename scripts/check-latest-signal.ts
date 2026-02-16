import { db } from '../src/services/database.service.js';

async function main() {
  const signalId = '6db7f5b2-c26c-4299-b1a5-d9e1651d1e1a';

  const { rows: sig } = await db.query(
    `SELECT signal_id, status, processed, rejection_reason, locked_by, locked_at, is_test FROM signals WHERE signal_id = $1`,
    [signalId]
  );
  if (sig[0]) {
    const s = sig[0];
    console.log(`Signal: status=${s.status} processed=${s.processed} reason=${s.rejection_reason || 'none'} is_test=${s.is_test} locked=${s.locked_by || 'cleared'}`);
  } else {
    console.log('Signal not found');
  }

  // Check all 3 test signals
  const { rows: allTest } = await db.query(`
    SELECT signal_id, status, processed, rejection_reason, locked_by
    FROM signals 
    WHERE is_test = true 
    ORDER BY timestamp DESC 
    LIMIT 5
  `);
  console.log(`\nAll recent is_test signals (${allTest.length}):`);
  for (const s of allTest) {
    console.log(`  ${s.signal_id.slice(0, 8)} | ${s.status} | processed: ${s.processed} | ${s.rejection_reason || 'ok'} | lock: ${s.locked_by || 'cleared'}`);
  }

  // Check enrichment for this signal
  const { rows: rs } = await db.query(
    `SELECT enriched_data->'optionsFlow'->>'flowDebug' as flow_src,
            enriched_data->>'currentPrice' as price,
            enriched_data->'gex' IS NOT NULL as has_gex,
            risk_check_result
     FROM refactored_signals WHERE signal_id = $1`,
    [signalId]
  );
  if (rs[0]) {
    console.log(`\nEnrichment: price=${rs[0].price} flow_src=${rs[0].flow_src} has_gex=${rs[0].has_gex}`);
    console.log('Risk:', JSON.stringify(rs[0].risk_check_result));
  } else {
    console.log('\nNo enrichment record yet');
  }

  // Check orders
  const { rows: orders } = await db.query(
    `SELECT order_id, status, is_test, engine FROM orders WHERE signal_id = $1`, [signalId]
  );
  if (orders.length > 0) {
    console.log(`\nOrder: ${orders[0].order_id.slice(0,8)} status=${orders[0].status} is_test=${orders[0].is_test} engine=${orders[0].engine}`);
  } else {
    console.log('\nNo order created yet');
  }

  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
