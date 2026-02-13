/**
 * Trace accepted webhooks through the pipeline to find where they drop off.
 * Usage: npx tsx scripts/trace-webhooks.ts <id1> [id2] ...
 * IDs can be signal_id or request_id (from webhook response).
 */

import { db } from '../src/services/database.service.js';

const IDS = process.argv.slice(2).filter(Boolean);
if (IDS.length === 0) {
  console.error('Usage: npx tsx scripts/trace-webhooks.ts <id1> [id2] ...');
  process.exit(1);
}

function formatRow(row: Record<string, unknown>): string {
  return Object.entries(row)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');
}

async function traceId(id: string) {
  console.log('\n' + '='.repeat(60));
  console.log(`TRACING: ${id}`);
  console.log('='.repeat(60));

  let signalId: string | null = null;
  let requestId: string | null = null;

  const webhookByRequest = await db.query(
    `SELECT event_id, request_id, signal_id, status, symbol, direction, timeframe, 
            error_message, processing_time_ms, created_at
     FROM webhook_events WHERE request_id = $1`,
    [id]
  );
  const webhookBySignal = await db.query(
    `SELECT event_id, request_id, signal_id, status, symbol, direction, timeframe, 
            error_message, processing_time_ms, created_at
     FROM webhook_events WHERE signal_id = $1`,
    [id]
  );

  if (webhookByRequest.rows.length > 0) {
    const w = webhookByRequest.rows[0];
    console.log('\n📥 1. WEBHOOK EVENTS (by request_id):');
    console.log(formatRow(w as Record<string, unknown>));
    signalId = w.signal_id;
    requestId = w.request_id;
  }
  if (webhookBySignal.rows.length > 0 && !signalId) {
    const w = webhookBySignal.rows[0];
    console.log('\n📥 1. WEBHOOK EVENTS (by signal_id):');
    console.log(formatRow(w as Record<string, unknown>));
    signalId = w.signal_id ?? id;
    requestId = w.request_id;
  }

  const webhookByEvent = await db.query(
    `SELECT event_id, request_id, signal_id, status, symbol, direction, timeframe, 
            error_message, processing_time_ms, created_at
     FROM webhook_events WHERE event_id = $1`,
    [id]
  );
  if (webhookByEvent.rows.length > 0 && !signalId) {
    const w = webhookByEvent.rows[0];
    console.log('\n📥 1. WEBHOOK EVENTS (by event_id):');
    console.log(formatRow(w as Record<string, unknown>));
    signalId = w.signal_id;
    requestId = w.request_id;
  }

  if (!signalId) {
    const signalDirect = await db.query(
      `SELECT signal_id, symbol, direction, timeframe, status, rejection_reason, 
              processed, created_at, queued_until, queue_reason, processing_attempts, next_retry_at
       FROM signals WHERE signal_id = $1`,
      [id]
    );
    if (signalDirect.rows.length > 0) {
      signalId = id;
      console.log('\n📥 1. WEBHOOK EVENTS: Not found (ID is signal_id)');
    }
  }

  if (!signalId) {
    console.log('\n❌ ID not found in webhook_events or signals.');
    console.log('   Checked: request_id, signal_id, event_id');
    console.log('   Note: If these are from production, ensure you are connected to that database.');
    return;
  }

  const sigId = signalId;

  const signal = await db.query(
    `SELECT signal_id, symbol, direction, timeframe, status, rejection_reason, 
            processed, experiment_id, created_at, queued_until, queue_reason, 
            processing_attempts, next_retry_at
     FROM signals WHERE signal_id = $1`,
    [sigId]
  );

  if (signal.rows.length === 0) {
    console.log('\n❌ 2. SIGNALS: Not found (signal_id may have been deleted)');
    return;
  }

  const s = signal.rows[0];
  console.log('\n📋 2. SIGNALS:');
  console.log(formatRow(s as Record<string, unknown>));
  if (s.status !== 'approved' && s.rejection_reason) {
    console.log(`\n   ⚠️  DROP-OFF: Signal rejected - ${s.rejection_reason}`);
  }
  if (s.queued_until) {
    console.log(`\n   ⏳ QUEUED until ${s.queued_until} (reason: ${s.queue_reason ?? 'unknown'})`);
  }

  const experiment = await db.query(
    `SELECT experiment_id, signal_id, variant, assignment_hash, created_at
     FROM experiments WHERE signal_id = $1`,
    [sigId]
  );
  console.log('\n🧪 3. EXPERIMENTS:');
  if (experiment.rows.length === 0) {
    console.log('   None (signal not yet assigned to experiment)');
    console.log('   ⚠️  DROP-OFF: Orchestrator has not processed this signal yet');
  } else {
    console.log(formatRow(experiment.rows[0] as Record<string, unknown>));
  }

  const refactored = await db.query(
    `SELECT refactored_signal_id, signal_id, enriched_data IS NOT NULL AS has_enrichment,
            risk_check_result, rejection_reason, processed_at
     FROM refactored_signals WHERE signal_id = $1`,
    [sigId]
  );
  console.log('\n📊 4. REFACTORED_SIGNALS (enrichment):');
  if (refactored.rows.length === 0) {
    console.log('   None');
    if (s.status === 'pending' && !s.queued_until) {
      console.log('   ⚠️  DROP-OFF: Enrichment not run (orchestrator may not have picked it up)');
    }
  } else {
    const r = refactored.rows[0];
    console.log(formatRow(r as Record<string, unknown>));
    if (r.rejection_reason) {
      console.log(`   ⚠️  DROP-OFF: Enrichment rejected - ${r.rejection_reason}`);
    }
  }

  const recommendations = await db.query(
    `SELECT recommendation_id, signal_id, engine, strike, expiration, quantity, 
            entry_price, is_shadow, rationale, created_at
     FROM decision_recommendations WHERE signal_id = $1`,
    [sigId]
  );
  console.log('\n🎯 5. DECISION_RECOMMENDATIONS:');
  if (recommendations.rows.length === 0) {
    console.log('   None');
    if (s.status === 'approved') {
      console.log('   ⚠️  DROP-OFF: Engines did not produce recommendations');
    }
  } else {
    recommendations.rows.forEach((row, i) => {
      console.log(`   --- Engine ${row.engine} ---`);
      console.log(formatRow(row as Record<string, unknown>));
    });
  }

  const orders = await db.query(
    `SELECT order_id, signal_id, symbol, option_symbol, strike, expiration, type, 
            quantity, status, order_type, engine, created_at
     FROM orders WHERE signal_id = $1`,
    [sigId]
  );
  console.log('\n📦 6. ORDERS:');
  if (orders.rows.length === 0) {
    console.log('   None');
    if (s.status === 'approved' && recommendations.rows.length > 0) {
      console.log('   ⚠️  DROP-OFF: Orders not created (check orchestrator createPaperOrders)');
    }
  } else {
    orders.rows.forEach((row, i) => {
      console.log(`   --- Order ${i + 1} ---`);
      console.log(formatRow(row as Record<string, unknown>));
    });
  }

  const trades = await db.query(
    `SELECT t.trade_id, t.order_id, t.fill_price, t.fill_quantity, t.fill_timestamp,
            o.signal_id
     FROM trades t
     JOIN orders o ON o.order_id = t.order_id
     WHERE o.signal_id = $1`,
    [sigId]
  );
  console.log('\n💰 7. TRADES (fills):');
  if (trades.rows.length === 0) {
    console.log('   None');
    if (orders.rows.length > 0 && orders.rows.some((o: any) => o.status === 'pending_execution')) {
      console.log('   ⚠️  DROP-OFF: Paper executor has not filled orders yet');
    }
  } else {
    trades.rows.forEach((row) => console.log(formatRow(row as Record<string, unknown>)));
  }

  const positions = await db.query(
    `SELECT position_id, symbol, option_symbol, strike, expiration, type, quantity,
            entry_price, status, entry_timestamp, exit_timestamp
     FROM refactored_positions 
     WHERE option_symbol IN (
       SELECT option_symbol FROM orders WHERE signal_id = $1
     )`,
    [sigId]
  );
  console.log('\n📈 8. REFACTORED_POSITIONS:');
  if (positions.rows.length === 0) {
    console.log('   None (or trades not yet filled)');
  } else {
    positions.rows.forEach((row) => console.log(formatRow(row as Record<string, unknown>)));
  }

  console.log('\n' + '-'.repeat(60));
}

async function main() {
  console.log('Webhook Pipeline Trace');
  console.log('IDs to trace:', IDS.join(', '));

  for (const id of IDS) {
    try {
      await traceId(id);
    } catch (err) {
      console.error(`\nError tracing ${id}:`, err);
    }
  }

  const found = await Promise.all(IDS.map(async (id) => {
    const r = await db.query(
      'SELECT 1 FROM webhook_events WHERE request_id = $1 OR signal_id = $1 OR event_id = $1 LIMIT 1',
      [id]
    );
    return r.rows.length > 0;
  }));
  const someFound = found.some(Boolean);

  if (!someFound) {
    console.log('\n' + '='.repeat(60));
    console.log('SAMPLE: Recent webhook_events (accepted) in this database');
    console.log('='.repeat(60));
    const sample = await db.query(
      `SELECT event_id, request_id, signal_id, status, symbol, created_at
       FROM webhook_events
       WHERE status = 'accepted'
       ORDER BY created_at DESC
       LIMIT 5`
    );
    if (sample.rows.length === 0) {
      console.log('No accepted webhooks found in webhook_events.');
    } else {
      sample.rows.forEach((r) => console.log(formatRow(r as Record<string, unknown>)));
      console.log('\nUse request_id or signal_id from above to trace.');
    }
  }
  process.exit(0);
}

main();
