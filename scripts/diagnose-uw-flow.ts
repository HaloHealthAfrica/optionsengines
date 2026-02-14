#!/usr/bin/env npx tsx
/**
 * Unusual Whales Flow API Diagnostic
 *
 * Tests net-prem-ticks, flow-per-strike-intraday, and option-contracts endpoints
 * to diagnose why Flow page shows unusualwhales_returned_empty.
 *
 * Usage:
 *   UNUSUAL_WHALES_API_KEY=your_key npx tsx scripts/diagnose-uw-flow.ts [TICKER] [DATE]
 *
 * Examples:
 *   UNUSUAL_WHALES_API_KEY=xxx npx tsx scripts/diagnose-uw-flow.ts SPY
 *   UNUSUAL_WHALES_API_KEY=xxx npx tsx scripts/diagnose-uw-flow.ts QQQ 2025-02-13
 */

const BASE_URL = 'https://api.unusualwhales.com/api';
const TICKER = process.argv[2] || 'SPY';
const DATE = process.argv[3] || new Date().toISOString().slice(0, 10);
const API_KEY = process.env.UNUSUAL_WHALES_API_KEY;

async function fetchJson(url: string): Promise<{ status: number; ok: boolean; data: unknown; raw: string }> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
    },
  });
  const raw = await res.text();
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  return { status: res.status, ok: res.ok, data, raw: raw.slice(0, 500) };
}

async function main() {
  console.log('# Unusual Whales Flow API Diagnostic\n');
  console.log(`Ticker: ${TICKER}`);
  console.log(`Date: ${DATE}`);
  console.log(`API Key: ${API_KEY ? `${API_KEY.slice(0, 8)}...` : 'NOT SET'}\n`);

  if (!API_KEY) {
    console.error('ERROR: Set UNUSUAL_WHALES_API_KEY in environment');
    process.exit(1);
  }

  // 1. net-prem-ticks (primary for Flow)
  console.log('## 1. GET /stock/:ticker/net-prem-ticks?date=...\n');
  const nptUrl = `${BASE_URL}/stock/${encodeURIComponent(TICKER)}/net-prem-ticks?date=${DATE}`;
  const npt = await fetchJson(nptUrl);
  console.log(`Status: ${npt.status} ${npt.ok ? 'OK' : 'FAIL'}`);
  if (!npt.ok) {
    console.log(`Response: ${npt.raw}`);
  } else if (npt.data && typeof npt.data === 'object') {
    const payload = npt.data as Record<string, unknown>;
    const data = payload?.data ?? payload?.ticks ?? payload?.result ?? payload;
    const arr = Array.isArray(data) ? data : [];
    console.log(`Records: ${arr.length}`);
    if (arr.length > 0) {
      const first = arr[0] as Record<string, unknown>;
      console.log('First record keys:', Object.keys(first).join(', '));
      console.log('Sample:', JSON.stringify(first, null, 2).slice(0, 400) + '...');
    } else {
      console.log('Empty data. Possible causes: weekend/holiday, outside market hours, or plan does not include net-prem-ticks.');
    }
  }
  console.log('');

  // 2. flow-per-strike-intraday (fallback)
  console.log('## 2. GET /stock/:ticker/flow-per-strike-intraday?date=...\n');
  const fpsUrl = `${BASE_URL}/stock/${encodeURIComponent(TICKER)}/flow-per-strike-intraday?date=${DATE}`;
  const fps = await fetchJson(fpsUrl);
  console.log(`Status: ${fps.status} ${fps.ok ? 'OK' : 'FAIL'}`);
  if (!fps.ok) {
    console.log(`Response: ${fps.raw}`);
  } else if (fps.data && typeof fps.data === 'object') {
    const payload = fps.data as Record<string, unknown>;
    const data = payload?.data ?? payload?.result ?? payload;
    const arr = Array.isArray(data) ? data : [];
    console.log(`Records: ${arr.length}`);
    if (arr.length > 0) {
      const first = arr[0] as Record<string, unknown>;
      console.log('First record keys:', Object.keys(first).join(', '));
    }
  }
  console.log('');

  // 3. option-contracts (fallback for chain-based flow)
  console.log('## 3. GET /stock/:ticker/option-contracts\n');
  const ocUrl = `${BASE_URL}/stock/${encodeURIComponent(TICKER)}/option-contracts`;
  const oc = await fetchJson(ocUrl);
  console.log(`Status: ${oc.status} ${oc.ok ? 'OK' : 'FAIL'}`);
  if (!oc.ok) {
    console.log(`Response: ${oc.raw}`);
  } else if (oc.data && typeof oc.data === 'object') {
    const payload = oc.data as Record<string, unknown>;
    const data = payload?.data ?? payload?.result ?? payload?.contracts ?? payload;
    const arr = Array.isArray(data) ? data : [];
    const withVol = arr.filter((r: Record<string, unknown>) => (Number(r.volume ?? r.vol ?? 0) || 0) > 0);
    console.log(`Contracts: ${arr.length}, with volume>0: ${withVol.length}`);
  }
  console.log('');

  // Summary
  console.log('## Summary\n');
  const nptData = (npt.data as Record<string, unknown>)?.data ?? (npt.data as Record<string, unknown>)?.ticks;
  const nptCount = Array.isArray(nptData) ? nptData.length : 0;
  if (!npt.ok) {
    console.log('- net-prem-ticks failed (check API key, plan, date format)');
  } else if (nptCount === 0) {
    console.log('- net-prem-ticks returned empty. Try a recent trading day (e.g. last Friday).');
    console.log('- Weekend/holiday has no intraday data.');
  } else {
    console.log('- net-prem-ticks OK');
  }
  console.log('\nDocs: https://api.unusualwhales.com/docs');
  console.log('Plans: https://unusualwhales.com/public-api');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
