// Test script to verify all data sources with authentication
import https from 'https';

const BACKEND_URL = 'optionsengines.fly.dev';
const TEST_SYMBOL = 'SPY';

// You need to provide credentials - these should match a user in your database
const TEST_EMAIL = process.env.TEST_EMAIL || 'demo@optionagents.ai';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'demo';

let authToken = null;

function makeRequest(path, method = 'GET', body = null, useAuth = false) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': 'application/json',
    };

    if (useAuth && authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const options = {
      hostname: BACKEND_URL,
      port: 443,
      path: path,
      method: method,
      headers: headers,
    };

    const req = https.request(options, (res) => {
      let responseBody = '';
      
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(responseBody);
          resolve({ status: res.statusCode, data: response });
        } catch (e) {
          resolve({ status: res.statusCode, data: responseBody });
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

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

async function login() {
  console.log('🔐 Authenticating...');
  console.log(`   Email: ${TEST_EMAIL}`);
  
  try {
    const result = await makeRequest('/auth/login', 'POST', {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    if (result.status === 200 && result.data.token) {
      authToken = result.data.token;
      console.log('✅ Authentication successful');
      console.log(`   Token: ${authToken.substring(0, 20)}...`);
      return true;
    } else {
      console.log('❌ Authentication failed');
      console.log(`   Response:`, result.data);
      return false;
    }
  } catch (error) {
    console.log('❌ Authentication error:', error.message);
    return false;
  }
}

async function testDataSource(name, path, validateFn, requiresAuth = false) {
  console.log(`\n🔍 Testing: ${name}`);
  console.log(`   Endpoint: ${path}`);
  console.log(`   Auth: ${requiresAuth ? 'Required' : 'Not required'}`);
  
  try {
    const startTime = Date.now();
    const result = await makeRequest(path, 'GET', null, requiresAuth);
    const duration = Date.now() - startTime;
    
    if (result.status === 200) {
      const isValid = validateFn(result.data);
      if (isValid) {
        console.log(`✅ SUCCESS (${duration}ms)`);
        const preview = JSON.stringify(result.data).substring(0, 150);
        console.log(`   Data: ${preview}${preview.length >= 150 ? '...' : ''}`);
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
  console.log('🚀 Testing All Data Sources with Authentication\n');
  console.log('='.repeat(70));
  console.log('');

  // Step 1: Authenticate
  const authenticated = await login();
  if (!authenticated) {
    console.log('\n❌ Cannot proceed without authentication');
    console.log('\n💡 To fix this:');
    console.log('1. Create a user in your database');
    console.log('2. Set TEST_EMAIL and TEST_PASSWORD environment variables');
    console.log('3. Or use the /auth/register endpoint to create a user');
    return;
  }

  console.log('');
  const results = {};

  // Test 1: Webhook Test Endpoint (no auth)
  results.webhookTest = await testDataSource(
    'Webhook Test Endpoint',
    '/webhook/test',
    (data) => data.status === 'ok',
    false
  );

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 2: GEX Data (requires auth)
  results.gex = await testDataSource(
    'Gamma Exposure (SPY)',
    `/positioning/gex?symbol=${TEST_SYMBOL}`,
    (data) => data.data && data.data.symbol === TEST_SYMBOL,
    true
  );

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 3: Options Flow (requires auth)
  results.optionsFlow = await testDataSource(
    'Options Flow (SPY)',
    `/positioning/options-flow?symbol=${TEST_SYMBOL}&limit=10`,
    (data) => data.data && Array.isArray(data.data.entries),
    true
  );

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 4: Max Pain (requires auth)
  results.maxPain = await testDataSource(
    'Max Pain (SPY)',
    `/positioning/max-pain?symbol=${TEST_SYMBOL}`,
    (data) => data.data && typeof data.data.maxPainStrike === 'number',
    true
  );

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 5: Signal Correlation (requires auth)
  results.signalCorrelation = await testDataSource(
    'Signal Correlation (SPY)',
    `/positioning/signal-correlation?symbol=${TEST_SYMBOL}`,
    (data) => data.data !== undefined,
    true
  );

  // Summary
  console.log('\n' + '='.repeat(70));
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
    const label = name.replace(/([A-Z])/g, ' $1').trim();
    console.log(`${status} ${label.padEnd(30)} - ${duration}`);
  });

  // Data source analysis
  console.log('\n📡 DATA SOURCE ANALYSIS\n');
  
  if (results.gex?.success) {
    console.log('✅ MarketData.app - Options chain data accessible');
    console.log('   - Gamma Exposure (GEX) calculations working');
  } else if (results.gex?.error) {
    console.log('❌ MarketData.app - Failed to fetch options data');
    console.log(`   Error: ${JSON.stringify(results.gex.error).substring(0, 100)}`);
  }

  if (results.optionsFlow?.success) {
    console.log('✅ Options Flow - Real-time options activity tracking');
  }

  if (results.maxPain?.success) {
    console.log('✅ Max Pain - Options positioning analysis working');
  }

  console.log('\n💡 RECOMMENDATIONS\n');
  
  if (failed === 0) {
    console.log('🎉 All data sources are operational!');
    console.log('');
    console.log('Your system can successfully:');
    console.log('- Authenticate users');
    console.log('- Fetch gamma exposure data');
    console.log('- Track options flow');
    console.log('- Calculate max pain levels');
    console.log('- Analyze signal correlations');
  } else {
    console.log('Some tests failed. Common issues:');
    console.log('');
    console.log('1. API Keys Not Set:');
    console.log('   - Check MARKET_DATA_API_KEY is set in Fly.io secrets');
    console.log('   - Verify ALPACA_API_KEY and ALPACA_SECRET_KEY');
    console.log('');
    console.log('2. Rate Limits:');
    console.log('   - Free tier APIs may have hit rate limits');
    console.log('   - Check circuit breaker status');
    console.log('');
    console.log('3. Market Hours:');
    console.log('   - Some data may be unavailable outside market hours');
    console.log('');
    console.log('4. Check logs:');
    console.log('   fly logs -a optionsengines | grep -i error');
  }

  console.log('\n' + '='.repeat(70));
}

runAllTests().catch(console.error);
