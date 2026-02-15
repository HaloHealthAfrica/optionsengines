#!/usr/bin/env npx tsx
/**
 * E2E Trace Test — Webhook to Trade
 *
 * Sends a test webhook and traces it through every layer of the pipeline:
 *   Layer 1: Webhook Ingestion (HTTP response)
 *   Layer 2: Signal Storage (signals table)
 *   Layer 3: Webhook Event Logging (webhook_events table)
 *   Layer 4: Orchestrator Processing (signal status update)
 *   Layer 5: Experiment Assignment (experiments table)
 *   Layer 6: Policy Resolution (execution_policies table)
 *   Layer 7: Engine Decision (decision_recommendations table)
 *   Layer 8: Order Creation (orders table)
 *   Layer 9: Trade Execution (trades table)
 *   Layer 10: Position Creation (refactored_positions table)
 *
 * Usage:
 *   npx tsx scripts/e2e-trace-test.ts
 */

import pg from 'pg';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000/webhook';
const DATABASE_URL = process.env.DATABASE_URL!;
const HMAC_SECRET = process.env.HMAC_SECRET || '';
const MAX_WAIT_SECONDS = 120;
const POLL_INTERVAL_MS = 3000;

interface LayerResult {
  layer: string;
  status: 'PASS' | 'FAIL' | 'SKIP' | 'TIMEOUT' | 'PARTIAL';
  data: Record<string, unknown>;
  duration_ms: number;
  gap_notes: string[];
}

const results: LayerResult[] = [];
let testSignalId: string | null = null;
let testSessionId: string;

// Generate unique test session
testSessionId = `e2e-trace-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${msg}`);
}

function separator(title: string) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(70)}`);
}

async function createPool(): Promise<pg.Pool> {
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
  });
  await pool.query('SELECT 1');
  return pool;
}

// ─────────────────────────────────────────────
// LAYER 1: Send Webhook
// ─────────────────────────────────────────────
async function testLayer1_WebhookIngestion(): Promise<LayerResult> {
  const start = Date.now();
  const gaps: string[] = [];

  const payload = {
    symbol: 'SPY',
    direction: 'long',
    timeframe: '5m',
    timestamp: new Date().toISOString(),
    price: 595.42,
    confidence: 75,
    pattern_strength: 80,
    mtf_alignment: 70,
    indicators: {
      ema8: 595.10,
      ema21: 594.80,
      atr: 1.25,
    },
    is_test: true,
    test_session_id: testSessionId,
    test_scenario: 'e2e_webhook_to_trade',
  };

  log(`Sending webhook to ${WEBHOOK_URL}`);
  log(`Test session: ${testSessionId}`);
  log(`Payload: ${JSON.stringify(payload, null, 2)}`);

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  // Add HMAC if configured
  if (HMAC_SECRET && HMAC_SECRET.length > 10) {
    const sig = crypto.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
    headers['x-webhook-signature'] = sig;
    log('HMAC signature attached');
  } else {
    gaps.push('GAP: No HMAC_SECRET configured — webhook signature verification skipped');
  }

  try {
    const resp = await fetch(WEBHOOK_URL, { method: 'POST', headers, body });
    const data = await resp.json() as Record<string, unknown>;

    log(`Response: ${resp.status} ${resp.statusText}`);
    log(`Body: ${JSON.stringify(data, null, 2)}`);

    if (resp.ok && data.status === 'ACCEPTED') {
      testSignalId = data.signal_id as string;
      return { layer: 'Layer 1: Webhook Ingestion', status: 'PASS', data, duration_ms: Date.now() - start, gap_notes: gaps };
    } else if (data.status === 'DUPLICATE') {
      gaps.push('RESULT: Signal was deduplicated — same signal sent within 60s window');
      return { layer: 'Layer 1: Webhook Ingestion', status: 'PARTIAL', data, duration_ms: Date.now() - start, gap_notes: gaps };
    } else {
      gaps.push(`FAIL: HTTP ${resp.status} — ${JSON.stringify(data)}`);
      return { layer: 'Layer 1: Webhook Ingestion', status: 'FAIL', data, duration_ms: Date.now() - start, gap_notes: gaps };
    }
  } catch (err: any) {
    gaps.push(`FAIL: Request error — ${err.message}`);
    return { layer: 'Layer 1: Webhook Ingestion', status: 'FAIL', data: { error: err.message }, duration_ms: Date.now() - start, gap_notes: gaps };
  }
}

// ─────────────────────────────────────────────
// LAYER 2: Check Signal in DB
// ─────────────────────────────────────────────
async function testLayer2_SignalStorage(pool: pg.Pool): Promise<LayerResult> {
  const start = Date.now();
  const gaps: string[] = [];

  if (!testSignalId) {
    return { layer: 'Layer 2: Signal Storage', status: 'SKIP', data: { reason: 'No signal_id from Layer 1' }, duration_ms: 0, gap_notes: ['Skipped — no signal_id'] };
  }

  const { rows } = await pool.query(
    `SELECT signal_id, symbol, direction, timeframe, status, is_test, test_session_id,
            signal_hash, rejection_reason, processed, experiment_id, 
            processing_attempts, next_retry_at, queued_until, created_at
     FROM signals WHERE signal_id = $1`,
    [testSignalId]
  );

  if (rows.length === 0) {
    gaps.push('FAIL: Signal not found in DB after accepted webhook response');
    return { layer: 'Layer 2: Signal Storage', status: 'FAIL', data: {}, duration_ms: Date.now() - start, gap_notes: gaps };
  }

  const signal = rows[0];
  log(`Signal stored: status=${signal.status}, processed=${signal.processed}, is_test=${signal.is_test}`);

  if (!signal.signal_hash) gaps.push('GAP: signal_hash is null — dedup may not work');
  if (signal.status !== 'pending') gaps.push(`NOTE: Signal status is '${signal.status}' (expected 'pending' initially)`);

  return { layer: 'Layer 2: Signal Storage', status: 'PASS', data: signal, duration_ms: Date.now() - start, gap_notes: gaps };
}

// ─────────────────────────────────────────────
// LAYER 3: Check Webhook Event Logging
// ─────────────────────────────────────────────
async function testLayer3_WebhookEventLogging(pool: pg.Pool): Promise<LayerResult> {
  const start = Date.now();
  const gaps: string[] = [];

  if (!testSignalId) {
    return { layer: 'Layer 3: Webhook Event Logging', status: 'SKIP', data: {}, duration_ms: 0, gap_notes: ['Skipped'] };
  }

  const { rows } = await pool.query(
    `SELECT event_id, request_id, signal_id, status, processing_time_ms,
            is_test, test_session_id, error_message, variant, experiment_id
     FROM webhook_events WHERE signal_id = $1`,
    [testSignalId]
  );

  if (rows.length === 0) {
    gaps.push('GAP: No webhook_event row for this signal — audit trail missing');
    return { layer: 'Layer 3: Webhook Event Logging', status: 'FAIL', data: {}, duration_ms: Date.now() - start, gap_notes: gaps };
  }

  const evt = rows[0];
  log(`Webhook event: status=${evt.status}, processing_time=${evt.processing_time_ms}ms`);

  if (!evt.request_id) gaps.push('GAP: request_id is null — tracing broken');
  if (!evt.processing_time_ms) gaps.push('GAP: processing_time_ms not recorded');

  return { layer: 'Layer 3: Webhook Event Logging', status: 'PASS', data: evt, duration_ms: Date.now() - start, gap_notes: gaps };
}

// ─────────────────────────────────────────────
// LAYER 4-10: Wait for Orchestrator Processing
// ─────────────────────────────────────────────
async function waitForProcessing(pool: pg.Pool): Promise<void> {
  if (!testSignalId) return;

  log(`Waiting for orchestrator to process signal ${testSignalId}...`);
  const deadline = Date.now() + MAX_WAIT_SECONDS * 1000;

  while (Date.now() < deadline) {
    const { rows } = await pool.query(
      `SELECT status, processed, rejection_reason, experiment_id FROM signals WHERE signal_id = $1`,
      [testSignalId]
    );
    if (rows.length === 0) break;

    const s = rows[0];
    if (s.processed === true || s.status === 'approved' || s.status === 'rejected') {
      log(`Signal processed: status=${s.status}, processed=${s.processed}, rejection_reason=${s.rejection_reason || 'none'}`);
      return;
    }

    log(`  ... still pending (status=${s.status}, processed=${s.processed})`);
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  log('TIMEOUT: Signal was not processed within the wait window');
}

// ─────────────────────────────────────────────
// LAYER 4: Orchestrator Processing Result
// ─────────────────────────────────────────────
async function testLayer4_OrchestratorProcessing(pool: pg.Pool): Promise<LayerResult> {
  const start = Date.now();
  const gaps: string[] = [];

  if (!testSignalId) {
    return { layer: 'Layer 4: Orchestrator Processing', status: 'SKIP', data: {}, duration_ms: 0, gap_notes: ['Skipped'] };
  }

  const { rows } = await pool.query(
    `SELECT status, processed, rejection_reason, experiment_id, processing_attempts, 
            next_retry_at, queued_until, queue_reason, meta_gamma
     FROM signals WHERE signal_id = $1`,
    [testSignalId]
  );

  if (rows.length === 0) {
    return { layer: 'Layer 4: Orchestrator Processing', status: 'FAIL', data: {}, duration_ms: Date.now() - start, gap_notes: ['Signal missing'] };
  }

  const signal = rows[0];

  if (!signal.processed && signal.status === 'pending') {
    gaps.push('TIMEOUT: Orchestrator did not process this signal — check worker logs');
    return { layer: 'Layer 4: Orchestrator Processing', status: 'TIMEOUT', data: signal, duration_ms: Date.now() - start, gap_notes: gaps };
  }

  if (signal.status === 'rejected') {
    gaps.push(`REJECTED: ${signal.rejection_reason || 'unknown reason'}`);
    log(`Signal REJECTED: ${signal.rejection_reason}`);
  } else if (signal.status === 'approved') {
    log('Signal APPROVED by orchestrator');
  }

  if (signal.processing_attempts > 1) {
    gaps.push(`NOTE: Required ${signal.processing_attempts} processing attempts`);
  }

  return { layer: 'Layer 4: Orchestrator Processing', status: signal.status === 'approved' ? 'PASS' : 'PARTIAL', data: signal, duration_ms: Date.now() - start, gap_notes: gaps };
}

// ─────────────────────────────────────────────
// LAYER 5: Experiment Assignment
// ─────────────────────────────────────────────
async function testLayer5_ExperimentAssignment(pool: pg.Pool): Promise<LayerResult> {
  const start = Date.now();
  const gaps: string[] = [];

  if (!testSignalId) {
    return { layer: 'Layer 5: Experiment Assignment', status: 'SKIP', data: {}, duration_ms: 0, gap_notes: ['Skipped'] };
  }

  const { rows } = await pool.query(
    `SELECT experiment_id, variant, assignment_hash, split_percentage, policy_version
     FROM experiments WHERE signal_id = $1`,
    [testSignalId]
  );

  if (rows.length === 0) {
    gaps.push('GAP: No experiment created for this signal — orchestrator may have rejected before experiment stage');
    return { layer: 'Layer 5: Experiment Assignment', status: 'FAIL', data: {}, duration_ms: Date.now() - start, gap_notes: gaps };
  }

  const exp = rows[0];
  log(`Experiment: variant=${exp.variant}, split=${exp.split_percentage}%, policy=${exp.policy_version}`);

  if (!exp.assignment_hash) gaps.push('GAP: assignment_hash is null — deterministic routing broken');

  return { layer: 'Layer 5: Experiment Assignment', status: 'PASS', data: exp, duration_ms: Date.now() - start, gap_notes: gaps };
}

// ─────────────────────────────────────────────
// LAYER 6: Policy Resolution
// ─────────────────────────────────────────────
async function testLayer6_PolicyResolution(pool: pg.Pool): Promise<LayerResult> {
  const start = Date.now();
  const gaps: string[] = [];

  // Get experiment_id from signal
  const { rows: sigRows } = await pool.query(
    `SELECT experiment_id FROM signals WHERE signal_id = $1`, [testSignalId]
  );
  const experimentId = sigRows[0]?.experiment_id;

  if (!experimentId) {
    return { layer: 'Layer 6: Policy Resolution', status: 'SKIP', data: { reason: 'No experiment_id' }, duration_ms: 0, gap_notes: ['Skipped — no experiment'] };
  }

  const { rows } = await pool.query(
    `SELECT policy_id, execution_mode, executed_engine, shadow_engine, reason, policy_version
     FROM execution_policies WHERE experiment_id = $1`,
    [experimentId]
  );

  if (rows.length === 0) {
    gaps.push('GAP: No execution_policy created — policy engine may have failed');
    return { layer: 'Layer 6: Policy Resolution', status: 'FAIL', data: {}, duration_ms: Date.now() - start, gap_notes: gaps };
  }

  const policy = rows[0];
  log(`Policy: mode=${policy.execution_mode}, engine=${policy.executed_engine}, shadow=${policy.shadow_engine}`);

  if (policy.execution_mode === 'SHADOW_ONLY') {
    gaps.push('NOTE: Policy is SHADOW_ONLY — no real orders will be created');
  }

  return { layer: 'Layer 6: Policy Resolution', status: 'PASS', data: policy, duration_ms: Date.now() - start, gap_notes: gaps };
}

// ─────────────────────────────────────────────
// LAYER 7: Engine Decision (Recommendations)
// ─────────────────────────────────────────────
async function testLayer7_EngineDecision(pool: pg.Pool): Promise<LayerResult> {
  const start = Date.now();
  const gaps: string[] = [];

  const { rows: sigRows } = await pool.query(
    `SELECT experiment_id FROM signals WHERE signal_id = $1`, [testSignalId]
  );
  const experimentId = sigRows[0]?.experiment_id;

  if (!experimentId) {
    return { layer: 'Layer 7: Engine Decision', status: 'SKIP', data: {}, duration_ms: 0, gap_notes: ['Skipped — no experiment'] };
  }

  const { rows } = await pool.query(
    `SELECT experiment_id, engine, symbol, direction, strike, expiration, quantity, 
            entry_price, is_shadow, timeframe
     FROM decision_recommendations WHERE experiment_id = $1`,
    [experimentId]
  );

  if (rows.length === 0) {
    gaps.push('GAP: No decision_recommendation — engine returned null (HOLD)');

    // Check if signal was rejected and why
    const { rows: sigCheck } = await pool.query(
      `SELECT rejection_reason FROM signals WHERE signal_id = $1`, [testSignalId]
    );
    if (sigCheck[0]?.rejection_reason) {
      gaps.push(`  Rejection reason: ${sigCheck[0].rejection_reason}`);
    }

    return { layer: 'Layer 7: Engine Decision', status: 'FAIL', data: {}, duration_ms: Date.now() - start, gap_notes: gaps };
  }

  for (const rec of rows) {
    log(`Recommendation: engine=${rec.engine}, ${rec.symbol} ${rec.direction} strike=${rec.strike} exp=${rec.expiration} qty=${rec.quantity} entry=${rec.entry_price} shadow=${rec.is_shadow}`);

    if (!rec.strike) gaps.push(`GAP: Engine ${rec.engine} recommendation missing strike`);
    if (!rec.expiration) gaps.push(`GAP: Engine ${rec.engine} recommendation missing expiration`);
    if (!rec.entry_price) gaps.push(`GAP: Engine ${rec.engine} recommendation missing entry_price`);
    if (!rec.quantity || rec.quantity <= 0) gaps.push(`GAP: Engine ${rec.engine} invalid quantity: ${rec.quantity}`);
  }

  return { layer: 'Layer 7: Engine Decision', status: 'PASS', data: { recommendations: rows }, duration_ms: Date.now() - start, gap_notes: gaps };
}

// ─────────────────────────────────────────────
// LAYER 8: Order Creation
// ─────────────────────────────────────────────
async function testLayer8_OrderCreation(pool: pg.Pool): Promise<LayerResult> {
  const start = Date.now();
  const gaps: string[] = [];

  if (!testSignalId) {
    return { layer: 'Layer 8: Order Creation', status: 'SKIP', data: {}, duration_ms: 0, gap_notes: ['Skipped'] };
  }

  const { rows } = await pool.query(
    `SELECT order_id, signal_id, symbol, option_symbol, strike, expiration, type, 
            quantity, order_type, status, engine, experiment_id, created_at
     FROM orders WHERE signal_id = $1`,
    [testSignalId]
  );

  if (rows.length === 0) {
    // Check if signal was approved but no order
    const { rows: sigCheck } = await pool.query(
      `SELECT status, rejection_reason FROM signals WHERE signal_id = $1`, [testSignalId]
    );
    if (sigCheck[0]?.status === 'approved') {
      gaps.push('GAP: Signal approved but NO order created — order creation pipeline broken');
    } else {
      gaps.push(`NOTE: No order because signal status=${sigCheck[0]?.status}, reason=${sigCheck[0]?.rejection_reason}`);
    }
    return { layer: 'Layer 8: Order Creation', status: rows.length === 0 && sigCheck[0]?.status === 'approved' ? 'FAIL' : 'PARTIAL', data: { signal: sigCheck[0] }, duration_ms: Date.now() - start, gap_notes: gaps };
  }

  for (const order of rows) {
    log(`Order: id=${order.order_id}, ${order.symbol} ${order.type} strike=${order.strike} qty=${order.quantity} status=${order.status} engine=${order.engine}`);
    
    if (!order.option_symbol) gaps.push(`GAP: Order ${order.order_id} missing option_symbol`);
    if (order.status === 'failed') gaps.push(`FAIL: Order ${order.order_id} status is 'failed'`);
  }

  return { layer: 'Layer 8: Order Creation', status: 'PASS', data: { orders: rows }, duration_ms: Date.now() - start, gap_notes: gaps };
}

// ─────────────────────────────────────────────
// LAYER 9: Trade Execution (wait for paper executor)
// ─────────────────────────────────────────────
async function testLayer9_TradeExecution(pool: pg.Pool): Promise<LayerResult> {
  const start = Date.now();
  const gaps: string[] = [];

  if (!testSignalId) {
    return { layer: 'Layer 9: Trade Execution', status: 'SKIP', data: {}, duration_ms: 0, gap_notes: ['Skipped'] };
  }

  // First check if there are orders to fill
  const { rows: orderCheck } = await pool.query(
    `SELECT order_id, status FROM orders WHERE signal_id = $1`, [testSignalId]
  );

  if (orderCheck.length === 0) {
    return { layer: 'Layer 9: Trade Execution', status: 'SKIP', data: { reason: 'No orders to fill' }, duration_ms: 0, gap_notes: ['Skipped — no orders'] };
  }

  // Wait for paper executor (runs every 10s)
  log('Waiting for paper executor to fill orders...');
  const deadline = Date.now() + 60000; // 60s max wait

  while (Date.now() < deadline) {
    const { rows: trades } = await pool.query(
      `SELECT t.trade_id, t.order_id, t.fill_price, t.fill_quantity, t.fill_timestamp, 
              t.engine, o.status as order_status, o.option_symbol
       FROM trades t JOIN orders o ON o.order_id = t.order_id
       WHERE o.signal_id = $1`,
      [testSignalId]
    );

    if (trades.length > 0) {
      for (const trade of trades) {
        log(`Trade filled: id=${trade.trade_id}, price=${trade.fill_price}, qty=${trade.fill_quantity}, engine=${trade.engine}`);
        
        if (!trade.fill_price || Number(trade.fill_price) <= 0) {
          gaps.push(`GAP: Trade ${trade.trade_id} has invalid fill_price: ${trade.fill_price}`);
        }
        if (!trade.fill_timestamp) {
          gaps.push(`GAP: Trade ${trade.trade_id} missing fill_timestamp`);
        }
      }

      // Check order status updated
      const { rows: updatedOrders } = await pool.query(
        `SELECT order_id, status FROM orders WHERE signal_id = $1`, [testSignalId]
      );
      for (const o of updatedOrders) {
        if (o.status !== 'filled') {
          gaps.push(`GAP: Order ${o.order_id} status is '${o.status}' after trade — expected 'filled'`);
        }
      }

      return { layer: 'Layer 9: Trade Execution', status: 'PASS', data: { trades }, duration_ms: Date.now() - start, gap_notes: gaps };
    }

    // Check if orders failed
    const { rows: failedOrders } = await pool.query(
      `SELECT order_id, status FROM orders WHERE signal_id = $1 AND status = 'failed'`, [testSignalId]
    );
    if (failedOrders.length > 0) {
      gaps.push('FAIL: Paper executor failed to fill — check market data availability');
      return { layer: 'Layer 9: Trade Execution', status: 'FAIL', data: { failedOrders }, duration_ms: Date.now() - start, gap_notes: gaps };
    }

    log('  ... waiting for paper executor (runs every 10s)');
    await new Promise(r => setTimeout(r, 5000));
  }

  gaps.push('TIMEOUT: Paper executor did not fill orders within 60s');
  return { layer: 'Layer 9: Trade Execution', status: 'TIMEOUT', data: {}, duration_ms: Date.now() - start, gap_notes: gaps };
}

// ─────────────────────────────────────────────
// LAYER 10: Position Creation
// ─────────────────────────────────────────────
async function testLayer10_PositionCreation(pool: pg.Pool): Promise<LayerResult> {
  const start = Date.now();
  const gaps: string[] = [];

  if (!testSignalId) {
    return { layer: 'Layer 10: Position Creation', status: 'SKIP', data: {}, duration_ms: 0, gap_notes: ['Skipped'] };
  }

  // Find positions created from orders linked to our signal
  const { rows } = await pool.query(
    `SELECT p.position_id, p.symbol, p.option_symbol, p.strike, p.expiration, p.type,
            p.quantity, p.entry_price, p.current_price, p.unrealized_pnl, p.realized_pnl,
            p.status, p.entry_timestamp, p.engine, p.experiment_id,
            p.entry_bias_score, p.entry_regime_type, p.entry_mode_hint, p.entry_macro_class
     FROM refactored_positions p
     WHERE p.experiment_id = (SELECT experiment_id FROM signals WHERE signal_id = $1)
       AND p.created_at >= NOW() - INTERVAL '5 minutes'
     ORDER BY p.created_at DESC`,
    [testSignalId]
  );

  if (rows.length === 0) {
    // Also try matching by option_symbol from orders
    const { rows: byOrder } = await pool.query(
      `SELECT p.* FROM refactored_positions p
       WHERE p.option_symbol IN (SELECT option_symbol FROM orders WHERE signal_id = $1)
         AND p.created_at >= NOW() - INTERVAL '5 minutes'`,
      [testSignalId]
    );

    if (byOrder.length === 0) {
      gaps.push('GAP: No position created after trade filled — position creation broken');
      return { layer: 'Layer 10: Position Creation', status: 'FAIL', data: {}, duration_ms: Date.now() - start, gap_notes: gaps };
    }

    // Use the byOrder results
    for (const pos of byOrder) {
      log(`Position (by option_symbol): id=${pos.position_id}, ${pos.symbol} ${pos.type} strike=${pos.strike} status=${pos.status} entry=${pos.entry_price}`);
    }
    return { layer: 'Layer 10: Position Creation', status: 'PASS', data: { positions: byOrder }, duration_ms: Date.now() - start, gap_notes: gaps };
  }

  for (const pos of rows) {
    log(`Position: id=${pos.position_id}, ${pos.symbol} ${pos.type} strike=${pos.strike} status=${pos.status} entry=${pos.entry_price}`);

    if (pos.status !== 'open') gaps.push(`NOTE: Position status is '${pos.status}' (expected 'open')`);
    if (!pos.entry_price) gaps.push(`GAP: Position ${pos.position_id} missing entry_price`);
    if (!pos.entry_timestamp) gaps.push(`GAP: Position ${pos.position_id} missing entry_timestamp`);
    if (!pos.entry_bias_score && pos.entry_bias_score !== 0) gaps.push(`GAP: Position missing entry_bias_score — performance feedback will lack bias correlation`);
    if (!pos.entry_regime_type) gaps.push(`GAP: Position missing entry_regime_type — adaptive tuning data incomplete`);
    if (!pos.entry_mode_hint) gaps.push(`GAP: Position missing entry_mode_hint — performance analyzer data incomplete`);
  }

  return { layer: 'Layer 10: Position Creation', status: 'PASS', data: { positions: rows }, duration_ms: Date.now() - start, gap_notes: gaps };
}

// ─────────────────────────────────────────────
// BONUS: Check enriched signal (refactored_signals)
// ─────────────────────────────────────────────
async function testBonus_EnrichedSignal(pool: pg.Pool): Promise<LayerResult> {
  const start = Date.now();
  const gaps: string[] = [];

  if (!testSignalId) {
    return { layer: 'Bonus: Enriched Signal', status: 'SKIP', data: {}, duration_ms: 0, gap_notes: ['Skipped'] };
  }

  const { rows } = await pool.query(
    `SELECT refactored_signal_id, signal_id, enriched_data, risk_check_result, rejection_reason
     FROM refactored_signals WHERE signal_id = $1`,
    [testSignalId]
  );

  if (rows.length === 0) {
    gaps.push('NOTE: No enriched signal record — enrichment may not persist to refactored_signals table');
    return { layer: 'Bonus: Enriched Signal', status: 'PARTIAL', data: {}, duration_ms: Date.now() - start, gap_notes: gaps };
  }

  const enriched = rows[0];
  const data = enriched.enriched_data || {};
  const risk = enriched.risk_check_result || {};

  log(`Enriched signal found`);
  log(`  Market data: currentPrice=${data.currentPrice}, indicators=${data.indicators ? 'present' : 'missing'}`);
  log(`  GEX: ${data.gex ? 'present' : 'missing'}`);
  log(`  Options flow: ${data.optionsFlow ? 'present' : 'missing'}`);
  log(`  Confluence: ${data.confluence ? JSON.stringify(data.confluence) : 'missing'}`);
  log(`  Risk: ${JSON.stringify(risk)}`);

  if (!data.currentPrice) gaps.push('GAP: Enrichment missing currentPrice');
  if (!data.gex) gaps.push('GAP: Enrichment missing GEX data');
  if (!data.optionsFlow) gaps.push('GAP: Enrichment missing options flow');
  if (!data.confluence) gaps.push('GAP: Enrichment missing confluence score');

  return { layer: 'Bonus: Enriched Signal', status: 'PASS', data: { enriched_data: data, risk_check_result: risk }, duration_ms: Date.now() - start, gap_notes: gaps };
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║         E2E TRACE TEST: Webhook → Trade Pipeline                   ║');
  console.log('║         Testing every layer of the transaction flow                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  const pool = await createPool();
  log('Database connected');

  try {
    // Layer 1: Send webhook
    separator('LAYER 1: Webhook Ingestion');
    results.push(await testLayer1_WebhookIngestion());
    if (results[results.length - 1].status === 'FAIL') {
      log('ABORT: Layer 1 failed — cannot continue');
      printReport();
      return;
    }

    // Layer 2: Check signal in DB
    separator('LAYER 2: Signal Storage');
    results.push(await testLayer2_SignalStorage(pool));

    // Layer 3: Check webhook event
    separator('LAYER 3: Webhook Event Logging');
    results.push(await testLayer3_WebhookEventLogging(pool));

    // Wait for orchestrator processing (up to MAX_WAIT_SECONDS)
    separator('WAITING FOR ORCHESTRATOR');
    await waitForProcessing(pool);

    // Layer 4: Orchestrator result
    separator('LAYER 4: Orchestrator Processing');
    results.push(await testLayer4_OrchestratorProcessing(pool));

    // Layer 5: Experiment
    separator('LAYER 5: Experiment Assignment');
    results.push(await testLayer5_ExperimentAssignment(pool));

    // Layer 6: Policy
    separator('LAYER 6: Policy Resolution');
    results.push(await testLayer6_PolicyResolution(pool));

    // Layer 7: Engine decision
    separator('LAYER 7: Engine Decision');
    results.push(await testLayer7_EngineDecision(pool));

    // Layer 8: Order
    separator('LAYER 8: Order Creation');
    results.push(await testLayer8_OrderCreation(pool));

    // Layer 9: Trade (wait for paper executor)
    separator('LAYER 9: Trade Execution');
    results.push(await testLayer9_TradeExecution(pool));

    // Layer 10: Position
    separator('LAYER 10: Position Creation');
    results.push(await testLayer10_PositionCreation(pool));

    // Bonus: Enriched signal
    separator('BONUS: Enriched Signal Data');
    results.push(await testBonus_EnrichedSignal(pool));

    // Print final report
    printReport();

  } finally {
    await pool.end();
  }
}

function printReport() {
  separator('FINAL E2E TRACE REPORT');

  console.log(`\nTest Session: ${testSessionId}`);
  console.log(`Signal ID: ${testSignalId || 'N/A'}`);
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  // Summary table
  console.log('┌────┬──────────────────────────────────────┬──────────┬───────────┐');
  console.log('│ #  │ Layer                                │ Status   │ Time (ms) │');
  console.log('├────┼──────────────────────────────────────┼──────────┼───────────┤');

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const num = String(i + 1).padStart(2);
    const name = r.layer.padEnd(36).slice(0, 36);
    const status = r.status.padEnd(8);
    const time = String(r.duration_ms).padStart(9);
    const icon = r.status === 'PASS' ? '+' : r.status === 'FAIL' ? 'X' : r.status === 'TIMEOUT' ? '!' : r.status === 'SKIP' ? '-' : '~';
    console.log(`│ ${num} │ ${name} │ ${icon} ${status}│ ${time} │`);
  }

  console.log('└────┴──────────────────────────────────────┴──────────┴───────────┘');

  // Gap notes
  const allGaps: string[] = [];
  for (const r of results) {
    for (const gap of r.gap_notes) {
      allGaps.push(`[${r.layer}] ${gap}`);
    }
  }

  if (allGaps.length > 0) {
    console.log('\n--- GAPS AND ISSUES FOUND ---\n');
    for (let i = 0; i < allGaps.length; i++) {
      console.log(`  ${i + 1}. ${allGaps[i]}`);
    }
  } else {
    console.log('\nNo gaps found — full pipeline passed!');
  }

  // Summary counts
  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const timeout = results.filter(r => r.status === 'TIMEOUT').length;
  const skip = results.filter(r => r.status === 'SKIP').length;
  const partial = results.filter(r => r.status === 'PARTIAL').length;

  console.log(`\nSummary: ${pass} PASS, ${fail} FAIL, ${timeout} TIMEOUT, ${partial} PARTIAL, ${skip} SKIP out of ${results.length} layers`);

  if (fail > 0 || timeout > 0) {
    console.log('\n*** PIPELINE HAS BROKEN LAYERS — see gaps above ***');
  }

  // Pipeline depth reached
  const lastPass = results.filter(r => r.status === 'PASS' || r.status === 'PARTIAL');
  if (lastPass.length > 0) {
    console.log(`\nDeepest layer reached: ${lastPass[lastPass.length - 1].layer}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
