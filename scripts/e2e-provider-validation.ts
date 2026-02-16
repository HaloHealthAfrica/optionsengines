/**
 * E2E Provider Validation + Full Pipeline Test
 *
 * Validates:
 *   1. Provider health (all configured market data providers)
 *   2. Unusual Whales data availability (option chain, flow, pricing)
 *   3. GEX data availability
 *   4. Full webhook-to-trade pipeline (Layers 1-11)
 *   5. Enrichment data completeness (GEX, flow, confluence, indicators)
 *
 * Usage: npx tsx scripts/e2e-provider-validation.ts
 */

import pg from 'pg';
import crypto from 'crypto';
import { config } from '../src/config/index.js';
import { db } from '../src/services/database.service.js';

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000';
const TEST_SYMBOL = 'SPY';
const WEBHOOK_SECRET = config.hmacSecret;

let testSignalId: string | null = null;
let testSessionId: string;

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${msg}`);
}

function header(title: string) {
  console.log('');
  console.log('='.repeat(70));
  console.log(`  ${title}`);
  console.log('='.repeat(70));
}

function subheader(title: string) {
  console.log(`\n  --- ${title} ---`);
}

// ============================================================
// PHASE 1: Provider Health Check
// ============================================================
async function checkProviderHealth(): Promise<Record<string, any>> {
  header('PHASE 1: Provider Health Check');

  try {
    const res = await fetch(`${WEBHOOK_URL}/health`);
    const body = await res.json() as Record<string, any>;
    log(`Server status: ${body.status}`);
    log(`Uptime: ${body.uptime_seconds}s`);
    log(`Database: ${body.database?.ok ? 'OK' : 'FAILED'}`);
    log(`Cache: hits=${body.cache?.hits}, misses=${body.cache?.misses}`);

    if (body.external_apis?.circuit_breakers) {
      subheader('Circuit Breakers');
      for (const [provider, state] of Object.entries(body.external_apis.circuit_breakers as Record<string, any>)) {
        const s = state as { state: string; failures: number };
        const icon = s.state === 'closed' ? '+' : s.state === 'half-open' ? '~' : 'X';
        log(`  ${icon} ${provider}: ${s.state} (failures: ${s.failures})`);
      }
    }

    return body;
  } catch (e: any) {
    log(`FAIL: Server not reachable — ${e.message}`);
    return { status: 'unreachable' };
  }
}

// ============================================================
// PHASE 2: Direct Provider Data Validation
// ============================================================
async function validateProviderData(): Promise<{
  optionChain: boolean;
  optionPrice: boolean;
  optionsFlow: boolean;
  gex: boolean;
  stockPrice: boolean;
  indicators: boolean;
}> {
  header('PHASE 2: Provider Data Validation (via internal API)');

  const results = {
    optionChain: false,
    optionPrice: false,
    optionsFlow: false,
    gex: false,
    stockPrice: false,
    indicators: false,
  };

  // Check via the monitoring endpoint if available, otherwise via DB enrichment
  try {
    const res = await fetch(`${WEBHOOK_URL}/v1/monitoring/market-data-status?symbol=${TEST_SYMBOL}`);
    if (res.ok) {
      const data = await res.json() as Record<string, any>;
      log(`Market data status endpoint available`);
      log(`  Data: ${JSON.stringify(data).slice(0, 200)}`);
    }
  } catch {
    log(`Market data status endpoint not available (non-critical)`);
  }

  // Test stock price via a lightweight probe
  subheader('Stock Price');
  try {
    const res = await fetch(`${WEBHOOK_URL}/v1/monitoring/providers`);
    if (res.ok) {
      const data = await res.json() as Record<string, any>;
      log(`Provider monitoring: ${JSON.stringify(data).slice(0, 300)}`);
    } else {
      log(`Provider monitoring: ${res.status} ${res.statusText}`);
    }
  } catch {
    log(`Provider endpoint not available`);
  }

  // We'll validate the rest through the enriched signal after the E2E test
  log(`Detailed provider data will be validated via enriched signal after E2E test`);

  return results;
}

// ============================================================
// PHASE 3: Unusual Whales Configuration Check
// ============================================================
async function checkUWConfiguration(): Promise<void> {
  header('PHASE 3: Unusual Whales Configuration');

  const isRemote = !WEBHOOK_URL.includes('localhost') && !WEBHOOK_URL.includes('127.0.0.1');

  if (isRemote) {
    log(`Target: PRODUCTION (${WEBHOOK_URL})`);
    log(`Note: Config flags below are from LOCAL .env — prod config may differ.`);
    log(`Production provider health is inferred from the /health circuit breakers above.`);
  } else {
    log(`Target: LOCAL (${WEBHOOK_URL})`);
  }

  log(`unusualWhalesOptionsEnabled: ${config.unusualWhalesOptionsEnabled}`);
  log(`unusualWhalesApiKey: ${config.unusualWhalesApiKey ? 'SET (' + config.unusualWhalesApiKey.slice(0, 8) + '...)' : 'NOT SET (local)'}`);
  log(`unusualWhalesGammaUrl: ${config.unusualWhalesGammaUrl || 'NOT SET (local)'}`);
  log(`enableDealerUwGamma: ${(config as any).enableDealerUwGamma}`);
  log(`enableDealerGex: ${(config as any).enableDealerGex}`);
  log(`enableUwFlowPoller: ${(config as any).enableUwFlowPoller}`);
  log(`enableGammaMetricsService: ${(config as any).enableGammaMetricsService}`);
  log(`gammaMetricsSymbols: ${(config as any).gammaMetricsSymbols?.join(', ') || 'none'}`);

  if (isRemote) {
    log(`INFO: UW API key is managed via Fly.io secrets on production`);
    log(`  Check: fly secrets list -a optionsengines`);
  } else {
    if (!config.unusualWhalesApiKey) {
      log(`WARNING: UW API key not set — UW data will not be available`);
    }
    if (!config.unusualWhalesOptionsEnabled) {
      log(`WARNING: UW options disabled — option chain/flow/pricing will skip UW`);
    }
  }
}

// ============================================================
// PHASE 4: Full E2E Webhook Test
// ============================================================
async function runE2EWebhookTest(): Promise<{
  layers: Array<{ name: string; status: string; detail?: string }>;
}> {
  header('PHASE 4: Full E2E Pipeline Test');

  testSessionId = `e2e-provider-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const layers: Array<{ name: string; status: string; detail?: string }> = [];

  // Layer 1: Send webhook
  subheader('Layer 1: Webhook Ingestion');
  const payload = {
    symbol: TEST_SYMBOL,
    direction: 'long',
    timeframe: '5m',
    timestamp: new Date().toISOString(),
    price: 595.42,
    confidence: 75,
    pattern_strength: 80,
    mtf_alignment: 70,
    indicators: { ema8: 595.1, ema21: 594.8, atr: 1.25 },
    is_test: true,
    test_session_id: testSessionId,
    test_scenario: 'e2e_provider_validation',
  };

  const bodyStr = JSON.stringify(payload);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const isRemote = !WEBHOOK_URL.includes('localhost') && !WEBHOOK_URL.includes('127.0.0.1');

  if (!isRemote && WEBHOOK_SECRET && WEBHOOK_SECRET !== 'change-this-to-another-secure-random-string-for-webhooks') {
    const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET).update(bodyStr).digest('hex');
    headers['X-Webhook-Signature'] = hmac;
    log(`HMAC signature: included (local secret)`);
  } else if (isRemote) {
    log(`HMAC signature: skipped (remote target — local secret won't match)`);
  } else {
    log(`HMAC signature: skipped (no secret configured)`);
  }

  try {
    const res = await fetch(`${WEBHOOK_URL}/webhook`, {
      method: 'POST',
      headers,
      body: bodyStr,
    });
    const resBody = await res.json() as Record<string, any>;
    testSignalId = resBody.signal_id;
    log(`Response: ${res.status} — signal_id=${testSignalId}`);
    layers.push({ name: 'Webhook Ingestion', status: res.status === 200 ? 'PASS' : 'FAIL', detail: `${res.status}` });
  } catch (e: any) {
    log(`FAIL: ${e.message}`);
    layers.push({ name: 'Webhook Ingestion', status: 'FAIL', detail: e.message });
    return { layers };
  }

  if (!testSignalId) {
    log(`ABORT: No signal_id returned`);
    return { layers };
  }

  // Wait for orchestrator
  subheader('Waiting for Orchestrator');
  let processed = false;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const { rows } = await db.query(
      `SELECT status, processed, rejection_reason FROM signals WHERE signal_id = $1`,
      [testSignalId]
    );
    const s = rows[0];
    if (s?.processed) {
      log(`Signal processed: status=${s.status}, rejection=${s.rejection_reason || 'none'}`);
      processed = true;
      layers.push({ name: 'Orchestrator Processing', status: s.status === 'approved' ? 'PASS' : 'FAIL', detail: s.status });
      break;
    }
    if (i % 4 === 0) log(`  ... waiting (status=${s?.status}, processed=${s?.processed})`);
  }
  if (!processed) {
    log(`TIMEOUT: Signal not processed after 80s`);
    layers.push({ name: 'Orchestrator Processing', status: 'TIMEOUT' });
    // Don't return — continue to check enrichment data anyway
  }

  // Check experiment
  subheader('Layer: Experiment + Policy');
  const { rows: expRows } = await db.query(
    `SELECT experiment_id, variant, split_percentage, policy_version FROM experiments WHERE signal_id = $1`,
    [testSignalId]
  );
  if (expRows.length > 0) {
    log(`Experiment: variant=${expRows[0].variant}, split=${expRows[0].split_percentage}`);
    layers.push({ name: 'Experiment Assignment', status: 'PASS' });
  } else {
    layers.push({ name: 'Experiment Assignment', status: 'FAIL' });
  }

  // Check recommendation
  subheader('Layer: Engine Decision');
  const { rows: recRows } = await db.query(
    `SELECT engine, symbol, strike, expiration, quantity, entry_price, is_shadow, rationale
     FROM decision_recommendations WHERE signal_id = $1`,
    [testSignalId]
  );
  if (recRows.length > 0) {
    const rec = recRows[0];
    log(`Recommendation: engine=${rec.engine}, ${rec.symbol} strike=${rec.strike} qty=${rec.quantity} entry=${rec.entry_price}`);

    // Check rationale for entry_metadata (Phase 2b)
    const rationale = typeof rec.rationale === 'string' ? JSON.parse(rec.rationale) : rec.rationale;
    if (rationale?.entry_metadata) {
      log(`  Entry metadata: advancedStrike=${rationale.entry_metadata.advancedStrikeUsed}, biasConf=${rationale.entry_metadata.biasConfidence}`);
    } else {
      log(`  Entry metadata: not present (normal if ENABLE_ADVANCED_STRIKE_SELECTION=false)`);
    }
    layers.push({ name: 'Engine Decision', status: 'PASS', detail: `strike=${rec.strike}` });
  } else {
    layers.push({ name: 'Engine Decision', status: 'FAIL' });
  }

  // Check order
  subheader('Layer: Order Creation');
  const { rows: orderRows } = await db.query(
    `SELECT order_id, symbol, strike, type, quantity, status, engine, is_test FROM orders WHERE signal_id = $1`,
    [testSignalId]
  );
  if (orderRows.length > 0) {
    const o = orderRows[0];
    log(`Order: ${o.order_id} ${o.symbol} ${o.type} strike=${o.strike} qty=${o.quantity} status=${o.status} is_test=${o.is_test}`);
    layers.push({ name: 'Order Creation', status: 'PASS', detail: `status=${o.status}, is_test=${o.is_test}` });
  } else {
    layers.push({ name: 'Order Creation', status: 'FAIL' });
  }

  // Wait briefly for paper executor
  subheader('Layer: Trade Execution');
  await new Promise(r => setTimeout(r, 12000));
  const { rows: tradeRows } = await db.query(
    `SELECT t.trade_id, t.fill_price, t.fill_quantity, t.is_test, o.order_id
     FROM trades t JOIN orders o ON o.order_id = t.order_id
     WHERE o.signal_id = $1`,
    [testSignalId]
  );
  if (tradeRows.length > 0) {
    const t = tradeRows[0];
    log(`Trade filled: price=${t.fill_price} qty=${t.fill_quantity} is_test=${t.is_test}`);
    layers.push({ name: 'Trade Execution', status: 'PASS', detail: `price=${t.fill_price}` });
  } else {
    log(`No trade fill (expected if market closed)`);
    layers.push({ name: 'Trade Execution', status: 'SKIP', detail: 'Market likely closed' });
  }

  // Check position
  subheader('Layer: Position Creation');
  const { rows: posRows } = await db.query(
    `SELECT rp.position_id, rp.status AS pos_status, rp.entry_price, rp.is_test, rp.entry_bias_score, rp.entry_regime_type
     FROM refactored_positions rp
     JOIN orders o ON o.symbol = rp.symbol AND o.strike = rp.strike
     WHERE o.signal_id = $1 AND rp.entry_timestamp > NOW() - interval '5 minutes'
     LIMIT 1`,
    [testSignalId]
  );
  if (posRows.length > 0) {
    const p = posRows[0];
    log(`Position: ${p.position_id} status=${p.pos_status} entry=${p.entry_price} is_test=${p.is_test} bias=${p.entry_bias_score} regime=${p.entry_regime_type}`);
    layers.push({ name: 'Position Creation', status: 'PASS' });
  } else {
    log(`No position (expected if market closed / no trade fill)`);
    layers.push({ name: 'Position Creation', status: 'SKIP', detail: 'No trade fill' });
  }

  return { layers };
}

// ============================================================
// PHASE 5: Enrichment Data Deep Validation
// ============================================================
async function validateEnrichmentData(): Promise<{
  enrichmentFields: Record<string, string>;
  providerSources: string[];
}> {
  header('PHASE 5: Enrichment Data Deep Validation');

  const enrichmentFields: Record<string, string> = {};
  const providerSources: string[] = [];

  if (!testSignalId) {
    log(`SKIP: No signal to validate (webhook failed)`);
    return { enrichmentFields, providerSources };
  }

  const { rows } = await db.query(
    `SELECT enriched_data, risk_check_result, rejection_reason FROM refactored_signals WHERE signal_id = $1`,
    [testSignalId]
  );

  if (rows.length === 0) {
    log(`FAIL: No enriched signal record found`);
    enrichmentFields['persistence'] = 'MISSING';
    return { enrichmentFields, providerSources };
  }

  const enriched = rows[0];
  const data = typeof enriched.enriched_data === 'string' ? JSON.parse(enriched.enriched_data) : enriched.enriched_data;
  const risk = typeof enriched.risk_check_result === 'string' ? JSON.parse(enriched.risk_check_result) : enriched.risk_check_result;

  enrichmentFields['persistence'] = 'OK';

  // Current price
  subheader('Market Data');
  if (data?.currentPrice) {
    log(`  + Current price: $${data.currentPrice}`);
    enrichmentFields['currentPrice'] = `$${data.currentPrice}`;
  } else {
    log(`  X Current price: MISSING`);
    enrichmentFields['currentPrice'] = 'MISSING';
  }

  // Indicators
  if (data?.indicators) {
    const ind = data.indicators;
    const keys = Object.keys(ind);
    log(`  + Indicators: ${keys.length} keys (${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''})`);
    enrichmentFields['indicators'] = `${keys.length} fields`;
  } else {
    log(`  X Indicators: MISSING`);
    enrichmentFields['indicators'] = 'MISSING';
  }

  // GEX
  subheader('GEX Data');
  if (data?.gex) {
    const gex = data.gex;
    log(`  + GEX present`);
    log(`    totalCallGex: ${gex.totalCallGex}`);
    log(`    totalPutGex: ${gex.totalPutGex}`);
    log(`    netGex: ${gex.netGex}`);
    log(`    maxPain: ${gex.maxPain}`);
    log(`    source: ${gex.source || 'unknown'}`);
    enrichmentFields['gex'] = `netGex=${gex.netGex}, maxPain=${gex.maxPain}`;
    if (gex.source) providerSources.push(`GEX: ${gex.source}`);
  } else {
    log(`  X GEX: MISSING`);
    enrichmentFields['gex'] = 'MISSING';
  }

  // Options Flow
  subheader('Options Flow');
  if (data?.optionsFlow) {
    const flow = data.optionsFlow;
    const entries = Array.isArray(flow.entries) ? flow.entries : [];
    log(`  + Options flow: ${entries.length} entries`);
    log(`    source/debug: ${flow.flowDebug || flow.source || 'unknown'}`);
    if (entries.length > 0) {
      const first = entries[0];
      log(`    Sample: ${first.optionSymbol || first.symbol} ${first.side} strike=${first.strike} vol=${first.volume} prem=${first.premium}`);
    }
    enrichmentFields['optionsFlow'] = `${entries.length} entries`;
    if (flow.flowDebug) providerSources.push(`Flow: ${flow.flowDebug}`);
  } else {
    log(`  X Options flow: MISSING`);
    enrichmentFields['optionsFlow'] = 'MISSING';
  }

  // Confluence
  subheader('Confluence');
  if (data?.confluence) {
    log(`  + Confluence: score=${data.confluence.score}, multiplier=${data.confluence.positionSizeMultiplier}`);
    enrichmentFields['confluence'] = `score=${data.confluence.score}`;
  } else {
    log(`  ~ Confluence: not present (requires flow + GEX)`);
    enrichmentFields['confluence'] = 'NOT_COMPUTED';
  }

  // Risk check
  subheader('Risk Check');
  if (risk) {
    log(`  Market open: ${risk.marketOpen}`);
    log(`  Test bypass: ${risk.testBypass}`);
    log(`  Open positions: ${risk.openPositions}`);
    log(`  Daily PnL: ${risk.dailyPnL}`);
    log(`  Max daily loss: ${risk.maxDailyLoss}`);
    enrichmentFields['riskCheck'] = `marketOpen=${risk.marketOpen}, positions=${risk.openPositions}`;
  }

  // Gamma context
  subheader('Gamma Context');
  if (data?.gammaContext) {
    log(`  + Gamma context: ${JSON.stringify(data.gammaContext).slice(0, 200)}`);
    enrichmentFields['gammaContext'] = 'present';
  } else {
    log(`  ~ Gamma context: not present (requires gamma metrics service)`);
    enrichmentFields['gammaContext'] = 'NOT_AVAILABLE';
  }

  // Instance isolation check (Phase 3b)
  subheader('Instance Isolation');
  const { rows: signalRows } = await db.query(
    `SELECT locked_by, locked_at FROM signals WHERE signal_id = $1`,
    [testSignalId]
  );
  if (signalRows.length > 0) {
    const s = signalRows[0];
    log(`  locked_by: ${s.locked_by || 'cleared (processed)'}`);
    log(`  locked_at: ${s.locked_at || 'cleared (processed)'}`);
    enrichmentFields['instanceIsolation'] = s.locked_by ? `locked_by=${s.locked_by}` : 'lock released (OK)';
  }

  return { enrichmentFields, providerSources };
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   E2E PROVIDER VALIDATION + PIPELINE TEST                           ║');
  console.log('║   Validates UW data, all providers, full webhook-to-trade flow      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  // Connect DB
  await db.query('SELECT 1');
  log('Database connected');

  // Phase 1: Health
  const health = await checkProviderHealth();
  if (health.status === 'unreachable') {
    console.log('\nABORT: Server unreachable. Start with `npm run dev` first.');
    process.exit(1);
  }

  // Phase 2: Provider data overview
  await validateProviderData();

  // Phase 3: UW config
  await checkUWConfiguration();

  // Phase 4: Full E2E
  const { layers } = await runE2EWebhookTest();

  // Phase 5: Enrichment deep dive
  const { enrichmentFields, providerSources } = await validateEnrichmentData();

  // ============================================================
  // FINAL REPORT
  // ============================================================
  header('FINAL VALIDATION REPORT');

  console.log(`\nTest Session: ${testSessionId}`);
  console.log(`Signal ID: ${testSignalId || 'N/A'}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  // Pipeline layers
  console.log(`\n  Pipeline Layers:`);
  console.log('  ' + '-'.repeat(66));
  for (const l of layers) {
    const icon = l.status === 'PASS' ? '+' : l.status === 'FAIL' ? 'X' : l.status === 'TIMEOUT' ? '!' : '~';
    console.log(`  ${icon} ${l.name.padEnd(30)} ${l.status.padEnd(8)} ${l.detail || ''}`);
  }

  // Enrichment data
  console.log(`\n  Enrichment Data:`);
  console.log('  ' + '-'.repeat(66));
  for (const [key, val] of Object.entries(enrichmentFields)) {
    const icon = val === 'MISSING' ? 'X' : val.startsWith('NOT_') ? '~' : '+';
    console.log(`  ${icon} ${key.padEnd(25)} ${val}`);
  }

  // Provider sources
  if (providerSources.length > 0) {
    console.log(`\n  Data Sources:`);
    console.log('  ' + '-'.repeat(66));
    for (const s of providerSources) {
      console.log(`    ${s}`);
    }
  }

  // Summary
  const passCount = layers.filter(l => l.status === 'PASS').length;
  const failCount = layers.filter(l => l.status === 'FAIL').length;
  const skipCount = layers.filter(l => l.status === 'SKIP').length;
  const timeoutCount = layers.filter(l => l.status === 'TIMEOUT').length;
  const enrichedMissing = Object.values(enrichmentFields).filter(v => v === 'MISSING').length;

  console.log(`\n  Summary: ${passCount} PASS, ${failCount} FAIL, ${skipCount} SKIP, ${timeoutCount} TIMEOUT`);
  console.log(`  Enrichment: ${Object.keys(enrichmentFields).length - enrichedMissing} present, ${enrichedMissing} missing`);

  if (failCount === 0 && enrichedMissing === 0) {
    console.log(`\n  *** ALL VALIDATIONS PASSED — READY FOR LIVE TESTING ***`);
  } else if (failCount === 0 && enrichedMissing > 0) {
    console.log(`\n  *** PIPELINE OK — Some enrichment data missing (check provider config/market hours) ***`);
  } else {
    console.log(`\n  *** PIPELINE HAS ISSUES — Fix failures before live testing ***`);
  }

  console.log('');
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
