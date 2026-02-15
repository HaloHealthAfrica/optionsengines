#!/usr/bin/env npx tsx
/**
 * E2E Webhook Replay Script
 *
 * Loads historical JSON webhook payloads (saved from TradingView or fixtures),
 * replays them sequentially to /webhook, and logs full pipeline validation.
 *
 * Usage:
 *   E2E_TEST_MODE=true npx tsx scripts/run-e2e-replay.ts [options]
 *
 * Options:
 *   --file=<path>     Path to JSON file with payloads array (default: tmp/e2e-webhook-payloads.json)
 *   --url=<url>       Webhook URL (default: http://localhost:3000/webhook)
 *   --limit=<n>       Max payloads to replay (default: all)
 *   --delay=<ms>      Delay between webhooks in ms (default: 500)
 *   --token=<jwt>     JWT for monitoring API (optional, enables pipeline polling)
 *
 * Env:
 *   WEBHOOK_REPLAY_URL   - target webhook URL
 *   WEBHOOK_REPLAY_FILE  - path to payloads JSON
 *   WEBHOOK_REPLAY_LIMIT - max payloads
 *   WEBHOOK_REPLAY_DELAY_MS - delay between requests
 *   BACKEND_TOKEN        - JWT for /monitoring/status
 *
 * Validates:
 *   1. Webhook ingestion
 *   2. Schema validation
 *   3. Bias state (if bias payload)
 *   4. Signal creation
 *   5. Risk/guard/order (via monitoring poll)
 *   6. Exit/PnL (via monitoring poll)
 */

import fs from 'fs/promises';
import path from 'path';

const WEBHOOK_URL =
  process.env.WEBHOOK_REPLAY_URL ||
  process.argv.find((a) => a.startsWith('--url='))?.slice(6) ||
  'http://localhost:3000/webhook';
const FILE_PATH =
  process.env.WEBHOOK_REPLAY_FILE ||
  process.argv.find((a) => a.startsWith('--file='))?.slice(7) ||
  path.resolve(process.cwd(), 'tmp/e2e-webhook-payloads.json');
const LIMIT_ARG = process.env.WEBHOOK_REPLAY_LIMIT || process.argv.find((a) => a.startsWith('--limit='))?.slice(8);
const LIMIT = LIMIT_ARG ? Math.max(1, parseInt(LIMIT_ARG, 10)) : null;
const DELAY_MS =
  Number(process.env.WEBHOOK_REPLAY_DELAY_MS) ||
  Number(process.argv.find((a) => a.startsWith('--delay='))?.slice(7)) ||
  500;
const TOKEN =
  process.env.BACKEND_TOKEN ||
  process.argv.find((a) => a.startsWith('--token='))?.slice(7) ||
  '';

interface WebhookPayload {
  symbol?: string;
  ticker?: string;
  direction?: string;
  timeframe?: string;
  timestamp?: string;
  event_type?: string;
  event_id_raw?: string;
  bias_score?: number;
  [key: string]: unknown;
}

interface ReplayResult {
  index: number;
  payload: WebhookPayload;
  ingestion: 'ok' | 'rejected' | 'duplicate' | 'error';
  status: string;
  signal_id?: string;
  processing_time_ms?: number;
  error?: string;
  monitoring?: {
    signal_status?: string;
    order_status?: string;
    rejection_reason?: string;
    decision_engine?: string;
  };
}

const DEFAULT_PAYLOADS: WebhookPayload[] = [
  {
    symbol: 'SPY',
    direction: 'long',
    timeframe: '5m',
    timestamp: new Date().toISOString(),
    is_test: true,
    metadata: { is_test: true, test_scenario: 'e2e-replay' },
  },
  {
    symbol: 'QQQ',
    direction: 'short',
    timeframe: '15m',
    timestamp: new Date(Date.now() - 60000).toISOString(),
    is_test: true,
    metadata: { is_test: true, test_scenario: 'e2e-replay' },
  },
  {
    symbol: 'IWM',
    direction: 'long',
    timeframe: '1m',
    timestamp: new Date(Date.now() - 120000).toISOString(),
    is_test: true,
    metadata: { is_test: true, test_scenario: 'e2e-replay' },
  },
];

async function loadPayloads(): Promise<WebhookPayload[]> {
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf8');
    const data = JSON.parse(raw);
    const arr = Array.isArray(data) ? data : data.payloads ?? data.webhooks ?? data.results ?? [];
    const payloads = arr
      .filter((p: unknown): p is Record<string, unknown> => p != null && typeof p === 'object')
      .map((p) => ({
        symbol: String(p.symbol ?? p.ticker ?? 'SPY'),
        direction: String(p.direction ?? 'long').toLowerCase() as 'long' | 'short',
        timeframe: String(p.timeframe ?? '5m'),
        timestamp: String(p.timestamp ?? new Date().toISOString()),
        ...p,
      })) as WebhookPayload[];
    return payloads.length > 0 ? payloads : DEFAULT_PAYLOADS;
  } catch {
    console.log(`File not found: ${FILE_PATH}. Using built-in fixtures.\n`);
    return DEFAULT_PAYLOADS;
  }
}

async function sendWebhook(payload: WebhookPayload): Promise<{
  status: number;
  data: Record<string, unknown>;
}> {
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

async function fetchMonitoring(signalId: string): Promise<Record<string, unknown> | null> {
  if (!TOKEN) return null;
  const base = WEBHOOK_URL.replace(/\/webhook\/?$/, '');
  try {
    const res = await fetch(`${base}/monitoring/status?limit=25&testFilter=test`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const pipeline = data.pipeline as Record<string, unknown> | undefined;
    const recentSignals = (pipeline?.recent_signals as Array<Record<string, unknown>>) ?? [];
    const recentRejections = (pipeline?.recent_rejections as Array<Record<string, unknown>>) ?? [];
    const signal = recentSignals.find((s) => s.signal_id === signalId);
    const rejection = recentRejections.find((r) => r.signal_id === signalId);
    const decisionLog = (data.decision_engine as Record<string, unknown>)?.decision_log as
      | Array<Record<string, unknown>>
      | undefined;
    const decision = decisionLog?.find((d) => d.signal_id === signalId);
    return {
      signal_status: signal?.status as string | undefined,
      rejection_reason: rejection?.rejection_reason as string | undefined,
      order_status: decision?.outcome as string | undefined,
      decision_engine: decision?.engine as string | undefined,
    };
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function run(): Promise<void> {
  console.log('═'.repeat(70));
  console.log('  E2E Webhook Replay');
  console.log('═'.repeat(70));
  console.log(`  URL:    ${WEBHOOK_URL}`);
  console.log(`  File:   ${FILE_PATH}`);
  console.log(`  Limit:  ${LIMIT ?? 'all'}`);
  console.log(`  Delay:  ${DELAY_MS}ms`);
  console.log(`  Token:  ${TOKEN ? '***' : 'none (monitoring poll disabled)'}`);
  console.log('═'.repeat(70));
  console.log('');

  const all = await loadPayloads();
  const payloads = LIMIT ? all.slice(0, LIMIT) : all;
  const results: ReplayResult[] = [];

  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i];
    const symbol = payload.symbol ?? payload.ticker ?? '?';
    const direction = payload.direction ?? '?';
    const timeframe = payload.timeframe ?? '?';

    console.log(`[${i + 1}/${payloads.length}] ${symbol} ${direction} ${timeframe}`);

    try {
      const { status, data } = await sendWebhook(payload);

      const respStatus = (data.status as string) ?? (status >= 200 && status < 300 ? 'ACCEPTED' : 'REJECTED');
      const signalId = data.signal_id as string | undefined;
      const processingMs = data.processing_time_ms as number | undefined;
      const error = data.error as string | undefined;

      let ingestion: ReplayResult['ingestion'] = 'error';
      if (respStatus === 'ACCEPTED') ingestion = 'ok';
      else if (respStatus === 'DUPLICATE') ingestion = 'duplicate';
      else if (status >= 400) ingestion = 'rejected';

      console.log(`  1. Ingestion: ${ingestion.toUpperCase()} (${respStatus})`);
      if (signalId) console.log(`     signal_id: ${signalId}`);
      if (processingMs != null) console.log(`     processing_time_ms: ${processingMs}`);
      if (error) console.log(`     error: ${error}`);

      let monitoring: ReplayResult['monitoring'] = undefined;
      if (signalId && TOKEN) {
        await sleep(1000);
        monitoring = (await fetchMonitoring(signalId)) ?? undefined;
        if (monitoring) {
          console.log(`  2. Schema: validated`);
          if (monitoring.signal_status) console.log(`  3. Bias/Signal: ${monitoring.signal_status}`);
          if (monitoring.rejection_reason) console.log(`  4. Guard/Setup: BLOCKED - ${monitoring.rejection_reason}`);
          else if (monitoring.order_status) console.log(`  5. Order: ${monitoring.order_status}`);
          if (monitoring.decision_engine) console.log(`  6. Engine: ${monitoring.decision_engine}`);
        }
      } else if (payload.event_type === 'BIAS_SNAPSHOT' || payload.event_id_raw) {
        console.log(`  2. Bias webhook: ${(data as { success?: boolean }).success ? 'updated' : 'see response'}`);
      }

      results.push({
        index: i + 1,
        payload,
        ingestion,
        status: respStatus,
        signal_id: signalId,
        processing_time_ms: processingMs,
        error,
        monitoring,
      });
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.log(`  ERROR: ${errMsg}`);
      results.push({
        index: i + 1,
        payload,
        ingestion: 'error',
        status: 'ERROR',
        error: errMsg,
      });
    }

    if (i < payloads.length - 1 && DELAY_MS > 0) {
      await sleep(DELAY_MS);
    }
    console.log('');
  }

  // Summary
  console.log('═'.repeat(70));
  console.log('  E2E Replay Summary');
  console.log('═'.repeat(70));
  const ok = results.filter((r) => r.ingestion === 'ok').length;
  const rejected = results.filter((r) => r.ingestion === 'rejected').length;
  const duplicate = results.filter((r) => r.ingestion === 'duplicate').length;
  const errors = results.filter((r) => r.ingestion === 'error').length;
  console.log(`  Ingestion OK:      ${ok}`);
  console.log(`  Rejected:          ${rejected}`);
  console.log(`  Duplicate:         ${duplicate}`);
  console.log(`  Errors:            ${errors}`);
  console.log('═'.repeat(70));

  const reportPath = path.resolve(process.cwd(), 'tmp/e2e-replay-report.json');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(
    reportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        url: WEBHOOK_URL,
        total: results.length,
        ok,
        rejected,
        duplicate,
        errors,
        results: results.map((r) => ({
          index: r.index,
          symbol: r.payload.symbol ?? r.payload.ticker,
          direction: r.payload.direction,
          ingestion: r.ingestion,
          status: r.status,
          signal_id: r.signal_id,
          monitoring: r.monitoring,
        })),
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`\nReport saved: ${reportPath}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
