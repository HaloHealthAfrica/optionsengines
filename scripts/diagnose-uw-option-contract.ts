#!/usr/bin/env npx tsx
/**
 * Unusual Whales Option Contract API Diagnostic
 *
 * Fetches option-contracts and prints raw response to inspect available fields
 * (strikes, Greeks, bid/ask, etc.).
 *
 * Usage:
 *   npx tsx scripts/diagnose-uw-option-contract.ts [TICKER]
 *   (Loads UNUSUAL_WHALES_API_KEY from .env)
 *
 * Or:
 *   UNUSUAL_WHALES_API_KEY=xxx npx tsx scripts/diagnose-uw-option-contract.ts SPY
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const BASE_URL = 'https://api.unusualwhales.com/api';
const TICKER = process.argv[2] || 'SPY';
const API_KEY = process.env.UNUSUAL_WHALES_API_KEY;

async function main() {
  console.log('# Unusual Whales Option Contract Diagnostic\n');
  console.log(`Ticker: ${TICKER}`);
  console.log(`API Key: ${API_KEY ? `${API_KEY.slice(0, 8)}...` : 'NOT SET'}\n`);

  if (!API_KEY) {
    console.error('ERROR: Set UNUSUAL_WHALES_API_KEY in environment');
    process.exit(1);
  }

  const url = `${BASE_URL}/stock/${encodeURIComponent(TICKER)}/option-contracts`;
  console.log(`GET ${url}\n`);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
    },
  });

  const raw = await res.text();
  console.log(`Status: ${res.status} ${res.ok ? 'OK' : 'FAIL'}\n`);

  if (!res.ok) {
    console.log('Response:', raw.slice(0, 500));
    process.exit(1);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    console.log('Invalid JSON:', raw.slice(0, 300));
    process.exit(1);
  }

  const payload = data as Record<string, unknown>;
  const items =
    payload?.data ?? payload?.result ?? payload?.contracts ?? payload?.options ?? payload;
  const arr = Array.isArray(items) ? items : [];

  console.log(`Total contracts: ${arr.length}\n`);

  if (arr.length === 0) {
    console.log('Top-level keys:', Object.keys(payload).join(', '));
    console.log('\nFull response (truncated):');
    console.log(JSON.stringify(payload, null, 2).slice(0, 1500));
    process.exit(0);
  }

  // Show first contract with ALL keys
  const first = arr[0] as Record<string, unknown>;
  console.log('## First contract - all keys');
  console.log(Object.keys(first).sort().join(', '));
  console.log('\n## First contract - full object');
  console.log(JSON.stringify(first, null, 2));

  // Show a call and a put if different
  const calls = arr.filter((r: Record<string, unknown>) =>
    ['call', 'C', 'CALL'].includes(String(r.option_type ?? r.type ?? r.side ?? ''))
  );
  const puts = arr.filter((r: Record<string, unknown>) =>
    ['put', 'P', 'PUT'].includes(String(r.option_type ?? r.type ?? r.side ?? ''))
  );

  if (calls.length > 0 && puts.length > 0) {
    const sampleCall = calls[0] as Record<string, unknown>;
    const samplePut = puts[0] as Record<string, unknown>;
    console.log('\n## Sample CALL contract keys:', Object.keys(sampleCall).sort().join(', '));
    console.log('\n## Sample PUT contract keys:', Object.keys(samplePut).sort().join(', '));

    // Check for Greeks
    const greekKeys = ['delta', 'gamma', 'theta', 'vega', 'iv', 'implied_volatility', 'greeks'];
    for (const g of greekKeys) {
      if (g in sampleCall || g in samplePut) {
        console.log(`\n## Greeks found: ${g}`);
        console.log('  Call:', (sampleCall as Record<string, unknown>)[g]);
        console.log('  Put:', (samplePut as Record<string, unknown>)[g]);
      }
    }
  }

  console.log('\n---');
  console.log('Docs: https://api.unusualwhales.com/docs');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
