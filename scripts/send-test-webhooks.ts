#!/usr/bin/env ts-node
// Send synthetic webhooks to test production webhook processing

const BACKEND_URL = process.env.BACKEND_URL || 'https://optionsengines.fly.dev';

interface WebhookPayload {
  symbol: string;
  direction: 'long' | 'short';
  timeframe: string;
  timestamp: string;
}

const symbols = ['SPY', 'QQQ', 'IWM', 'DIA', 'XLK', 'XLF', 'XLV', 'XLE', 'TSLA', 'NVDA'];
const timeframes = ['1m', '5m', '15m', '30m', '1h'];
const directions: Array<WebhookPayload['direction']> = ['long', 'short'];

function buildUniqueSignals(count: number): WebhookPayload[] {
  const signals: WebhookPayload[] = [];
  const seen = new Set<string>();
  const now = Date.now();

  for (const symbol of symbols) {
    for (const timeframe of timeframes) {
      for (const direction of directions) {
        const key = `${symbol}:${timeframe}:${direction}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const timestamp = new Date(now + signals.length * 1000).toISOString();
        signals.push({ symbol, direction, timeframe, timestamp });
        if (signals.length >= count) return signals;
      }
    }
  }

  return signals;
}

const testSignals: WebhookPayload[] = buildUniqueSignals(25);

async function sendWebhook(payload: WebhookPayload): Promise<void> {
  const url = `${BACKEND_URL}/webhook`;
  
  console.log(`\n📤 Sending webhook to ${url}`);
  console.log(`   Symbol: ${payload.symbol}`);
  console.log(`   Direction: ${payload.direction}`);
  console.log(`   Timeframe: ${payload.timeframe}`);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log(`✅ Success (${response.status})`);
      console.log(`   Status: ${data.status}`);
      console.log(`   Signal ID: ${data.signal_id}`);
      console.log(`   Variant: ${data.variant}`);
      console.log(`   Processing Time: ${data.processing_time_ms}ms`);
    } else {
      console.log(`❌ Failed (${response.status})`);
      console.log(`   Error: ${data.error}`);
      if (data.details) {
        console.log(`   Details:`, data.details);
      }
    }
  } catch (error: any) {
    console.log(`❌ Request failed: ${error.message}`);
  }
}

async function testWebhookEndpoint(): Promise<void> {
  const testUrl = `${BACKEND_URL}/webhook/test`;
  
  console.log(`\n🔍 Testing webhook endpoint availability...`);
  console.log(`   URL: ${testUrl}`);
  
  try {
    const response = await fetch(testUrl);
    const data = await response.json();
    
    if (response.ok) {
      console.log(`✅ Endpoint is available`);
      console.log(`   Status: ${data.status}`);
      console.log(`   Message: ${data.message}`);
    } else {
      console.log(`❌ Endpoint returned error (${response.status})`);
    }
  } catch (error: any) {
    console.log(`❌ Endpoint not reachable: ${error.message}`);
    throw error;
  }
}

async function main(): Promise<void> {
  console.log('🚀 Synthetic Webhook Test');
  console.log('='.repeat(50));
  console.log(`Backend URL: ${BACKEND_URL}`);
  
  // Test endpoint availability
  await testWebhookEndpoint();
  
  // Send test signals
  console.log(`\n📊 Sending ${testSignals.length} test signals...`);
  
  for (let i = 0; i < testSignals.length; i++) {
    await sendWebhook(testSignals[i]);
    
    // Wait 2 seconds between requests to avoid rate limiting
    if (i < testSignals.length - 1) {
      console.log(`\n⏳ Waiting 2 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ Test complete!');
  console.log('\n📋 Next steps:');
  console.log('   1. Check Fly.io logs: fly logs -a optionsengines');
  console.log('   2. Query signals table: SELECT * FROM signals ORDER BY created_at DESC LIMIT 10;');
  console.log('   3. Wait 30-60 seconds for workers to process signals');
  console.log('   4. Check refactored_signals table for enriched data');
}

main().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
