/**
 * Test Webhook Endpoint
 * 
 * Sends a test webhook to verify the endpoint is working
 */

import crypto from 'crypto';

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000/webhook';
const HMAC_SECRET = process.env.HMAC_SECRET || '';

async function testWebhook() {
  console.log('🧪 Testing webhook endpoint...\n');
  console.log(`URL: ${WEBHOOK_URL}\n`);

  const testPayload = {
    symbol: 'SPY',
    direction: 'long',
    timeframe: '5m',
    timestamp: new Date().toISOString(),
  };

  console.log('📤 Sending test payload:');
  console.log(JSON.stringify(testPayload, null, 2));
  console.log('');

  try {
    const body = JSON.stringify(testPayload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add HMAC signature if secret is configured
    if (HMAC_SECRET && HMAC_SECRET !== 'change-this-to-another-secure-random-string-for-webhooks') {
      const signature = crypto
        .createHmac('sha256', HMAC_SECRET)
        .update(body)
        .digest('hex');
      headers['x-webhook-signature'] = signature;
      console.log('🔐 HMAC signature added');
    } else {
      console.log('⚠️  No HMAC secret configured (using default or empty)');
    }

    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers,
      body,
    });

    console.log(`\n📥 Response: ${response.status} ${response.statusText}`);

    const responseData = await response.json();
    console.log('\nResponse body:');
    console.log(JSON.stringify(responseData, null, 2));

    if (response.ok) {
      console.log('\n✅ Webhook test PASSED');
      console.log(`Signal ID: ${responseData.signal_id}`);
      console.log(`Variant: ${responseData.variant}`);
    } else {
      console.log('\n❌ Webhook test FAILED');
      console.log(`Error: ${responseData.error}`);
      if (responseData.details) {
        console.log('Details:', responseData.details);
      }
    }
  } catch (error: any) {
    console.error('\n❌ Request failed:', error.message);
    console.error('\nPossible issues:');
    console.error('1. Server is not running');
    console.error('2. Wrong URL or port');
    console.error('3. Network/firewall blocking request');
    console.error('4. Server crashed or not responding');
  }
}

// Run the test
testWebhook().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
