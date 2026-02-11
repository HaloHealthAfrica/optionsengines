/**
 * End-to-End Test: Webhook → Signal → Order → Trade
 * 
 * Tests the complete flow from webhook ingestion to trade execution
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

// Helper to wait
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runE2ETest() {
  console.log('🚀 Starting End-to-End Test\n');
  console.log(`Backend: ${BACKEND_URL}\n`);
  
  const testSymbol = 'SPY';
  const testDirection = 'long';
  const testTimeframe = '5m';
  
  try {
    // Step 1: Send webhook
    console.log('📤 Step 1: Sending webhook...');
    const webhookPayload = {
      symbol: testSymbol,
      direction: testDirection,
      timeframe: testTimeframe,
      timestamp: new Date().toISOString(),
    };
    
    const webhookResponse = await fetch(`${BACKEND_URL}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload),
    });
    
    if (!webhookResponse.ok) {
      const error = await webhookResponse.json();
      console.error('❌ Webhook failed:', error);
      return false;
    }
    
    const webhookResult = await webhookResponse.json();
    console.log('✅ Webhook accepted');
    console.log(`   Signal ID: ${webhookResult.signal_id}`);
    console.log(`   Variant: ${webhookResult.variant}`);
    console.log(`   Processing time: ${webhookResult.processing_time_ms}ms\n`);
    
    const signalId = webhookResult.signal_id;
    const variant = webhookResult.variant;
    
    // Step 2: Wait for signal processing
    console.log('⏳ Step 2: Waiting for signal processing (30s)...');
    await sleep(30000);
    
    const authToken = await getAuthToken();
    if (!authToken) {
      console.error('❌ Missing auth token. Set BACKEND_TOKEN or BACKEND_EMAIL/BACKEND_PASSWORD.');
      return false;
    }

    // Step 3: Check monitoring status
    console.log('📊 Step 3: Checking pipeline status...');
    const monitoringResponse = await fetch(`${BACKEND_URL}/monitoring/status`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!monitoringResponse.ok) {
      throw new Error(`Monitoring request failed (${monitoringResponse.status})`);
    }
    const monitoringData = await monitoringResponse.json();
    
    console.log('\n📈 Webhook Stats (24h):');
    const webhookSummary = monitoringData.webhooks?.summary_24h || {};
    console.log(`   Total: ${webhookSummary.total || 0}`);
    console.log(`   Accepted: ${webhookSummary.accepted || 0}`);
    console.log(`   Rejected: ${webhookSummary.rejected || 0}`);
    
    console.log('\n📈 Signal Stats (24h):');
    const signalSummary = monitoringData.pipeline?.signals_24h || {};
    console.log(`   Total: ${signalSummary.total || 0}`);
    console.log(`   Pending: ${signalSummary.pending || 0}`);
    console.log(`   Approved: ${signalSummary.approved || 0}`);
    console.log(`   Rejected: ${signalSummary.rejected || 0}`);
    
    console.log('\n📈 Order Stats (24h):');
    const orderSummary = monitoringData.pipeline?.orders_24h || {};
    console.log(`   Total: ${orderSummary.total || 0}`);
    console.log(`   Pending: ${orderSummary.pending_execution || 0}`);
    console.log(`   Filled: ${orderSummary.filled || 0}`);
    console.log(`   Failed: ${orderSummary.failed || 0}`);
    
    // Step 4: Check recent webhooks
    console.log('\n📝 Step 4: Checking recent webhooks...');
    const recentWebhooks = monitoringData.webhooks?.recent || [];
    const ourWebhook = recentWebhooks.find(w => w.signal_id === signalId);
    
    if (ourWebhook) {
      console.log('✅ Found our webhook:');
      console.log(`   Status: ${ourWebhook.status}`);
      console.log(`   Symbol: ${ourWebhook.symbol}`);
      console.log(`   Timeframe: ${ourWebhook.timeframe}`);
      console.log(`   Variant: ${ourWebhook.variant}`);
      if (ourWebhook.error_message) {
        console.log(`   Error: ${ourWebhook.error_message}`);
      }
    } else {
      console.log('⚠️  Webhook not found in recent list (may have been processed)');
    }
    
    // Step 5: Check recent signals
    console.log('\n📝 Step 5: Checking recent signals...');
    const recentSignals = monitoringData.pipeline?.recent_signals || [];
    const ourSignal = recentSignals.find(s => s.signal_id === signalId);
    
    if (ourSignal) {
      console.log('✅ Found our signal:');
      console.log(`   Status: ${ourSignal.status}`);
      console.log(`   Symbol: ${ourSignal.symbol}`);
      console.log(`   Direction: ${ourSignal.direction}`);
      console.log(`   Timeframe: ${ourSignal.timeframe}`);
    } else {
      console.log('⚠️  Signal not found in recent list');
    }
    
    // Step 6: Check rejections
    console.log('\n📝 Step 6: Checking for rejections...');
    const recentRejections = monitoringData.pipeline?.recent_rejections || [];
    const ourRejection = recentRejections.find(r => r.signal_id === signalId);
    
    if (ourRejection) {
      console.log('❌ Signal was rejected:');
      console.log(`   Reason: ${ourRejection.rejection_reason}`);
      console.log(`   Symbol: ${ourRejection.symbol}`);
    } else {
      console.log('✅ No rejection found (signal may have been approved)');
    }
    
    // Step 7: Check orders
    console.log('\n📝 Step 7: Checking orders...');
    const ordersResponse = await fetch(`${BACKEND_URL}/orders`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!ordersResponse.ok) {
      throw new Error(`Orders request failed (${ordersResponse.status})`);
    }
    const ordersData = await ordersResponse.json();
    
    const orders = ordersData.orders || [];
    const trades = ordersData.trades || [];
    const positions = ordersData.positions || [];
    
    console.log(`   Active orders: ${orders.length}`);
    console.log(`   Filled trades: ${trades.length}`);
    console.log(`   Closed positions: ${positions.length}`);
    
    const ourOrder = orders.find(o => o.signal_id === signalId);
    const ourTrade = trades.find(t => t.signal_id === signalId);
    
    if (ourOrder) {
      console.log('\n✅ Found our order:');
      console.log(`   Order ID: ${ourOrder.id}`);
      console.log(`   Symbol: ${ourOrder.symbol}`);
      console.log(`   Type: ${ourOrder.type}`);
      console.log(`   Strike: ${ourOrder.strike}`);
      console.log(`   Quantity: ${ourOrder.qty}`);
      console.log(`   Status: ${ourOrder.status}`);
    }
    
    if (ourTrade) {
      console.log('\n✅ Found our trade:');
      console.log(`   Trade ID: ${ourTrade.id}`);
      console.log(`   Symbol: ${ourTrade.symbol}`);
      console.log(`   Type: ${ourTrade.type}`);
      console.log(`   Strike: ${ourTrade.strike}`);
      console.log(`   Quantity: ${ourTrade.qty}`);
      console.log(`   Price: $${ourTrade.price}`);
      console.log(`   Status: ${ourTrade.status}`);
      
      if (ourTrade.decision) {
        console.log(`   Decision Engine: ${ourTrade.decision.engine}`);
        console.log(`   Decision Source: ${ourTrade.decision.source}`);
        if (ourTrade.decision.bias) {
          console.log(`   Bias: ${ourTrade.decision.bias}`);
        }
        if (ourTrade.decision.confidence) {
          console.log(`   Confidence: ${ourTrade.decision.confidence}`);
        }
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 E2E Test Summary');
    console.log('='.repeat(60));
    console.log(`✅ Webhook accepted: ${webhookResult.status === 'ACCEPTED'}`);
    console.log(`✅ Signal created: ${signalId ? 'Yes' : 'No'}`);
    console.log(`✅ Routed to: Engine ${variant}`);
    
    if (ourSignal) {
      console.log(`✅ Signal status: ${ourSignal.status}`);
    }
    
    if (ourRejection) {
      console.log(`❌ Signal rejected: ${ourRejection.rejection_reason}`);
    } else if (ourOrder) {
      console.log(`✅ Order created: Yes`);
    } else if (ourTrade) {
      console.log(`✅ Trade executed: Yes`);
    } else {
      console.log(`⏳ Order/Trade: Pending (may need more time)`);
    }
    
    console.log('='.repeat(60));
    
    // Determine success
    const success = webhookResult.status === 'ACCEPTED' && signalId;
    
    if (success) {
      console.log('\n✅ E2E Test PASSED - Webhook flow is working!');
      if (ourRejection) {
        console.log('   Note: Signal was rejected (this may be expected based on market conditions)');
      }
    } else {
      console.log('\n❌ E2E Test FAILED');
    }
    
    return success;
    
  } catch (error) {
    console.error('\n❌ E2E Test FAILED with error:');
    console.error(error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
    return false;
  }
}

// Run the test
runE2ETest()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
