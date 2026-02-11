/**
 * Test Production Webhook Endpoint
 * 
 * Sends a test signal to the production webhook endpoint
 */

import crypto from 'crypto';

const PRODUCTION_URL = process.env.PRODUCTION_URL || 'https://optionsengines.fly.dev';
const HMAC_SECRET = process.env.HMAC_SECRET || '';

const testSignal = {
  symbol: 'SPY',
  direction: 'long',
  timeframe: '5m',
  timestamp: new Date().toISOString()
};

console.log('🧪 Testing Production Webhook Endpoint\n');
console.log('=' .repeat(60));
console.log(`URL: ${PRODUCTION_URL}/webhook`);
console.log(`Payload:`, JSON.stringify(testSignal, null, 2));

// Generate HMAC signature if secret is provided
let signature: string | undefined;
if (HMAC_SECRET && HMAC_SECRET !== 'change-this-to-another-secure-random-string-for-webhooks') {
  const payload = JSON.stringify(testSignal);
  signature = crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(payload)
    .digest('hex');
  console.log(`\nHMAC Signature: ${signature}`);
} else {
  console.log('\n⚠️  No HMAC_SECRET provided - signature will not be sent');
}

console.log('\n' + '='.repeat(60));
console.log('Sending request...\n');

const headers: Record<string, string> = {
  'Content-Type': 'application/json'
};

if (signature) {
  headers['x-webhook-signature'] = signature;
}

fetch(`${PRODUCTION_URL}/webhook`, {
  method: 'POST',
  headers,
  body: JSON.stringify(testSignal)
})
  .then(async (res) => {
    console.log(`Status: ${res.status} ${res.statusText}`);
    const data = await res.json();
    console.log('\n✅ Response:', JSON.stringify(data, null, 2));
    
    if (res.status === 201) {
      console.log('\n✅ SUCCESS - Webhook is working!');
      console.log(`   Signal ID: ${data.signal_id}`);
      console.log(`   Experiment ID: ${data.experiment_id}`);
      console.log(`   Variant: Engine ${data.variant}`);
    } else if (res.status === 401) {
      console.log('\n❌ AUTHENTICATION FAILED');
      console.log('   Check HMAC_SECRET configuration');
    } else if (res.status === 400) {
      console.log('\n❌ BAD REQUEST');
      console.log('   Check payload format');
    } else {
      console.log('\n⚠️  Unexpected response');
    }
  })
  .catch((err) => {
    console.error('\n❌ ERROR:', err.message);
    console.error('\nPossible causes:');
    console.error('   1. Server is not running');
    console.error('   2. Network connectivity issue');
    console.error('   3. Incorrect URL');
    console.error('   4. Firewall blocking request');
  });
