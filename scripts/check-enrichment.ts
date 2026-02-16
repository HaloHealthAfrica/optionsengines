import { db } from '../src/services/database.service.js';

async function main() {
  // Check test signals
  const signalIds = [
    '96ccacd9-dcae-4bfe-9090-7368c242c4f4',
    'd9424f7d-479a-42a7-b911-ce04677d6eee',
  ];

  console.log('=== Test Signal Status ===');
  for (const id of signalIds) {
    const { rows } = await db.query(
      `SELECT signal_id, status, processed, rejection_reason, locked_by, locked_at FROM signals WHERE signal_id = $1`,
      [id]
    );
    if (rows[0]) {
      const s = rows[0];
      console.log(
        `${id.slice(0, 8)} | status: ${s.status} | processed: ${s.processed} | reason: ${s.rejection_reason || 'none'} | locked: ${s.locked_by || 'cleared'}`
      );
    }
  }

  // Check recent enriched signals for UW data sources
  console.log('\n=== Recent Enriched Signals (last 10) ===');
  const { rows: recent } = await db.query(`
    SELECT rs.signal_id, 
           rs.enriched_data->'optionsFlow' IS NOT NULL AS has_flow,
           rs.enriched_data->'gex'->>'source' AS gex_source,
           rs.enriched_data->'optionsFlow'->>'flowDebug' AS flow_source,
           rs.enriched_data->>'currentPrice' AS price,
           rs.rejection_reason,
           rs.refactored_signal_id
    FROM refactored_signals rs
    WHERE rs.enriched_data IS NOT NULL 
    ORDER BY rs.refactored_signal_id DESC 
    LIMIT 10
  `);

  for (const r of recent) {
    console.log(
      `${(r.signal_id || '').slice(0, 8)} | price: ${r.price || 'N/A'} | flow: ${r.has_flow ? (r.flow_source || 'yes') : 'NONE'} | gex: ${r.gex_source || 'NONE'} | reject: ${r.rejection_reason || 'none'}`
    );
  }

  // Check if UW data exists in any recent enriched signals
  console.log('\n=== UW Data Presence Check ===');
  const { rows: uwCheck } = await db.query(`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE rs.enriched_data->'optionsFlow'->>'flowDebug' LIKE '%unusualwhales%') AS uw_flow,
           COUNT(*) FILTER (WHERE rs.enriched_data->'gex'->>'source' = 'unusualwhales') AS uw_gex,
           COUNT(*) FILTER (WHERE rs.enriched_data->'optionsFlow'->>'flowDebug' LIKE '%not_configured%') AS uw_not_configured
    FROM refactored_signals rs
    WHERE rs.enriched_data IS NOT NULL
  `);
  if (uwCheck[0]) {
    console.log(`  Total enriched: ${uwCheck[0].total}`);
    console.log(`  UW as flow source: ${uwCheck[0].uw_flow}`);
    console.log(`  UW as GEX source: ${uwCheck[0].uw_gex}`);
    console.log(`  UW not configured: ${uwCheck[0].uw_not_configured}`);
  }

  // Check orders and positions created from test signals
  console.log('\n=== Orders from Test Signals ===');
  const { rows: orders } = await db.query(`
    SELECT order_id, symbol, strike, status, engine, is_test, created_at
    FROM orders
    WHERE signal_id IN ($1, $2)
    ORDER BY created_at DESC
  `, [signalIds[0], signalIds[1]]);
  if (orders.length === 0) {
    console.log('  No orders created (likely stuck in orchestrator)');
  } else {
    for (const o of orders) {
      console.log(`  ${o.order_id?.slice(0, 8)} | ${o.symbol} ${o.strike} | status: ${o.status} | engine: ${o.engine} | test: ${o.is_test}`);
    }
  }

  // Check decision recommendations
  console.log('\n=== Decision Recommendations ===');
  const { rows: recs } = await db.query(`
    SELECT engine, symbol, strike, entry_price, quantity, is_shadow,
           rationale->'entry_metadata' IS NOT NULL AS has_metadata
    FROM decision_recommendations
    WHERE signal_id IN ($1, $2)
    ORDER BY created_at DESC
  `, [signalIds[0], signalIds[1]]);
  if (recs.length === 0) {
    console.log('  No recommendations yet');
  } else {
    for (const r of recs) {
      console.log(`  ${r.engine} | ${r.symbol} ${r.strike} @ ${r.entry_price} x${r.quantity} | shadow: ${r.is_shadow} | metadata: ${r.has_metadata}`);
    }
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
