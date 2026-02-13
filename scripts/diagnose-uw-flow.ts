#!/usr/bin/env npx tsx
import 'dotenv/config';
/**
 * Diagnose Unusual Whales Options Flow - Why is Netflow $0?
 *
 * Checks:
 * 1. UW option-contracts response (volume field - do contracts have volume?)
 * 2. UW net-prem-ticks (proper flow endpoint - do we use it?)
 * 3. Circuit breaker status (if backend is running)
 *
 * Usage:
 *   UNUSUAL_WHALES_API_KEY=xxx npx tsx scripts/diagnose-uw-flow.ts [TICKER]
 *
 * Example:
 *   UNUSUAL_WHALES_API_KEY=xxx npx tsx scripts/diagnose-uw-flow.ts SPY
 */

const BASE_URL = 'https://api.unusualwhales.com/api';
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

function extractContractsArray(payload: Record<string, unknown>): Record<string, unknown>[] {
  const data = payload?.data ?? payload?.result ?? payload?.contracts ?? payload;
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const items = (data as Record<string, unknown>).options ?? (data as Record<string, unknown>).contracts;
    if (Array.isArray(items)) return items as Record<string, unknown>[];
  }
  return [];
}

async function main() {
  console.log('# Unusual Whales Flow Diagnostic\n');
  console.log(`Ticker: ${TICKER}\n`);

  if (!API_KEY) {
    console.error('ERROR: UNUSUAL_WHALES_API_KEY must be set');
    process.exit(1);
  }

  try {
    // 1. Option contracts (what we currently use for "flow")
    console.log('## 1. Option Contracts (current flow source)\n');
    console.log('   Endpoint: GET /stock/:ticker/option-contracts');
    console.log('   Our getOptionsFlow derives flow from chain contracts with volume > 0.\n');

    try {
      const contractsUrl = `${BASE_URL}/stock/${TICKER}/option-contracts`;
      const contractsPayload = (await fetchJson(contractsUrl)) as Record<string, unknown>;
      const contracts = extractContractsArray(contractsPayload);

      console.log(`   Contracts returned: ${contracts.length}`);

      if (contracts.length > 0) {
        const withVolume = contracts.filter((c) => {
          const v = c.volume ?? c.vol;
          return v != null && Number(v) > 0;
        });
        console.log(`   Contracts with volume > 0: ${withVolume.length}`);

        const first = contracts[0] as Record<string, unknown>;
        const volKeys = Object.keys(first).filter((k) => k.toLowerCase().includes('vol'));
        console.log(`   Volume-related keys in first contract: ${volKeys.join(', ') || 'NONE'}`);
        console.log(`   First contract volume: ${first.volume ?? first.vol ?? 'undefined'}`);

        if (withVolume.length === 0) {
          console.log('\n   *** ROOT CAUSE: Option chain has NO contracts with volume > 0 ***');
          console.log('   Option chain APIs typically return OI (open interest), not trade volume.');
          console.log('   Our code filters .filter(c => c.volume != null && c.volume > 0) - all get filtered out.\n');
        }
      } else {
        console.log('   *** No contracts returned - check API response structure ***');
      }
    } catch (e) {
      console.log('   Option-contracts request failed:', (e as Error).message);
      console.log('   (404 may mean wrong path or plan does not include this endpoint)\n');
    }

    // 2. Net premium ticks (proper flow endpoint - NOT currently used)
    console.log('\n## 2. Net Premium Ticks (proper flow endpoint - NOT used by our code)\n');
    console.log('   Endpoint: GET /stock/:ticker/net-prem-ticks');
    console.log('   This returns call/put volume and premium - ideal for netflow.\n');

    try {
      const today = new Date().toISOString().slice(0, 10);
      const netPremUrl = `${BASE_URL}/stock/${TICKER}/net-prem-ticks?date=${today}`;
      const netPremPayload = (await fetchJson(netPremUrl)) as Record<string, unknown>;
      console.log('   Raw top-level keys:', Object.keys(netPremPayload).join(', '));
      const ticks = (netPremPayload?.data ?? netPremPayload?.ticks ?? netPremPayload) as unknown[];
      const arr = Array.isArray(ticks) ? ticks : [];

      console.log(`   Net-prem-ticks returned: ${arr.length} ticks`);

      if (arr.length > 0) {
        const last = arr[arr.length - 1] as Record<string, unknown>;
        console.log('   Sample tick keys:', Object.keys(last).join(', '));
        console.log('   Sample tick:', JSON.stringify(last, null, 2).slice(0, 500) + '...');
      }
    } catch (e) {
      console.log('   Net-prem-ticks request failed:', (e as Error).message);
    }

    // 2b. Flow-per-strike-intraday
    console.log('\n## 2b. Flow Per Strike Intraday\n');
    try {
      const today = new Date().toISOString().slice(0, 10);
      const flowUrl = `${BASE_URL}/stock/${TICKER}/flow-per-strike-intraday?date=${today}`;
      const flowPayload = (await fetchJson(flowUrl)) as Record<string, unknown>;
      const rows = (flowPayload?.data ?? flowPayload?.result ?? flowPayload) as unknown[];
      const arr = Array.isArray(rows) ? rows : [];
      console.log(`   Flow-per-strike-intraday returned: ${arr.length} rows`);
      if (arr.length > 0) {
        const first = arr[0] as Record<string, unknown>;
        console.log('   Sample row keys:', Object.keys(first).join(', '));
      }
    } catch (e) {
      console.log('   Flow-per-strike-intraday failed:', (e as Error).message);
    }

    // 3. Flow alerts
    console.log('\n## 3. Flow Alerts\n');
    console.log('   Endpoint: GET /option-trades/flow-alerts');
    console.log('   Returns recent flow alerts - we have getFlowAlerts() but do not use it for Flow page.\n');

    try {
      const alertsUrl = `${BASE_URL}/option-trades/flow-alerts`;
      const alertsPayload = (await fetchJson(alertsUrl)) as Record<string, unknown>;
      const data = alertsPayload?.data ?? alertsPayload?.result ?? alertsPayload;
      const alerts = Array.isArray(data) ? data : (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).alerts))
        ? ((data as Record<string, unknown>).alerts as unknown[])
        : [];
      console.log(`   Flow alerts returned: ${alerts.length}`);
    } catch (e) {
      console.log('   Flow-alerts request failed:', (e as Error).message);
    }

    // 4. Circuit breaker
    console.log('\n## 4. Circuit Breaker\n');
    console.log('   To check if unusualwhales circuit breaker is open:');
    console.log('   - Start the backend and call GET /monitoring/status (with auth)');
    console.log('   - Response includes circuit_breakers with state (closed|open|half-open)');
    console.log('   - If open: 5+ failures occurred; resets after 60s (half-open)\n');

    console.log('Done.');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
