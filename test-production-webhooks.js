// Test script to send synthetic webhooks to production
import https from 'https';

const BACKEND_URL = 'optionsengines.fly.dev';

function sendWebhook(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    
    const options = {
      hostname: BACKEND_URL,
      port: 443,
      path: '/webhook',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
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

    req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('🚀 Sending synthetic webhooks to production...\n');

  const testCases = [
    {
      name: 'SPY Long Signal',
      payload: {
        symbol: 'SPY',
        direction: 'long',
        timeframe: '5m',
        timestamp: new Date().toISOString(),
      },
    },
    {
      name: 'QQQ Short Signal',
      payload: {
        symbol: 'QQQ',
        direction: 'short',
        timeframe: '15m',
        timestamp: new Date().toISOString(),
      },
    },
    {
      name: 'AAPL Call Signal',
      payload: {
        symbol: 'AAPL',
        direction: 'CALL',
        timeframe: '1h',
        timestamp: new Date().toISOString(),
      },
    },
    {
      name: 'TSLA Put Signal',
      payload: {
        ticker: 'TSLA',
        action: 'SELL',
        timeframe: '30m',
        timestamp: new Date().toISOString(),
      },
    },
  ];

  for (const testCase of testCases) {
    try {
      console.log(`📤 Sending: ${testCase.name}`);
      console.log(`   Payload:`, JSON.stringify(testCase.payload, null, 2));
      
      const result = await sendWebhook(testCase.payload);
      
      console.log(`✅ Response (${result.status}):`, JSON.stringify(result.data, null, 2));
      console.log('');
      
      // Wait 2 seconds between requests
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`❌ Error sending ${testCase.name}:`, error.message);
      console.log('');
    }
  }

  console.log('✨ All synthetic webhooks sent!');
  console.log('\n📊 Check your backend logs with:');
  console.log('   fly logs -a optionsengines');
  console.log('\n🔍 Check database with:');
  console.log('   SELECT * FROM signals ORDER BY created_at DESC LIMIT 10;');
}

runTests().catch(console.error);
