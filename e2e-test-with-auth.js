/**
 * Complete E2E Test with Authentication
 * Tests: Webhook → Signal → Order → Trade flow
 */

const BACKEND_URL = 'https://optionsengines.fly.dev';
const EMAIL = process.env.BACKEND_EMAIL || 'demo@optionagents.ai';
const PASSWORD = process.env.BACKEND_PASSWORD || 'demo';

async function login() {
  console.log('🔐 Logging in...');
  const response = await fetch(`${BACKEND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  
  if (!response.ok) {
    throw new Error(`Login failed: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  console.log('✅ Logged in successfully\n');
  return data.token;
}

async function sendWebhook() {
  console.log('📤 Sending test webhook...');
  const payload = {
    symbol: 'SPY',
    direction: 'long',
    timeframe: '5m',
    timestamp: new Date().toISOString(),
  };
  
  const response = await fetch(`${BACKEND_URL}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  
  const data = await response.json();
  console.log(`✅ Webhook accepted`);
  console.log(`   Signal ID: ${data.signal_id}`);
  console.log(`   Variant: ${data.variant}`);
  console.log(`   Processing time: ${data.processing_time_ms}ms\n`);
  return data.signal_id;
}

async function checkMonitoring(token) {
  console.log('📊 Checking monitoring status...');
  const response = await fetch(`${BACKEND_URL}/monitoring/status`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  
  if (!response.ok) {
    throw new Error(`Monitoring check failed: ${response.status}`);
  }
  
  const data = await response.json();
  
  console.log('\n📈 Pipeline Health (24h):');
  console.log(`  Signals: ${data.pipeline?.signals_24h?.total || 0} (P:${data.pipeline?.signals_24h?.pending || 0} A:${data.pipeline?.signals_24h?.approved || 0} R:${data.pipeline?.signals_24h?.rejected || 0})`);
  console.log(`  Orders: ${data.pipeline?.orders_24h?.total || 0} (Pending:${data.pipeline?.orders_24h?.pending_execution || 0} Filled:${data.pipeline?.orders_24h?.filled || 0} Failed:${data.pipeline?.orders_24h?.failed || 0})`);
  
  console.log('\n📝 Recent Signals:');
  const recentSignals = data.pipeline?.recent_signals || [];
  if (recentSignals.length === 0) {
    console.log('  No signals yet');
  } else {
    recentSignals.slice(0, 5).forEach(signal => {
      const time = new Date(signal.created_at).toLocaleTimeString();
      console.log(`  ${signal.symbol} ${signal.direction} ${signal.timeframe} - ${signal.status} (${time})`);
    });
  }
  
  console.log('\n❌ Recent Rejections:');
  const recentRejections = data.pipeline?.recent_rejections || [];
  if (recentRejections.length === 0) {
    console.log('  None');
  } else {
    recentRejections.slice(0, 5).forEach(rejection => {
      const time = new Date(rejection.created_at).toLocaleTimeString();
      console.log(`  ${rejection.symbol} - ${rejection.rejection_reason} (${time})`);
    });
  }
  
  console.log('\n📊 Webhooks (24h):');
  console.log(`  Total: ${data.webhooks?.summary_24h?.total || 0}`);
  console.log(`  Accepted: ${data.webhooks?.summary_24h?.accepted || 0}`);
  console.log(`  Rejected: ${data.webhooks?.summary_24h?.rejected || 0}`);
  console.log(`  Duplicate: ${data.webhooks?.summary_24h?.duplicate || 0}`);
  
  console.log('\n🎯 Engine Distribution:');
  console.log(`  Engine A: ${data.engines?.by_variant_24h?.A || 0}`);
  console.log(`  Engine B: ${data.engines?.by_variant_24h?.B || 0}`);
  
  return data;
}

async function checkOrders(token) {
  console.log('\n📦 Checking orders...');
  const response = await fetch(`${BACKEND_URL}/orders`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  
  if (!response.ok) {
    throw new Error(`Orders check failed: ${response.status}`);
  }
  
  const data = await response.json();
  
  console.log(`  Pending orders: ${data.orders?.length || 0}`);
  console.log(`  Filled trades: ${data.trades?.length || 0}`);
  console.log(`  Closed positions: ${data.positions?.length || 0}`);
  
  if (data.orders?.length > 0) {
    console.log('\n  Recent pending orders:');
    data.orders.slice(0, 3).forEach(order => {
      console.log(`    ${order.symbol} ${order.type} $${order.strike} - ${order.status}`);
    });
  }
  
  if (data.trades?.length > 0) {
    console.log('\n  Recent filled trades:');
    data.trades.slice(0, 3).forEach(trade => {
      console.log(`    ${trade.symbol} ${trade.type} $${trade.strike} @ $${trade.price || 'N/A'}`);
      if (trade.decision) {
        console.log(`      Decision: ${trade.decision.engine} (${trade.decision.source})`);
      }
    });
  }
  
  return data;
}

async function runE2ETest() {
  console.log('🚀 Starting E2E Test\n');
  console.log('='.repeat(60));
  console.log('\n');
  
  try {
    // Step 1: Login
    const token = await login();
    
    // Step 2: Send webhook
    const signalId = await sendWebhook();
    
    // Step 3: Wait for signal processor (runs every 30s)
    console.log('⏳ Waiting 35 seconds for signal processor...\n');
    await new Promise(resolve => setTimeout(resolve, 35000));
    
    // Step 4: Check monitoring
    await checkMonitoring(token);
    
    // Step 5: Check orders
    await checkOrders(token);
    
    console.log('\n' + '='.repeat(60));
    console.log('\n✅ E2E Test Complete!\n');
    
  } catch (error) {
    console.error('\n❌ E2E Test Failed:', error.message);
    process.exit(1);
  }
}

runE2ETest();
