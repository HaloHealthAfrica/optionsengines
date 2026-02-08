/**
 * Check Webhook Status
 * Queries the monitoring endpoint to see webhook processing
 */

const BACKEND_URL = process.env.BACKEND_URL || 'https://optionsengines.fly.dev';

async function getAuthToken() {
  const directToken = process.env.BACKEND_TOKEN || process.env.JWT_TOKEN;
  if (directToken) return directToken;

  const email = process.env.BACKEND_EMAIL;
  const password = process.env.BACKEND_PASSWORD;
  if (!email || !password) return null;

  const response = await fetch(`${BACKEND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || `Login failed (${response.status})`);
  }

  const data = await response.json();
  return data?.token || null;
}

async function checkWebhooks() {
  console.log('🔍 Checking webhook processing status...\n');
  
  try {
    const token = await getAuthToken();
    const response = await fetch(`${BACKEND_URL}/monitoring/status`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Unauthorized. Set BACKEND_TOKEN or BACKEND_EMAIL/BACKEND_PASSWORD.');
      }
      throw new Error(`Monitoring request failed (${response.status})`);
    }
    const data = await response.json();
    
    console.log('📊 Webhook Summary (24h):');
    const summary = data.webhooks?.summary_24h || {};
    console.log(`  Total: ${summary.total || 0}`);
    console.log(`  Accepted: ${summary.accepted || 0}`);
    console.log(`  Rejected: ${summary.rejected || 0}`);
    console.log(`  Duplicate: ${summary.duplicate || 0}`);
    console.log(`  Invalid: ${summary.invalid_payload || 0}`);
    console.log('');
    
    console.log('📝 Recent Webhooks:');
    const recent = data.webhooks?.recent || [];
    if (recent.length === 0) {
      console.log('  No recent webhooks found');
    } else {
      recent.slice(0, 10).forEach(webhook => {
        const time = new Date(webhook.created_at).toLocaleTimeString();
        const status = webhook.status || 'unknown';
        const symbol = webhook.symbol || '--';
        const timeframe = webhook.timeframe || '--';
        const variant = webhook.variant || '--';
        console.log(`  [${time}] ${symbol} ${timeframe} - ${status} (Engine ${variant})`);
        if (webhook.error_message) {
          console.log(`    Error: ${webhook.error_message}`);
        }
      });
    }
    console.log('');
    
    console.log('🎯 Engine Distribution (24h):');
    const engines = data.engines?.by_variant_24h || {};
    console.log(`  Engine A: ${engines.A || 0}`);
    console.log(`  Engine B: ${engines.B || 0}`);
    console.log('');
    
    console.log('🔌 Data Providers:');
    const providers = data.providers || {};
    console.log(`  Circuit Breakers: ${JSON.stringify(providers.circuit_breakers || {}, null, 2)}`);
    console.log(`  Down Providers: ${(providers.down || []).join(', ') || 'None'}`);
    
  } catch (error) {
    console.error('❌ Failed to check webhooks:', error.message);
  }
}

checkWebhooks();
