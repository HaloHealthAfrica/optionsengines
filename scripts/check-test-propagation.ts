import { db } from '../src/services/database.service.js';

async function main() {
  const signalId = '96ccacd9-dcae-4bfe-9090-7368c242c4f4';

  console.log('=== is_test Propagation Check ===');
  const { rows: sig } = await db.query(
    `SELECT signal_id, is_test, status FROM signals WHERE signal_id = $1`, [signalId]
  );
  console.log('Signal is_test:', sig[0]?.is_test);

  const { rows: ord } = await db.query(
    `SELECT order_id, is_test, signal_id FROM orders WHERE signal_id = $1`, [signalId]
  );
  console.log('Order is_test:', ord[0]?.is_test, '| order_id:', ord[0]?.order_id);

  if (ord[0]?.order_id) {
    const { rows: tr } = await db.query(
      `SELECT trade_id, is_test FROM trades WHERE order_id = $1`, [ord[0].order_id]
    );
    console.log('Trade is_test:', tr[0]?.is_test);
  }

  console.log('\n=== Flow Enrichment Detail ===');
  const { rows: rs } = await db.query(
    `SELECT enriched_data->'optionsFlow' as flow, enriched_data->'gex' as gex FROM refactored_signals WHERE signal_id = $1`,
    [signalId]
  );
  const flow = rs[0]?.flow;
  const gex = rs[0]?.gex;
  console.log('Flow debug:', flow?.flowDebug || 'not set');
  console.log('Flow entries:', flow?.entries?.length ?? 0);
  console.log('Flow summary:', flow?.summary ? JSON.stringify(flow.summary).slice(0, 200) : 'none');
  console.log('GEX:', gex ? JSON.stringify(gex).slice(0, 200) : 'NONE');

  console.log('\n=== Recommendation Rationale (entry_metadata) ===');
  const { rows: recs } = await db.query(
    `SELECT rationale FROM decision_recommendations WHERE signal_id = $1 LIMIT 1`,
    [signalId]
  );
  if (recs[0]?.rationale) {
    const rat = typeof recs[0].rationale === 'string' ? JSON.parse(recs[0].rationale) : recs[0].rationale;
    if (rat.entry_metadata) {
      console.log('entry_metadata:', JSON.stringify(rat.entry_metadata, null, 2));
    } else {
      console.log('No entry_metadata in rationale');
    }
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
