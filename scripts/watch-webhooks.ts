/**
 * Watch incoming webhooks in real-time - polls webhook_events and prints new entries.
 * Useful after DB reset to see where webhooks break.
 *
 * Usage: npx tsx scripts/watch-webhooks.ts [--interval 2] [--limit 20]
 */

import { db } from '../src/services/database.service.js';

const intervalSec = process.argv.includes('--interval')
  ? Number(process.argv[process.argv.indexOf('--interval') + 1]) || 2
  : 2;
const limit = process.argv.includes('--limit')
  ? Number(process.argv[process.argv.indexOf('--limit') + 1]) || 20
  : 20;

function statusEmoji(status: string): string {
  switch (status) {
    case 'accepted': return '✅';
    case 'duplicate': return '🔄';
    case 'invalid_signature': return '🔐';
    case 'invalid_payload': return '❌';
    case 'error': return '💥';
    default: return '❓';
  }
}

async function poll() {
  const result = await db.query(
    `SELECT event_id, request_id, signal_id, status, error_message,
            symbol, direction, timeframe, processing_time_ms, created_at
     FROM webhook_events
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );

  const rows = result.rows as Array<{
    event_id: string;
    request_id: string;
    signal_id: string | null;
    status: string;
    error_message: string | null;
    symbol: string | null;
    direction: string | null;
    timeframe: string | null;
    processing_time_ms: number | null;
    created_at: Date;
  }>;

  if (rows.length === 0) {
    console.log(`[${new Date().toISOString()}] No webhooks yet. Waiting...`);
    return;
  }

  console.clear();
  console.log('═'.repeat(80));
  console.log(`WEBHOOK WATCH (last ${limit} events) — ${new Date().toISOString()}`);
  console.log('═'.repeat(80));

  for (const r of rows) {
    const emoji = statusEmoji(r.status);
    const time = new Date(r.created_at).toISOString();
    const meta = [r.symbol, r.direction, r.timeframe].filter(Boolean).join(' ');
    const err = r.error_message ? ` — ${r.error_message}` : '';
    const ms = r.processing_time_ms != null ? ` (${r.processing_time_ms}ms)` : '';
    console.log(`${emoji} ${time} | ${r.status.padEnd(18)} | ${meta || '-'}${ms}${err}`);
    if (r.status !== 'accepted' && r.status !== 'duplicate' && r.error_message) {
      console.log(`   request_id: ${r.request_id} — trace: npx tsx scripts/trace-webhooks.ts ${r.request_id}`);
    }
  }

  const summary = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log('\n' + '-'.repeat(80));
  console.log('Summary:', summary);
  console.log('Press Ctrl+C to stop.\n');
}

async function main() {
  console.log(`Watching webhook_events every ${intervalSec}s (limit ${limit})\n`);
  await poll();
  setInterval(poll, intervalSec * 1000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
