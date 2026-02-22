const { config } = require('../dist/config/index.js');

async function main() {
  const apiKey = config.twelveDataApiKey;
  console.log('TwelveData API key:', apiKey ? apiKey.slice(0, 6) + '...' + apiKey.slice(-4) : 'NOT SET');
  console.log('MarketData API key:', config.marketDataApiKey ? 'SET' : 'NOT SET');

  // Test TwelveData quote
  const url = `https://api.twelvedata.com/quote?symbol=SPY&apikey=${apiKey}`;
  console.log('\nTesting TwelveData /quote for SPY...');
  try {
    const res = await fetch(url);
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2).slice(0, 500));
  } catch (err) {
    console.log('Error:', err.message);
  }

  // Test TwelveData time_series
  const url2 = `https://api.twelvedata.com/time_series?symbol=SPY&interval=5min&outputsize=5&apikey=${apiKey}`;
  console.log('\nTesting TwelveData /time_series for SPY...');
  try {
    const res = await fetch(url2);
    const data = await res.json();
    console.log('Status:', res.status);
    if (data.status === 'error') {
      console.log('Error:', data.message);
    } else {
      console.log('Got', data.values?.length, 'candles');
    }
  } catch (err) {
    console.log('Error:', err.message);
  }

  // Test TwelveData market state
  const url3 = `https://api.twelvedata.com/market_state?exchange=NYSE&apikey=${apiKey}`;
  console.log('\nTesting TwelveData /market_state...');
  try {
    const res = await fetch(url3);
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2).slice(0, 300));
  } catch (err) {
    console.log('Error:', err.message);
  }
}

main();
