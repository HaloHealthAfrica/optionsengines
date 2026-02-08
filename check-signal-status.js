/**
 * Check Signal Status
 * Queries the monitoring endpoint to see signal processing status
 */

const BACKEND_URL = process.env.BACKEND_URL || 'https://optionsengines.fly.dev';
const SIGNAL_ID = process.argv[2];

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

async function checkStatus() {
  console.log('🔍 Checking signal processing status...\n');
  
  try {
    // Get monitoring status
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
    
    console.log('📊 Pipeline Health:');
    console.log(`  Signals (24h): ${data.pipeline?.signals_24h?.total || 0}`);
    console.log(`    - Pending: ${data.pipeline?.signals_24h?.pending || 0}`);
    console.log(`    - Approved: ${data.pipeline?.signals_24h?.approved || 0}`);
    console.log(`    - Rejected: ${data.pipeline?.signals_24h?.rejected || 0}`);
    console.log('');
    
    console.log(`  Orders (24h): ${data.pipeline?.orders_24h?.total || 0}`);
    console.log(`    - Pending: ${data.pipeline?.orders_24h?.pending_execution || 0}`);
    console.log(`    - Filled: ${data.pipeline?.orders_24h?.filled || 0}`);
    console.log(`    - Failed: ${data.pipeline?.orders_24h?.failed || 0}`);
    console.log('');
    
    console.log('📝 Recent Signals:');
    const recentSignals = data.pipeline?.recent_signals || [];
    recentSignals.slice(0, 5).forEach(signal => {
      const time = new Date(signal.created_at).toLocaleTimeString();
      console.log(`  ${signal.symbol} ${signal.direction} ${signal.timeframe} - ${signal.status} (${time})`);
    });
    console.log('');
    
    console.log('❌ Recent Rejections:');
    const recentRejections = data.pipeline?.recent_rejections || [];
    if (recentRejections.length === 0) {
      console.log('  None');
    } else {
      recentRejections.slice(0, 5).forEach(rejection => {
        const time = new Date(rejection.created_at).toLocaleTimeString();
        console.log(`  ${rejection.symbol} - ${rejection.rejection_reason} (${time})`);
      });
    }
    console.log('');
    
    console.log('🕐 Last Activity:');
    console.log(`  Last signal: ${data.pipeline?.last_activity?.signal ? new Date(data.pipeline.last_activity.signal).toLocaleString() : 'Never'}`);
    console.log(`  Last order: ${data.pipeline?.last_activity?.order ? new Date(data.pipeline.last_activity.order).toLocaleString() : 'Never'}`);
    console.log(`  Last trade: ${data.pipeline?.last_activity?.trade ? new Date(data.pipeline.last_activity.trade).toLocaleString() : 'Never'}`);
    console.log(`  Last position: ${data.pipeline?.last_activity?.position ? new Date(data.pipeline.last_activity.position).toLocaleString() : 'Never'}`);
    
  } catch (error) {
    console.error('❌ Failed to check status:', error.message);
  }
}

checkStatus();
