import { db } from '../src/services/database.service.js';

async function main() {
  // Check GEX data in the latest signal that has it
  const { rows } = await db.query(`
    SELECT signal_id, 
           enriched_data->'gex' as gex,
           enriched_data->'optionsFlow' as flow,
           enriched_data->'confluence' as confluence,
           enriched_data->>'currentPrice' as price
    FROM refactored_signals
    WHERE enriched_data->'gex' IS NOT NULL
    ORDER BY refactored_signal_id DESC
    LIMIT 3
  `);

  for (const r of rows) {
    console.log(`\n=== Signal ${r.signal_id?.slice(0, 8)} (price: ${r.price}) ===`);
    const gex = r.gex;
    if (gex) {
      console.log('GEX source:', gex.source || 'unknown');
      console.log('GEX netGex:', gex.netGex);
      console.log('GEX maxPain:', gex.maxPain);
      console.log('GEX totalCallGex:', gex.totalCallGex);
      console.log('GEX totalPutGex:', gex.totalPutGex);
      console.log('GEX last updated:', gex.lastUpdated || gex.updatedAt);
    }
    const flow = r.flow;
    if (flow) {
      console.log('Flow debug:', flow.flowDebug);
      console.log('Flow entries:', flow.entries?.length ?? 0);
      if (flow.summary) {
        console.log('Flow summary:', JSON.stringify(flow.summary).slice(0, 200));
      }
    } else {
      console.log('Flow: NONE');
    }
    if (r.confluence) {
      console.log('Confluence:', JSON.stringify(r.confluence).slice(0, 200));
    }
  }

  // Also check the signals that previously processed successfully
  console.log('\n=== Successfully Processed Test Signals ===');
  const ids = ['96ccacd9-dcae-4bfe-9090-7368c242c4f4', 'd9424f7d-479a-42a7-b911-ce04677d6eee'];
  for (const id of ids) {
    const { rows: rs } = await db.query(`
      SELECT enriched_data->'gex' as gex, enriched_data->'optionsFlow'->>'flowDebug' as flow_src
      FROM refactored_signals WHERE signal_id = $1
    `, [id]);
    if (rs[0]) {
      const gex = rs[0].gex;
      console.log(`${id.slice(0,8)}: gex_source=${gex?.source || 'none'}, netGex=${gex?.netGex || 'N/A'}, flow_src=${rs[0].flow_src || 'none'}`);
    }
  }

  // Check recent options_flow_snapshots for UW data
  console.log('\n=== Recent Flow Snapshots ===');
  const { rows: snapshots } = await db.query(`
    SELECT symbol, source, entries_count, created_at
    FROM options_flow_snapshots
    ORDER BY created_at DESC
    LIMIT 5
  `);
  if (snapshots.length === 0) {
    console.log('  No flow snapshots found');
  } else {
    for (const s of snapshots) {
      console.log(`  ${s.symbol} | source: ${s.source} | entries: ${s.entries_count} | ${s.created_at}`);
    }
  }

  // Check GEX snapshots
  console.log('\n=== Recent GEX Snapshots ===');
  const { rows: gexSnaps } = await db.query(`
    SELECT symbol, source, net_gex, max_pain, created_at
    FROM gex_snapshots
    ORDER BY created_at DESC
    LIMIT 5
  `);
  if (gexSnaps.length === 0) {
    console.log('  No GEX snapshots found');
  } else {
    for (const g of gexSnaps) {
      console.log(`  ${g.symbol} | source: ${g.source} | net_gex: ${g.net_gex} | max_pain: ${g.max_pain} | ${g.created_at}`);
    }
  }

  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
