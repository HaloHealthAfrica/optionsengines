#!/usr/bin/env npx ts-node
/**
 * Unusual Whales API Schema Verification
 *
 * Fetches sample responses from the Unusual Whales Options API and prints
 * the top-level structure for schema verification.
 *
 * Requires: UNUSUAL_WHALES_API_KEY in environment
 *
 * Usage:
 *   UNUSUAL_WHALES_API_KEY=your_key npx tsx scripts/verify-unusual-whales-schema.ts [TICKER]
 *
 * Example:
 *   UNUSUAL_WHALES_API_KEY=xxx npx tsx scripts/verify-unusual-whales-schema.ts SPY
 */

const BASE_URL = 'https://api.unusualwhales.com';
const TICKER = process.argv[2] || 'SPY';
const API_KEY = process.env.UNUSUAL_WHALES_API_KEY;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  if (!API_KEY) {
    console.error('ERROR: UNUSUAL_WHALES_API_KEY must be set');
    process.exit(1);
  }

  console.log('# Unusual Whales API Schema Verification\n');
  console.log(`Ticker: ${TICKER}\n`);

  try {
    // 1. Option contracts
    console.log('## 1. GET /stock/:ticker/option-contracts\n');
    const contractsUrl = `${BASE_URL}/stock/${TICKER}/option-contracts`;
    const contractsPayload = await fetchJson(contractsUrl) as Record<string, unknown>;
    console.log('Top-level keys:', Object.keys(contractsPayload).join(', '));

    const data = contractsPayload?.data ?? contractsPayload?.result ?? contractsPayload?.contracts ?? contractsPayload;
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0] as Record<string, unknown>;
      console.log('First contract keys:', Object.keys(first).join(', '));
      console.log('First contract sample:', JSON.stringify(first, null, 2).slice(0, 800) + '...');
    } else if (data && typeof data === 'object' && !Array.isArray(data)) {
      const items = (data as Record<string, unknown>).options ?? (data as Record<string, unknown>).contracts;
      if (Array.isArray(items) && items.length > 0) {
        const first = items[0] as Record<string, unknown>;
        console.log('First contract keys:', Object.keys(first).join(', '));
      }
    }
    console.log('');

    // 2. Option contract by ID (if we have one)
    const contractId = Array.isArray(data) && data.length > 0
      ? String((data[0] as Record<string, unknown>).id ?? (data[0] as Record<string, unknown>).contract_id ?? '')
      : null;

    if (contractId) {
      console.log('## 2. GET /option-contract/:id\n');
      const contractUrl = `${BASE_URL}/option-contract/${contractId}`;
      const contractPayload = await fetchJson(contractUrl) as Record<string, unknown>;
      console.log('Top-level keys:', Object.keys(contractPayload).join(', '));
      const single = contractPayload?.data ?? contractPayload?.result ?? contractPayload;
      if (single && typeof single === 'object' && !Array.isArray(single)) {
        console.log('Contract keys:', Object.keys(single as Record<string, unknown>).join(', '));
      }
      console.log('');

      // 3. Intraday
      const today = new Date().toISOString().slice(0, 10);
      console.log('## 3. GET /option-contract/:id/intraday?date=YYYY-MM-DD\n');
      const intradayUrl = `${BASE_URL}/option-contract/${contractId}/intraday?date=${today}`;
      const intradayPayload = await fetchJson(intradayUrl) as Record<string, unknown>;
      console.log('Top-level keys:', Object.keys(intradayPayload).join(', '));
      const ticks = intradayPayload?.data ?? intradayPayload?.result ?? intradayPayload?.ticks ?? intradayPayload;
      if (Array.isArray(ticks) && ticks.length > 0) {
        const firstTick = ticks[0] as Record<string, unknown>;
        console.log('First tick keys:', Object.keys(firstTick).join(', '));
      }
    } else {
      console.log('## 2 & 3. Skipped (no contract id from option-contracts)\n');
    }

    console.log('\nDone. Update tmp/UNUSUAL_WHALES_API_RESPONSE_SCHEMAS.md if structures differ.');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
