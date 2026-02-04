// Test webhook endpoint
const testSignal = {
  symbol: 'SPY',
  direction: 'long',
  timeframe: '5m',
  timestamp: new Date().toISOString()
};

console.log('Sending test signal to webhook...');
console.log('Payload:', JSON.stringify(testSignal, null, 2));

fetch('http://localhost:3000/webhook', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(testSignal)
})
  .then(res => res.json())
  .then(data => {
    console.log('\n✅ Response:', JSON.stringify(data, null, 2));
  })
  .catch(err => {
    console.error('\n❌ Error:', err.message);
  });
