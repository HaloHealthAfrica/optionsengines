require('dotenv').config();

const TWELVE_DATA_KEY = process.env.TWELVE_DATA_API_KEY;
const MARKETDATA_KEY = process.env.MARKET_DATA_API_KEY;
const MARKETDATA_BASE = process.env.MARKETDATA_BASE_URL || 'https://proxyip.fly.dev';

async function testTwelveData() {
  if (!TWELVE_DATA_KEY) { console.log('TwelveData: NO API KEY'); return; }
  try {
    const url = `https://api.twelvedata.com/price?symbol=SPY&apikey=${TWELVE_DATA_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    console.log('TwelveData price:', data);
  } catch (e) {
    console.error('TwelveData FAILED:', e.message);
  }
}

async function testMarketData() {
  if (!MARKETDATA_KEY) { console.log('MarketData.app: NO API KEY'); return; }
  try {
    const url = `${MARKETDATA_BASE}/v1/stocks/quotes/SPY/?token=${MARKETDATA_KEY}`;
    console.log('MarketData URL:', url.replace(MARKETDATA_KEY, 'KEY_REDACTED'));
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    console.log('MarketData status:', res.status);
    const data = await res.json();
    console.log('MarketData response:', JSON.stringify(data).slice(0, 300));
  } catch (e) {
    console.error('MarketData FAILED:', e.message);
  }
}

async function main() {
  console.log('=== Testing Market Data Providers ===\n');
  console.log('TwelveData key:', TWELVE_DATA_KEY ? TWELVE_DATA_KEY.slice(0, 6) + '...' : 'MISSING');
  console.log('MarketData key:', MARKETDATA_KEY ? MARKETDATA_KEY.slice(0, 6) + '...' : 'MISSING');
  console.log('MarketData base URL:', MARKETDATA_BASE);
  console.log();

  await testTwelveData();
  console.log();
  await testMarketData();
}

main();
