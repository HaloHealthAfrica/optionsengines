#!/usr/bin/env npx tsx
/**
 * Quick test of UW options integration: chain → adapt → Greeks.
 * Run: UNUSUAL_WHALES_API_KEY=xxx npx tsx scripts/test-uw-integration.ts SPY
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const ticker = process.argv[2] || 'SPY';
  const apiKey = process.env.UNUSUAL_WHALES_API_KEY;
  if (!apiKey) {
    console.error('Set UNUSUAL_WHALES_API_KEY');
    process.exit(1);
  }

  const { unusualWhalesOptionsService } = await import('../src/services/unusual-whales-options.service.js');
  const { adaptOptionChain } = await import('../src/services/option-chain-adapter.service.js');
  const { marketData } = await import('../src/services/market-data.js');

  console.log(`\n# UW Integration Test: ${ticker}\n`);

  const chain = await unusualWhalesOptionsService.getChainAsMarketDataRows(ticker);
  console.log(`Chain rows: ${chain.length}`);

  if (chain.length === 0) {
    console.log('No chain data');
    return;
  }

  const sample = chain.slice(0, 3);
  console.log('\nSample rows (first 3):');
  sample.forEach((r, i) => {
    console.log(`  ${i + 1}. strike=${r.strike} exp=${r.expiration} type=${r.optionType} premium=${r.premium} iv=${r.iv ?? 'est'}`);
  });

  let spotPrice: number;
  try {
    spotPrice = await marketData.getStockPrice(ticker);
  } catch {
    spotPrice = ticker === 'SPY' ? 600 : 500;
    console.log(`\nSpot price: ${spotPrice} (fallback - market data unavailable)`);
  }
  console.log(`\nSpot price: ${spotPrice}`);

  const calls = adaptOptionChain(chain, spotPrice, 'call');
  const puts = adaptOptionChain(chain, spotPrice, 'put');
  console.log(`\nAdapted: ${calls.length} calls, ${puts.length} puts`);

  if (calls.length > 0) {
    const c = calls[0];
    console.log(`\nSample call: strike=${c.strike} dte=${c.dte} mid=${c.mid?.toFixed(2)} iv=${c.iv?.toFixed(3)} delta=${c.greeks?.delta?.toFixed(3)}`);
  }
  if (puts.length > 0) {
    const p = puts[0];
    console.log(`Sample put: strike=${p.strike} dte=${p.dte} mid=${p.mid?.toFixed(2)} iv=${p.iv?.toFixed(3)} delta=${p.greeks?.delta?.toFixed(3)}`);
  }

  const price = await unusualWhalesOptionsService.getOptionPrice(ticker, 600, new Date('2026-02-21'), 'call');
  console.log(`\nOption price (SPY 600C 2026-02-21): ${price ?? 'null'}`);

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
