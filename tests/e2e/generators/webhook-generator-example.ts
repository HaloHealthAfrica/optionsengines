/**
 * Example usage of the webhook generator
 * 
 * This file demonstrates how to use the synthetic webhook generator
 * and can be run to verify the implementation.
 */

import { createWebhookGenerator } from './webhook-generator-impl';
import { WebhookScenario } from './webhook-generator';

// Create generator with deterministic seed
const generator = createWebhookGenerator(12345);

// Example 1: Generate ORB breakout scenario
const orbBreakoutScenario: WebhookScenario = {
  symbol: 'SPY',
  timeframe: '5m',
  session: 'RTH_OPEN',
  pattern: 'ORB_BREAKOUT',
  price: 400,
  volume: 1000000,
  timestamp: 1650000000000,
};

const orbWebhook = generator.generateWebhook(orbBreakoutScenario);
console.log('ORB Breakout Webhook:');
console.log('  Symbol:', orbWebhook.payload.symbol);
console.log('  OHLC:', {
  open: orbWebhook.payload.open.toFixed(2),
  high: orbWebhook.payload.high.toFixed(2),
  low: orbWebhook.payload.low.toFixed(2),
  close: orbWebhook.payload.close.toFixed(2),
});
console.log('  Volume:', orbWebhook.payload.volume);
console.log('  Signal:', orbWebhook.payload.signal);
console.log('  Synthetic:', orbWebhook.metadata.synthetic);
console.log('');

// Example 2: Generate volatility compression scenario
const volCompressionScenario: WebhookScenario = {
  symbol: 'QQQ',
  timeframe: '1m',
  session: 'MID_DAY',
  pattern: 'VOL_COMPRESSION',
  price: 350,
  volume: 500000,
  timestamp: 1650003600000,
};

const volCompWebhook = generator.generateWebhook(volCompressionScenario);
console.log('Volatility Compression Webhook:');
console.log('  Symbol:', volCompWebhook.payload.symbol);
console.log('  OHLC:', {
  open: volCompWebhook.payload.open.toFixed(2),
  high: volCompWebhook.payload.high.toFixed(2),
  low: volCompWebhook.payload.low.toFixed(2),
  close: volCompWebhook.payload.close.toFixed(2),
});
console.log('  Range:', (volCompWebhook.payload.high - volCompWebhook.payload.low).toFixed(2));
console.log('  Signal:', volCompWebhook.payload.signal);
console.log('  Synthetic:', volCompWebhook.metadata.synthetic);
console.log('');

// Example 3: Generate batch of scenarios
const batchScenarios: WebhookScenario[] = [
  {
    symbol: 'SPX',
    timeframe: '15m',
    session: 'POWER_HOUR',
    pattern: 'TREND_CONTINUATION',
    price: 4500,
    volume: 2000000,
    timestamp: 1650007200000,
  },
  {
    symbol: 'SPY',
    timeframe: '5m',
    session: 'RTH_OPEN',
    pattern: 'CHOP',
    price: 400,
    volume: 1000000,
    timestamp: 1650010800000,
  },
];

const batchWebhooks = generator.generateBatch(batchScenarios);
console.log('Batch Generation:');
console.log('  Generated', batchWebhooks.length, 'webhooks');
batchWebhooks.forEach((webhook, index) => {
  console.log(`  Webhook ${index + 1}:`, webhook.payload.symbol, webhook.payload.signal);
});
console.log('');

// Example 4: Verify determinism
const webhook1 = generator.generateWebhook(orbBreakoutScenario);
const webhook2 = generator.generateWebhook(orbBreakoutScenario);
console.log('Determinism Check:');
console.log('  Same scenario generates identical webhooks:', 
  JSON.stringify(webhook1.payload) === JSON.stringify(webhook2.payload));
