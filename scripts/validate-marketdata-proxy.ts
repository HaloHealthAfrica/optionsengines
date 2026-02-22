#!/usr/bin/env npx tsx
/**
 * Validate MarketData.app proxy integration.
 * Cycles through various API calls every 10s to confirm the proxy works
 * and the columnar response parsing is correct.
 *
 * Usage: npx tsx scripts/validate-marketdata-proxy.ts [rounds]
 *   rounds = number of 10s rounds to run (default: 6 = 60s)
 */

import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = process.env.MARKETDATA_BASE_URL || 'https://proxyip.fly.dev';
const API_KEY = process.env.MARKET_DATA_API_KEY || process.env.MARKETDATA_API_KEY || '';
const ROUNDS = parseInt(process.argv[2] || '6', 10);

if (!API_KEY) {
  console.error('ERROR: MARKET_DATA_API_KEY not set');
  process.exit(1);
}

interface TestCase {
  name: string;
  endpoint: string;
  validate: (status: number, json: any) => string;
}

const tests: TestCase[] = [
  {
    name: 'SPY Quote',
    endpoint: '/v1/stocks/quotes/SPY/',
    validate: (status, json) => {
      if (status === 203 || status === 200) {
        const bid = json.bid?.[0];
        const ask = json.ask?.[0];
        return bid != null ? `OK bid=${bid} ask=${ask}` : `WARN: no bid/ask in response`;
      }
      return `HTTP ${status}`;
    },
  },
  {
    name: 'AAPL Quote',
    endpoint: '/v1/stocks/quotes/AAPL/',
    validate: (status, json) => {
      if (status === 203 || status === 200) {
        const last = json.last?.[0];
        return last != null ? `OK last=${last}` : `WARN: no last price`;
      }
      return `HTTP ${status}`;
    },
  },
  {
    name: 'SPY Options Chain',
    endpoint: '/v1/options/chain/SPY/?expiration=2026-03-20&side=call&strikeLimit=5',
    validate: (status, json) => {
      if (status === 203 || status === 200) {
        if (Array.isArray(json.optionSymbol)) {
          const count = json.optionSymbol.length;
          const hasGamma = json.gamma ? json.gamma.filter((g: number) => g != null && g !== 0).length : 0;
          const hasOI = json.openInterest ? json.openInterest.filter((o: number) => o != null && o !== 0).length : 0;
          return `OK columnar rows=${count} gamma=${hasGamma} OI=${hasOI}`;
        }
        return `WARN: not columnar format, keys: ${Object.keys(json).join(',')}`;
      }
      if (status === 404 && json?.s === 'no_data') return 'OK (no_data)';
      return `HTTP ${status}`;
    },
  },
  {
    name: 'SPY Candles (5m)',
    endpoint: `/v1/stocks/candles/5/SPY/?from=${Math.floor(Date.now() / 1000) - 3600}&to=${Math.floor(Date.now() / 1000)}`,
    validate: (status, json) => {
      if (status === 203 || status === 200) {
        const count = json.t?.length ?? 0;
        return count > 0 ? `OK candles=${count} last_close=${json.c?.[count - 1]}` : 'WARN: 0 candles';
      }
      return `HTTP ${status}`;
    },
  },
  {
    name: 'QQQ Quote',
    endpoint: '/v1/stocks/quotes/QQQ/',
    validate: (status, json) => {
      if (status === 203 || status === 200) {
        const mid = json.mid?.[0];
        return mid != null ? `OK mid=${mid}` : `WARN: no mid price`;
      }
      return `HTTP ${status}`;
    },
  },
  {
    name: 'AAPL Options Chain',
    endpoint: '/v1/options/chain/AAPL/?expiration=2026-03-20&side=put&strikeLimit=5',
    validate: (status, json) => {
      if (status === 203 || status === 200) {
        if (Array.isArray(json.optionSymbol)) {
          const count = json.optionSymbol.length;
          return `OK columnar rows=${count}`;
        }
        return `WARN: not columnar, keys: ${Object.keys(json).join(',')}`;
      }
      if (status === 404 && json?.s === 'no_data') return 'OK (no_data)';
      return `HTTP ${status}`;
    },
  },
];

async function runTest(test: TestCase): Promise<{ name: string; result: string; ms: number }> {
  const url = `${BASE_URL}${test.endpoint}`;
  const start = Date.now();
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const text = await res.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    const result = test.validate(res.status, json);
    return { name: test.name, result, ms: Date.now() - start };
  } catch (err: any) {
    return { name: test.name, result: `ERR: ${err.message}`, ms: Date.now() - start };
  }
}

async function main() {
  console.log(`\n=== MarketData.app Proxy Validation ===`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Rounds:   ${ROUNDS} (every 10s)\n`);

  let passed = 0;
  let failed = 0;

  for (let round = 1; round <= ROUNDS; round++) {
    const test = tests[(round - 1) % tests.length];
    const timestamp = new Date().toLocaleTimeString();

    const { name, result, ms } = await runTest(test);
    const ok = result.startsWith('OK');
    if (ok) passed++; else failed++;

    const icon = ok ? 'PASS' : 'FAIL';
    console.log(`[${timestamp}] Round ${round}/${ROUNDS} | ${icon} | ${name} | ${result} | ${ms}ms`);

    if (round < ROUNDS) {
      await new Promise(r => setTimeout(r, 10_000));
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Passed: ${passed}/${passed + failed}`);
  console.log(`Failed: ${failed}/${passed + failed}`);
  if (failed === 0) {
    console.log(`All calls through ${BASE_URL} succeeded — proxy integration verified.\n`);
  } else {
    console.log(`Some calls failed — check results above.\n`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
