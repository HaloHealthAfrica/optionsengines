// Test script to verify all data sources are working
import https from 'https';

const BACKEND_URL = 'optionsengines.fly.dev';
const TEST_SYMBOL = 'SPY';

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BACKEND_URL,
      port: 443,
      path: path,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      
      res.on('data', (chunk) => {
        body += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          resolve({ status: res.statusCode, data: response });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

async function testDataSource(name, path, validateFn) {
  console.log(`\n🔍 Testing: ${name}`);
  console.log(`   Endpoint: ${path}`);
  
  try {
    const startTime = Date.now();
    const result = await makeRequest(path);
    const duration = Date.now() - startTime;
    
    if (result.status === 200) {
      const isValid = validateFn(result.data);
      if (isValid) {
        console.log(`✅ SUCCESS (${duration}ms)`);
        console.log(`   Data:`, JSON.stringify(result.data).substring(0, 200) + '...');
        return { success: true, duration, data: result.data };
      } else {
        console.log(`⚠️  INVALID DATA (${duration}ms)`);
        console.log(`   Response:`, JSON.stringify(result.data).substring(0, 200));
        return { success: false, duration, error: 'Invalid data format' };
      }
    } else {
      console.log(`❌ FAILED (${result.status})`);
      console.log(`   Error:`, JSON.stringify(result.data).substring(0, 200));
      return { success: false, duration, error: result.data };
    }
  } catch (error) {
    console.log(`❌ ERROR: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function runAllTests() {
  console.log('🚀 Testing All Data Sources\n');
  console.log('=' .repeat(60));
  
  const results = {};

  // Test 1: Market Hours
  results.marketHours = await testDataSource(
    'Market Hours Check',
    '/api/market-hours',
    (data) => typeof data.isOpen === 'boolean'
  );

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 2: Stock Price
  results.stockPrice = await testDataSource(
    'Stock Price (SPY)',
    `/api/stock-price?symbol=${TEST_SYMBOL}`,
    (data) => typeof data.price === 'number' && data.price > 0
  );

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 3: Candles/Historical Data
  results.candles = await testDataSource(
    'Historical Candles (SPY)',
    `/api/candles?symbol=${TEST_SYMBOL}&timeframe=5m&limit=10`,
    (data) => Array.isArray(data.candles) && data.candles.length > 0
  );

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 4: Indicators
  results.indicators = await testDataSource(
    'Technical Indicators (SPY)',
    `/api/indicators?symbol=${TEST_SYMBOL}&timeframe=5m`,
    (data) => data.indicators && typeof data.indicators.rsi === 'number'
  );

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 5: GEX Data (Gamma Exposure)
  results.gex = await testDataSource(
    'Gamma Exposure (SPY)',
    `/positioning/gex?symbol=${TEST_SYMBOL}`,
    (data) => data.symbol === TEST_SYMBOL && typeof data.netGex === 'number'
  );

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 6: Options Flow
  results.optionsFlow = await testDataSource(
    'Options Flow (SPY)',
    `/positioning/options-flow?symbol=${TEST_SYMBOL}&limit=10`,
    (data) => Array.isArray(data.entries)
  );

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 7: Max Pain
  results.maxPain = await testDataSource(
    'Max Pain (SPY)',
    `/positioning/max-pain?symbol=${TEST_SYMBOL}`,
    (data) => typeof data.maxPainStrike === 'number'
  );

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 TEST SUMMARY\n');
  
  const testNames = Object.keys(results);
  const passed = testNames.filter(name => results[name].success).length;
  const failed = testNames.length - passed;
  
  console.log(`Total Tests: ${testNames.length}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('');

  // Detailed results
  testNames.forEach(name => {
    const result = results[name];
    const status = result.success ? '✅' : '❌';
    const duration = result.duration ? `${result.duration}ms` : 'N/A';
    console.log(`${status} ${name.padEnd(20)} - ${duration}`);
  });

  // Provider status
  console.log('\n📡 DATA PROVIDER STATUS\n');
  console.log('Based on test results, the following providers are working:');
  
  if (results.stockPrice?.success || results.candles?.success) {
    console.log('✅ Primary Provider (Alpaca/Polygon/TwelveData) - Stock data working');
  }
  
  if (results.gex?.success || results.optionsFlow?.success) {
    console.log('✅ MarketData.app - Options data working');
  }
  
  if (results.indicators?.success) {
    console.log('✅ Indicator Service - Technical analysis working');
  }

  console.log('\n💡 RECOMMENDATIONS\n');
  
  if (failed > 0) {
    console.log('Some tests failed. Check:');
    console.log('1. Environment variables are set correctly');
    console.log('2. API keys are valid and have sufficient quota');
    console.log('3. Backend logs: fly logs -a optionsengines');
    console.log('4. Circuit breakers may be open due to previous failures');
  } else {
    console.log('All data sources are operational! 🎉');
    console.log('Your system can pull data from all configured providers.');
  }

  console.log('\n' + '='.repeat(60));
}

runAllTests().catch(console.error);
