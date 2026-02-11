import dotenv from 'dotenv';
import pg from 'pg';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

const { Pool } = pg;

const WEBHOOK_URL = process.env.WEBHOOK_REPLAY_URL || 'https://optionsengines.vercel.app/webhook';
const OVERRIDE_DATE = process.env.WEBHOOK_REPLAY_DATE || null;
const LIMIT = process.env.WEBHOOK_REPLAY_LIMIT ? Number(process.env.WEBHOOK_REPLAY_LIMIT) : null;
const CONCURRENCY = process.env.WEBHOOK_REPLAY_CONCURRENCY
  ? Math.max(1, Number(process.env.WEBHOOK_REPLAY_CONCURRENCY))
  : 5;

function formatDateLocal(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateOverride(value) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

async function loadWebhooks(pool, start, end) {
  const limitClause = LIMIT && LIMIT > 0 ? `LIMIT ${LIMIT}` : '';
  const result = await pool.query(
    `SELECT event_id, request_id, raw_payload
     FROM webhook_events
     WHERE created_at >= $1 AND created_at <= $2
       AND raw_payload IS NOT NULL
       AND COALESCE(is_test, false) = false
     ORDER BY created_at ASC
     ${limitClause}`,
    [start, end]
  );
  return result.rows;
}

function parsePayload(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

async function sendWebhook(payload) {
  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let data;
  try {
    data = await response.json();
  } catch {
    data = await response.text();
  }

  return { status: response.status, data };
}

async function run() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const now = new Date();
  const overrideStart = parseDateOverride(OVERRIDE_DATE);
  const start = overrideStart || new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = overrideStart
    ? new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999)
    : now;
  const reportDate = overrideStart ? formatDateLocal(overrideStart) : formatDateLocal(now);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const rows = await loadWebhooks(pool, start, end);

  const items = rows
    .map((row) => ({
      event_id: row.event_id,
      request_id: row.request_id,
      payload: parsePayload(row.raw_payload),
    }))
    .filter((row) => row.payload && typeof row.payload === 'object');

  let sent = 0;
  let accepted = 0;
  let rejected = 0;
  let failed = 0;

  const results = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }).map(async () => {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex];
      try {
        const response = await sendWebhook(item.payload);
        sent += 1;
        if (response.status >= 200 && response.status < 300) {
          accepted += 1;
        } else {
          rejected += 1;
        }
        results.push({
          event_id: item.event_id,
          request_id: item.request_id,
          status: response.status,
          response: response.data,
        });
      } catch (error) {
        failed += 1;
        results.push({
          event_id: item.event_id,
          request_id: item.request_id,
          status: 'error',
          response: error?.message || String(error),
        });
      }
    }
  });

  await Promise.all(workers);
  await pool.end();

  const outputDir = path.resolve(process.cwd(), 'tmp');
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `webhook-replay-${reportDate}.json`);
  await fs.writeFile(
    outputPath,
    JSON.stringify(
      {
        window_start: start.toISOString(),
        window_end: end.toISOString(),
        total_found: rows.length,
        total_replayed: items.length,
        sent,
        accepted,
        rejected,
        failed,
        results,
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`Replay completed. Found=${rows.length} replayed=${items.length}`);
  console.log(`Accepted=${accepted} rejected=${rejected} failed=${failed}`);
  console.log(`Saved report: ${outputPath}`);
}

run().catch((error) => {
  console.error('Replay failed', error);
  process.exit(1);
});
