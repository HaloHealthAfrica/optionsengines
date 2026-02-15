#!/usr/bin/env npx tsx
import 'dotenv/config';
/**
 * E2E Full Pipeline: Webhook → Orchestrator → Order Creator → Paper Executor → Trade
 *
 * 1. Sends webhooks (or uses signal IDs from last replay)
 * 2. Triggers process-queue (cron) to run orchestrator → order creator → paper executor
 * 3. Polls monitoring/orders until signals become trades (or timeout)
 *
 * Usage:
 *   BACKEND_TOKEN=xxx npx tsx scripts/run-e2e-full-pipeline.ts [options]
 *
 * Options:
 *   --url=<url>       Backend URL (default: https://optionsengines.fly.dev)
 *   --send            Send fresh webhooks first (default: use last replay report)
 *   --poll=<sec>      Poll interval seconds (default: 15)
 *   --max=<min>       Max wait minutes (default: 5)
 *   --cron-secret=    CRON_SECRET to trigger process-queue (optional)
 *
 * Env:
 *   BACKEND_URL, BACKEND_TOKEN or BACKEND_EMAIL/BACKEND_PASSWORD
 *   CRON_SECRET (optional, forces immediate pipeline run)
 */

import fs from 'fs/promises';
import path from 'path';

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.argv.find((a) => a.startsWith('--url='))?.slice(6) ||
  'https://optionsengines.fly.dev';
const SEND_WEBHOOKS = process.argv.includes('--send');
const POLL_SEC = Number(process.argv.find((a) => a.startsWith('--poll='))?.slice(7)) || 15;
const MAX_MIN = Number(process.argv.find((a) => a.startsWith('--max='))?.slice(6)) || 5;
const CRON_SECRET =
  process.env.CRON_SECRET || process.argv.find((a) => a.startsWith('--cron-secret='))?.slice(14) || '';

const REPORT_PATH = path.resolve(process.cwd(), 'tmp/e2e-replay-report.json');
const PAYLOADS_PATH = path.resolve(process.cwd(), 'tmp/e2e-webhook-payloads.json');

interface SignalTrack {
  signal_id: string;
  symbol: string;
  direction: string;
  status: 'pending' | 'processed' | 'rejected' | 'order' | 'filled' | 'unknown';
  experiment_id?: string;
  order_id?: string;
  rejection_reason?: string;
}

async function getAuthToken(): Promise<string | null> {
  const token = process.env.BACKEND_TOKEN || process.env.JWT_TOKEN;
  if (token) return token;

  const email = process.env.BACKEND_EMAIL;
  const password = process.env.BACKEND_PASSWORD;
  if (!email || !password) return null;

  const res = await fetch(`${BACKEND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { token?: string };
  return data?.token ?? null;
}

/** Unique payloads to avoid 60s duplicate window (symbol+direction+timeframe) */
const UNIQUE_PAYLOADS: Array<{ symbol: string; direction: string; timeframe: string }> = [
  { symbol: 'AAPL', direction: 'long', timeframe: '1m' },
  { symbol: 'MSFT', direction: 'short', timeframe: '5m' },
  { symbol: 'XLK', direction: 'long', timeframe: '15m' },
];
const FALLBACK_PAYLOADS: Array<{ symbol: string; direction: string; timeframe: string }> = [
  { symbol: 'NVDA', direction: 'long', timeframe: '30m' },
  { symbol: 'AMD', direction: 'short', timeframe: '4h' },
  { symbol: 'GOOGL', direction: 'long', timeframe: '1h' },
];

async function sendWebhooks(): Promise<{ signal_id: string; symbol: string; direction: string }[]> {
  let payloads: Array<{ symbol: string; direction: string; timeframe: string; timestamp: string }>;
  try {
    const raw = await fs.readFile(PAYLOADS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    payloads = Array.isArray(parsed) ? parsed : parsed.payloads ?? parsed.webhooks ?? [];
    if (payloads.length === 0) payloads = UNIQUE_PAYLOADS.map((p) => ({ ...p, timestamp: new Date().toISOString() }));
  } catch {
    payloads = UNIQUE_PAYLOADS.map((p) => ({ ...p, timestamp: new Date().toISOString() }));
  }

  const tryPayloads = (list: typeof UNIQUE_PAYLOADS): Promise<{ signal_id: string; symbol: string; direction: string }[]> => {
    const results: { signal_id: string; symbol: string; direction: string }[] = [];
    return (async () => {
      for (const p of list.slice(0, 3)) {
        const ts = new Date().toISOString();
        const payload = {
          symbol: p.symbol,
          direction: p.direction,
          timeframe: p.timeframe,
          timestamp: ts,
          is_test: true,
          metadata: { is_test: true, test_scenario: 'e2e-full-pipeline', run_id: Date.now() },
        };
        const res = await fetch(`${BACKEND_URL}/webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as { signal_id?: string; status?: string };
        if (data.signal_id && data.status === 'ACCEPTED') {
          results.push({ signal_id: data.signal_id, symbol: p.symbol, direction: p.direction });
          console.log(`  Webhook: ${p.symbol} ${p.direction} → ${data.signal_id} (ACCEPTED)`);
        } else if (data.status === 'DUPLICATE') {
          console.log(`  Webhook: ${p.symbol} ${p.direction} → DUPLICATE`);
        } else {
          console.log(`  Webhook: ${p.symbol} ${p.direction} → ${data.status ?? res.status}`);
        }
      }
      return results;
    })();
  };

  const toSend = payloads.length > 0 ? payloads : UNIQUE_PAYLOADS.map((p) => ({ ...p, timestamp: new Date().toISOString() }));
  let results = await tryPayloads(toSend);
  if (results.length === 0) {
    console.log('  Retrying with fallback symbols...');
    results = await tryPayloads(FALLBACK_PAYLOADS.map((p) => ({ ...p, timestamp: new Date().toISOString() })));
  }
  return results;
}

async function loadSignalIds(): Promise<{ signal_id: string; symbol: string; direction: string }[]> {
  try {
    const raw = await fs.readFile(REPORT_PATH, 'utf8');
    const data = JSON.parse(raw) as { results?: Array<{ signal_id?: string; symbol?: string; direction?: string }> };
    const results = (data.results ?? [])
      .filter((r) => r.signal_id)
      .map((r) => ({
        signal_id: r.signal_id!,
        symbol: r.symbol ?? '?',
        direction: r.direction ?? '?',
      }));
    return results;
  } catch {
    return [];
  }
}

async function triggerProcessQueue(): Promise<boolean> {
  if (!CRON_SECRET) return false;
  const res = await fetch(`${BACKEND_URL}/api/cron/process-queue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-cron-secret': CRON_SECRET,
      Authorization: `Bearer ${CRON_SECRET}`,
    },
  });
  const data = (await res.json()) as { ok?: boolean; skip?: boolean; results?: Record<string, number> };
  if (data.skip) {
    console.log('  Cron skipped (workers running)');
    return false;
  }
  if (data.ok && data.results) {
    console.log('  Process-queue:', data.results);
    return true;
  }
  return false;
}

async function fetchPipelineStatus(
  token: string,
  signalIds: string[]
): Promise<Map<string, SignalTrack>> {
  const map = new Map<string, SignalTrack>();

  const [monRes, ordersRes] = await Promise.all([
    fetch(`${BACKEND_URL}/monitoring/status?limit=50&testFilter=all`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    fetch(`${BACKEND_URL}/orders`, { headers: { Authorization: `Bearer ${token}` } }),
  ]);

  const monData = (await monRes.json()) as {
    pipeline?: {
      recent_signals?: Array<{ signal_id: string; status: string; symbol: string; direction: string }>;
      recent_rejections?: Array<{ signal_id: string; rejection_reason: string }>;
    };
    decision_engine?: { decision_log?: Array<{ signal_id: string; outcome: string }> };
  };
  const ordersData = (await ordersRes.json()) as {
    orders?: Array<{ signal_id: string; id: string; status: string }>;
    trades?: Array<{ signal_id: string; status: string }>;
  };

  const recentSignals = monData.pipeline?.recent_signals ?? [];
  const recentRejections = monData.pipeline?.recent_rejections ?? [];
  const decisionLog = monData.decision_engine?.decision_log ?? [];
  const orders = ordersData.orders ?? [];
  const trades = ordersData.trades ?? [];

  for (const sid of signalIds) {
    const sig = recentSignals.find((s) => s.signal_id === sid);
    const rej = recentRejections.find((r) => r.signal_id === sid);
    const dec = decisionLog.find((d) => d.signal_id === sid);
    const ord = orders.find((o: { signal_id: string }) => o.signal_id === sid);
    const trd = trades.find((t: { signal_id: string }) => t.signal_id === sid);

    let status: SignalTrack['status'] = 'unknown';
    if (trd?.status === 'filled') status = 'filled';
    else if (ord) status = ord.status === 'filled' ? 'filled' : 'order';
    else if (rej) status = 'rejected';
    else if (sig?.status === 'approved' || dec?.outcome === 'filled') status = 'processed';
    else if (sig?.status === 'rejected') status = 'rejected';
    else if (sig?.status === 'pending') status = 'pending';
    else if (sig) status = 'processed';

    map.set(sid, {
      signal_id: sid,
      symbol: sig?.symbol ?? ord?.symbol ?? '?',
      direction: sig?.direction ?? '?',
      status,
      rejection_reason: rej?.rejection_reason,
    });
  }
  return map;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function run(): Promise<void> {
  console.log('═'.repeat(70));
  console.log('  E2E Full Pipeline: Webhook → Orchestrator → Order → Trade');
  console.log('═'.repeat(70));
  console.log(`  Backend: ${BACKEND_URL}`);
  console.log(`  Poll:    ${POLL_SEC}s`);
  console.log(`  Max:     ${MAX_MIN} min`);
  console.log(`  Cron:    ${CRON_SECRET ? 'yes' : 'no'}`);
  console.log('═'.repeat(70));
  console.log('');

  let signals: { signal_id: string; symbol: string; direction: string }[];

  if (SEND_WEBHOOKS) {
    console.log('📤 Sending webhooks...');
    signals = await sendWebhooks();
    if (signals.length === 0) {
      console.error('No webhooks accepted.');
      process.exit(1);
    }
    console.log('');
  } else {
    signals = await loadSignalIds();
    if (signals.length === 0) {
      console.log('No signal IDs in report. Run with --send to send fresh webhooks.');
      process.exit(1);
    }
    console.log(`📋 Tracking ${signals.length} signals from last replay:\n`);
    for (const s of signals) {
      console.log(`   ${s.symbol} ${s.direction} → ${s.signal_id}`);
    }
    console.log('');
  }

  const token = await getAuthToken();
  if (!token) {
    console.error('❌ Set BACKEND_TOKEN or BACKEND_EMAIL/BACKEND_PASSWORD');
    process.exit(1);
  }

  if (CRON_SECRET) {
    console.log('🔄 Triggering process-queue...');
    await triggerProcessQueue();
    await sleep(5000);
    console.log('');
  }

  const signalIds = signals.map((s) => s.signal_id);
  const maxMs = MAX_MIN * 60 * 1000;
  const start = Date.now();
  let pollCount = 0;

  while (Date.now() - start < maxMs) {
    pollCount++;
    const status = await fetchPipelineStatus(token, signalIds);
    const rows = Array.from(status.values());

    console.log(`[Poll ${pollCount}] ${new Date().toLocaleTimeString()}`);
    for (const r of rows) {
      const icon =
        r.status === 'filled' ? '✅' : r.status === 'order' ? '📦' : r.status === 'rejected' ? '❌' : '⏳';
      console.log(`   ${icon} ${r.symbol} ${r.direction}: ${r.status}${r.rejection_reason ? ` (${r.rejection_reason})` : ''}`);
    }

    const filled = rows.filter((r) => r.status === 'filled').length;
    const rejected = rows.filter((r) => r.status === 'rejected').length;
    if (filled > 0 || rejected === rows.length) {
      console.log('');
      console.log('═'.repeat(70));
      console.log('  Result');
      console.log('═'.repeat(70));
      console.log(`  Filled:    ${filled}`);
      console.log(`  Rejected:  ${rejected}`);
      console.log(`  Pending:   ${rows.length - filled - rejected}`);
      console.log('═'.repeat(70));
      process.exit(rejected === rows.length && filled === 0 ? 1 : 0);
    }

    console.log(`   Next poll in ${POLL_SEC}s...\n`);
    await sleep(POLL_SEC * 1000);
  }

  console.log('');
  console.log('⏱️ Timeout. Some signals may still be processing.');
  process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
