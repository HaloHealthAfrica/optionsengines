/**
 * Get Engine A Decision Details
 * Fetches detailed decision information for Engine A trades
 */

const BACKEND_URL = 'https://optionsengines.fly.dev';
const EMAIL = 'test@example.com';
const PASSWORD = 'TestPassword123!';

async function login() {
  const response = await fetch(`${BACKEND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  
  if (!response.ok) {
    throw new Error(`Login failed: ${response.status}`);
  }
  
  const data = await response.json();
  return data.token;
}

async function getOrders(token) {
  const response = await fetch(`${BACKEND_URL}/orders`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch orders: ${response.status}`);
  }
  
  return await response.json();
}

function displayDecisionDetails(trade, index) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TRADE #${index + 1}`);
  console.log('='.repeat(80));
  
  console.log('\n📊 Trade Information:');
  console.log(`  Trade ID: ${trade.id}`);
  console.log(`  Order ID: ${trade.order_id}`);
  console.log(`  Signal ID: ${trade.signal_id}`);
  console.log(`  Symbol: ${trade.symbol}`);
  console.log(`  Type: ${trade.type}`);
  console.log(`  Strike: $${trade.strike}`);
  console.log(`  Expiry: ${trade.expiry}`);
  console.log(`  Quantity: ${trade.qty}`);
  console.log(`  Fill Price: $${trade.price || 'N/A'}`);
  console.log(`  Time: ${trade.time ? new Date(trade.time).toLocaleString() : 'N/A'}`);
  
  if (trade.decision) {
    console.log('\n🤖 Decision Context:');
    console.log(`  Engine: ${trade.decision.engine}`);
    console.log(`  Source: ${trade.decision.source}`);
    
    if (trade.decision.source === 'meta_decision') {
      console.log('\n  Meta Decision Details:');
      console.log(`    Bias: ${trade.decision.bias || 'N/A'}`);
      console.log(`    Confidence: ${trade.decision.confidence ?? 'N/A'}`);
      console.log(`    Blocked: ${trade.decision.blocked ? 'Yes' : 'No'}`);
      
      if (trade.decision.reasons && trade.decision.reasons.length > 0) {
        console.log('\n    Reasons:');
        trade.decision.reasons.forEach((reason, idx) => {
          console.log(`      ${idx + 1}. ${reason}`);
        });
      }
      
      if (trade.decision.metadata) {
        console.log('\n    Metadata:');
        console.log(`      ${JSON.stringify(trade.decision.metadata, null, 6)}`);
      }
    } else if (trade.decision.source === 'risk_checks') {
      console.log('\n  Risk Check Results:');
      if (trade.decision.risk) {
        console.log(`    ${JSON.stringify(trade.decision.risk, null, 4)}`);
      } else {
        console.log('    No detailed risk check data available');
      }
    } else {
      console.log('\n  Unknown decision source - no additional details');
    }
  } else {
    console.log('\n⚠️  No decision context available for this trade');
  }
}

async function main() {
  console.log('🔍 Fetching Engine A Decision Details\n');
  
  try {
    // Login
    console.log('🔐 Logging in...');
    const token = await login();
    console.log('✅ Logged in\n');
    
    // Get orders
    console.log('📦 Fetching orders and trades...');
    const data = await getOrders(token);
    console.log(`✅ Found ${data.trades?.length || 0} trades\n`);
    
    if (!data.trades || data.trades.length === 0) {
      console.log('No trades found.');
      return;
    }
    
    // Display each trade with full decision details
    data.trades.forEach((trade, index) => {
      displayDecisionDetails(trade, index);
    });
    
    console.log('\n' + '='.repeat(80));
    console.log(`\n✅ Displayed ${data.trades.length} trades with decision details\n`);
    
    // Summary statistics
    const engineACount = data.trades.filter(t => t.decision?.engine?.includes('A')).length;
    const engineBCount = data.trades.filter(t => t.decision?.engine?.includes('B')).length;
    const metaDecisions = data.trades.filter(t => t.decision?.source === 'meta_decision').length;
    const riskChecks = data.trades.filter(t => t.decision?.source === 'risk_checks').length;
    
    console.log('📈 Summary:');
    console.log(`  Engine A trades: ${engineACount}`);
    console.log(`  Engine B trades: ${engineBCount}`);
    console.log(`  Meta decisions: ${metaDecisions}`);
    console.log(`  Risk check decisions: ${riskChecks}`);
    console.log(`  No decision context: ${data.trades.length - metaDecisions - riskChecks}`);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
