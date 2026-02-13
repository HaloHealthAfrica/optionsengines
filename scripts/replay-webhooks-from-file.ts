#!/usr/bin/env tsx
/**
 * Replay webhooks from a JSON file to a target URL.
 * Use for local E2E testing with Sentry - start server, run this, observe webhook ingestion.
 *
 * Usage:
 *   npx tsx scripts/replay-webhooks-from-file.ts [--file=path] [--url=URL] [--limit=N]
 *
 * Env:
 *   WEBHOOK_REPLAY_URL  - target URL (default: http://localhost:8080/webhook)
 *   WEBHOOK_REPLAY_FILE - path to JSON with payloads array
 *   WEBHOOK_REPLAY_LIMIT - max payloads to send (default: 10)
 */

import fs from 'fs/promises';
import path from 'path';

function parseArgs() {
  const args = process.argv.slice(2);
  let url = process.env.WEBHOOK_REPLAY_URL || 'http://localhost:8080/webhook';
  let filePath = process.env.WEBHOOK_REPLAY_FILE || path.resolve(process.cwd(), 'tmp/webhook-replay-payloads.json');
  let limit = process.env.WEBHOOK_REPLAY_LIMIT ? Math.max(1, Number(process.env.WEBHOOK_REPLAY_LIMIT)) : 10;
  for (const arg of args) {
    if (arg.startsWith('--url=')) url = arg.slice(6);
    else if (arg.startsWith('--file=')) filePath = arg.slice(7);
    else if (arg.startsWith('--limit=')) limit = Math.max(1, Number(arg.slice(8)));
  }
  return { url, filePath, limit };
}
const { url: WEBHOOK_URL, filePath: FILE_PATH, limit: LIMIT } = parseArgs();

interface WebhookPayload {
  symbol: string;
  direction: 'long' | 'short';
  timeframe: string;
  timestamp: string;
  [key: string]: unknown;
}

function buildSyntheticPayloads(count: number): WebhookPayload[] {
  const symbols = ['SPY', 'QQQ', 'IWM'];
  const timeframes = ['1m', '5m', '15m'];
  const directions: Array<'long' | 'short'> = ['long', 'short'];
  const payloads: WebhookPayload[] = [];
  const base = Date.now();

  for (let i = 0; i < count; i++) {
    const s = symbols[i % symbols.length];
    const t = timeframes[i % timeframes.length];
    const d = directions[i % directions.length];
    payloads.push({
      symbol: s,
      direction: d,
      timeframe: t,
      timestamp: new Date(base + i * 1000).toISOString(),
    });
  }
  return payloads;
}

async function loadPayloads(): Promise<WebhookPayload[]> {
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf8');
    const data = JSON.parse(raw);
    const arr = Array.isArray(data) ? data : data.payloads ?? data.results ?? [];
    const payloads = arr
      .filter((p: unknown) => p && typeof p === 'object')
      .map((p: Record<string, unknown>) => ({
        symbol: String(p.symbol ?? 'SPY'),
        direction: (p.direction as 'long' | 'short') || 'long',
        timeframe: String(p.timeframe ?? '5m'),
        timestamp: String(p.timestamp ?? new Date().toISOString()),
        ...p,
      })) as WebhookPayload[];
    return payloads.length > 0 ? payloads : buildSyntheticPayloads(LIMIT);
  } catch {
    console.log(`File not found or invalid: ${FILE_PATH}. Using synthetic payloads.`);
    return buildSyntheticPayloads(LIMIT);
  }
}

async function sendWebhook(payload: WebhookPayload): Promise<{ status: number; data: unknown }> {
  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function run() {
  console.log('Replay webhooks from file');
  console.log(`  URL: ${WEBHOOK_URL}`);
  console.log(`  File: ${FILE_PATH}`);
  console.log(`  Limit: ${LIMIT}\n`);

  const all = await loadPayloads();
  const payloads = all.slice(0, LIMIT);

  let sent = 0;
  let accepted = 0;
  let rejected = 0;
  let failed = 0;

  for (let i = 0; i < payloads.length; i++) {
    const p = payloads[i];
    try {
      const { status, data } = await sendWebhook(p);
      sent++;
      if (status >= 200 && status < 300) {
        accepted++;
        const statusStr = (data as any)?.status ?? status;
        const signalId = (data as any)?.signal_id ?? '-';
        console.log(`  [${i + 1}/${payloads.length}] ${p.symbol} ${p.direction} ${p.timeframe} -> ${statusStr} (${signalId})`);
      } else {
        rejected++;
        const err = (data as any)?.error ?? (data as any)?.message ?? status;
        console.log(`  [${i + 1}/${payloads.length}] ${p.symbol} ${p.direction} ${p.timeframe} -> REJECTED: ${err}`);
      }
    } catch (e: any) {
      failed++;
      console.log(`  [${i + 1}/${payloads.length}] ${p.symbol} ${p.direction} ${p.timeframe} -> ERROR: ${e?.message ?? e}`);
    }
  }

  console.log('\n---');
  console.log(`Sent: ${sent} | Accepted: ${accepted} | Rejected: ${rejected} | Failed: ${failed}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
