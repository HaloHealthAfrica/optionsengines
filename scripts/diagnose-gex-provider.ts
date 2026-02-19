#!/usr/bin/env npx ts-node
/**
 * Phase 1: Gamma Provider Validation
 * Calls GEX providers directly and reports raw responses.
 * Isolates provider vs ingestion.
 *
 * Usage: npx tsx scripts/diagnose-gex-provider.ts [SPY]
 * Requires: DATABASE_URL, UNUSUAL_WHALES_API_KEY (optional), MARKET_DATA_API_KEY (optional)
 */

import dotenv from 'dotenv';
dotenv.config();

const SYMBOL = process.argv[2] || 'SPY';

async function main() {
  console.log(`\n=== GEX Provider Diagnostic: ${SYMBOL} ===\n`);

  const uwKey = process.env.UNUSUAL_WHALES_API_KEY;
  const mdKey = process.env.MARKET_DATA_API_KEY || process.env.MARKETDATA_API_KEY;

  // 1. Unusual Whales Gamma API (direct)
  if (uwKey) {
    const url = `https://api.unusualwhales.com/api/stock/${encodeURIComponent(SYMBOL)}/greek-exposure/strike`;
    console.log('1. Unusual Whales Gamma API (raw)');
    console.log(`   URL: ${url}`);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${uwKey}`, Accept: 'application/json' },
      });
      const json = (await res.json()) as Record<string, unknown>;
      const data = (json?.data ?? json?.result ?? json) as Record<string, unknown>;
      const netGamma = data?.net_gamma ?? data?.netGamma ?? data?.net_gex ?? data?.netGex;
      console.log(`   Status: ${res.status}`);
      console.log(`   net_gamma / net_gex: ${JSON.stringify(netGamma)}`);
      console.log(`   gamma_flip: ${JSON.stringify(data?.gamma_flip ?? data?.zeroGammaLevel)}`);
      console.log(`   call_gamma: ${JSON.stringify(data?.call_gamma ?? data?.callGamma)}`);
      console.log(`   put_gamma: ${JSON.stringify(data?.put_gamma ?? data?.putGamma)}`);
      if (Object.keys(data || {}).length < 5) {
        console.log(`   Full data: ${JSON.stringify(data, null, 2).slice(0, 500)}...`);
      }
    } catch (e) {
      console.log(`   ERROR: ${e}`);
    }
    console.log('');
  } else {
    console.log('1. Unusual Whales: SKIP (UNUSUAL_WHALES_API_KEY not set)\n');
  }

  // 2. MarketData.app options chain (used for GEX computation)
  if (mdKey) {
    console.log('2. MarketData.app options chain (gamma + openInterest for GEX)');
    const url = `https://api.marketdata.app/v1/options/chain/${SYMBOL}`;
    console.log(`   URL: ${url}`);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${mdKey}` },
      });
      const json = (await res.json()) as Record<string, unknown>;
      const rows = (json?.data ?? json?.options ?? json) as unknown[];
      const arr = Array.isArray(rows) ? rows : [];
      const withGamma = arr.filter((r: any) => r?.gamma != null || r?.greek_gamma != null || r?.greeks?.gamma != null);
      const withOI = arr.filter((r: any) => r?.open_interest != null || r?.oi != null || r?.openInterest != null);
      const sample = arr[0] as Record<string, unknown> | undefined;
      console.log(`   Status: ${res.status}`);
      console.log(`   Rows: ${arr.length}`);
      console.log(`   With gamma: ${withGamma.length}`);
      console.log(`   With openInterest: ${withOI.length}`);
      if (sample) {
        console.log(`   Sample keys: ${Object.keys(sample).join(', ')}`);
        console.log(`   Sample gamma: ${JSON.stringify(sample.gamma ?? sample.greek_gamma ?? sample.greeks)}`);
        console.log(`   Sample OI: ${JSON.stringify(sample.open_interest ?? sample.oi ?? sample.openInterest)}`);
      }
    } catch (e) {
      console.log(`   ERROR: ${e}`);
    }
    console.log('');
  } else {
    console.log('2. MarketData.app: SKIP (MARKET_DATA_API_KEY / MARKETDATA_API_KEY not set)\n');
  }

  // 3. Positioning service (full pipeline)
  console.log('3. Positioning service (getGexSnapshot)');
  try {
    const { positioningService } = await import('../src/services/positioning.service.js');
    const gex = await positioningService.getGexSnapshot(SYMBOL);
    const d = gex as Record<string, unknown>;
    console.log(`   netGex: ${d?.netGex}`);
    console.log(`   totalCallGex: ${d?.totalCallGex}`);
    console.log(`   totalPutGex: ${d?.totalPutGex}`);
    console.log(`   dealerPosition: ${d?.dealerPosition}`);
    console.log(`   zeroGammaLevel: ${d?.zeroGammaLevel}`);
    console.log(`   cached: ${d?.cached}, stale: ${d?.stale}`);
  } catch (e) {
    console.log(`   ERROR: ${e}`);
  }
  console.log('');

  // 4. DB gex_snapshots (last 24h for symbol)
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    console.log('4. gex_snapshots (last 24h)');
    const pg = await import('pg');
    const pool = new pg.default.Pool({ connectionString: dbUrl });
    const r = await pool.query(
      `SELECT symbol, source, net_gex, total_call_gex, total_put_gex, created_at
       FROM gex_snapshots
       WHERE symbol = $1 AND created_at >= NOW() - INTERVAL '24 hours'
       ORDER BY created_at DESC LIMIT 5`,
      [SYMBOL]
    );
    console.log(`   Rows: ${r.rows.length}`);
    for (const row of r.rows) {
      console.log(`   - ${row.symbol} | ${row.source} | net_gex=${row.net_gex} | ${row.created_at}`);
    }
    await pool.end();
  }
  console.log('---');
  console.log('Root cause hints:');
  console.log('- MarketData 429 = daily rate limit; use UW gamma or upgrade plan');
  console.log('- UW chain has no gamma → GEX computed from chain = 0; use UW gamma API instead');
  console.log('- Set ENABLE_DEALER_UW_GAMMA=true + UNUSUAL_WHALES_API_KEY for UW gamma primary');
  console.log('\n=== End ===\n');
}

main().catch(console.error);
