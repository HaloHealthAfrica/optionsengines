#!/usr/bin/env npx tsx
/**
 * E2E Test: Webhook → Decision Engine → Strike Selection
 *
 * Runs the full pipeline locally (no HTTP server required for webhook injection):
 * 1. Inserts a test signal via processWebhookPayload (same path as POST /webhook)
 * 2. Runs orchestrator (enrichment → entry decision → strike selection → engine)
 * 3. Runs order creator
 * 4. Reports decision outcome and strike selection
 *
 * Usage:
 *   npx tsx scripts/run-e2e-webhook-to-strike.ts [--url=localhost:8080]
 *
 * With --url: Sends webhook via HTTP to running server, then runs pipeline.
 * Without --url: Injects signal directly into DB, runs pipeline (no server needed).
 *
 * Env: DATABASE_URL (required)
 */

import 'dotenv/config';
import crypto from 'crypto';
import { db } from '../src/services/database.service.js';
import { processWebhookPayload } from '../src/routes/webhook.js';
import { createOrchestratorService } from '../src/orchestrator/container.js';
import { createEngineAInvoker, createEngineBInvoker } from '../src/orchestrator/engine-invokers.js';
import { OrderCreatorWorker } from '../src/workers/order-creator.js';
import { config } from '../src/config/index.js';

const BACKEND_URL =
  process.argv.find((a) => a.startsWith('--url='))?.slice(6) || process.env.BACKEND_URL || '';

async function injectSignalViaWebhook(): Promise<string> {
  const payload = {
    symbol: 'SPY',
    direction: 'long' as const,
    timeframe: '5m',
    timestamp: new Date().toISOString(),
    is_test: true,
    metadata: { is_test: true, test_scenario: 'e2e-webhook-to-strike', run_id: Date.now() },
    confidence: 75,
    price: 580,
  };

  if (BACKEND_URL) {
    const url = BACKEND_URL.startsWith('http') ? BACKEND_URL : `http://${BACKEND_URL}`;
    const res = await fetch(`${url}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { signal_id?: string; status?: string };
    if (!data.signal_id || data.status !== 'ACCEPTED') {
      throw new Error(`Webhook failed: ${data.status ?? res.status} - ${JSON.stringify(data)}`);
    }
    return data.signal_id;
  }

  const result = await processWebhookPayload({
    payload,
    requestId: crypto.randomUUID(),
  });

  if (result.status !== 'ACCEPTED') {
    throw new Error(`Webhook injection failed: ${result.status} - ${JSON.stringify(result.response)}`);
  }

  const signalId = result.response.signal_id as string;
  if (!signalId) throw new Error('No signal_id in response');
  return signalId;
}

async function run(): Promise<void> {
  console.log('═'.repeat(70));
  console.log('  E2E: Webhook → Decision Engine → Strike Selection');
  console.log('═'.repeat(70));
  console.log(`  Mode: ${BACKEND_URL ? `HTTP → ${BACKEND_URL}` : 'Direct DB injection'}`);
  console.log('═'.repeat(70));
  console.log('');

  let signalId: string;

  try {
    console.log('1. Injecting test webhook...');
    signalId = await injectSignalViaWebhook();
    console.log(`   ✅ Signal ID: ${signalId}\n`);
  } catch (err) {
    console.error('   ❌ Webhook injection failed:', (err as Error).message);
    process.exit(1);
  }

  const orchestrator = createOrchestratorService({
    engineA: createEngineAInvoker(),
    engineB: createEngineBInvoker(),
  });

  try {
    console.log('2. Running orchestrator (enrichment → entry decision → strike selection)...');
    const results = await orchestrator.processSignals(5, [signalId], {
      concurrency: 1,
      timeoutMs: config.orchestratorSignalTimeoutMs ?? 60000,
      retryDelayMs: 5000,
    });
    const result = results.find((r) => r.signal_id === signalId) ?? results[0];
    if (!result) {
      console.log('   ⚠️ No result returned from orchestrator');
    } else {
      console.log(`   Processed: ${results.length} signal(s)`);
      console.log(`   Success: ${result.success}`);
      if (result.error) console.log(`   Error: ${result.error}`);
      if (result.market_context) {
        console.log(`   Market context: price=${result.market_context.current_price}`);
      }
      if (result.experiment) {
        console.log(`   Variant: ${result.experiment.variant}`);
      }
    }
    console.log('');
  } catch (err) {
    console.error('   ❌ Orchestrator failed:', err);
    process.exit(1);
  }

  try {
    console.log('3. Running order creator...');
    const orderCreator = new OrderCreatorWorker();
    await orderCreator.run();
    console.log('   Done\n');
  } catch (err) {
    console.error('   ❌ Order creator failed:', err);
    process.exit(1);
  }

  try {
    console.log('4. Checking orders and strike selection...');
    const { rows } = await db.query(
      `SELECT o.order_id, o.symbol, o.strike, o.expiration, o.type, o.quantity, o.status, o.engine
       FROM orders o
       WHERE o.signal_id = $1
       ORDER BY o.created_at DESC
       LIMIT 5`,
      [signalId]
    );

    if (rows.length === 0) {
      console.log('   No orders created for this signal.');
      console.log('   Possible reasons: signal rejected by entry engine, risk gates, or market closed.');
      const { rows: rej } = await db.query(
        `SELECT rejection_reason FROM refactored_signals WHERE signal_id = $1`,
        [signalId]
      );
      if (rej[0]?.rejection_reason) {
        console.log(`   Rejection: ${rej[0].rejection_reason}`);
      }
      const { rows: sig } = await db.query(
        `SELECT status FROM signals WHERE signal_id = $1`,
        [signalId]
      );
      if (sig[0]) console.log(`   Signal status: ${sig[0].status}`);
    } else {
      for (const o of rows) {
        console.log(`   ✅ Order: ${o.symbol} ${o.type} strike=${o.strike} exp=${o.expiration} qty=${o.quantity} status=${o.status} engine=${o.engine}`);
      }
    }
    console.log('');
  } catch (err) {
    console.error('   ❌ Query failed:', err);
  }

  console.log('═'.repeat(70));
  console.log('  E2E complete');
  console.log('═'.repeat(70));
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
