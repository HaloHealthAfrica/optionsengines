/**
 * Test UDC Webhooks
 * 
 * Sends multiple test webhooks to the local server and checks
 * how UDC (Unified Decision Core) processes them in SHADOW_UDC mode.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const BASE_URL = process.env.WEBHOOK_URL || 'http://localhost:3000';
const HMAC_SECRET = process.env.HMAC_SECRET || '715225db-72db-4021-89f1-68c3c952236d';
const JWT_SECRET = process.env.JWT_SECRET || 'YTPJOQGDM86V5Z7AQXBCS8CVDVCXAK3X';

function generateAdminToken(): string {
  return jwt.sign(
    { userId: 'test-admin', email: 'admin@test.com', role: 'admin' },
    JWT_SECRET,
    { expiresIn: '1h', issuer: 'dual-engine-trading-platform', audience: 'trading-platform-users' },
  );
}

function signPayload(body: string): string {
  return crypto.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}

const TEST_WEBHOOKS = [
  {
    name: 'SPY Long 5m (ORB breakout)',
    payload: {
      symbol: 'SPY',
      direction: 'long',
      timeframe: '5m',
      timestamp: new Date().toISOString(),
      pattern: 'ORB',
      confidence: 0.82,
      indicators: { rsi: 58, vwap_above: true, volume_ratio: 1.8 },
      is_test: true,
    },
  },
  {
    name: 'QQQ Short 15m (Failed 2-up)',
    payload: {
      symbol: 'QQQ',
      direction: 'short',
      timeframe: '15m',
      timestamp: new Date().toISOString(),
      pattern: 'FAILED_2UP',
      confidence: 0.75,
      indicators: { rsi: 72, macd_histogram: -0.15, volume_ratio: 1.3 },
      is_test: true,
    },
  },
  {
    name: 'AAPL Long 5m (momentum)',
    payload: {
      symbol: 'AAPL',
      direction: 'long',
      timeframe: '5m',
      timestamp: new Date().toISOString(),
      pattern: 'MOMENTUM',
      confidence: 0.68,
      indicators: { rsi: 55, ema_cross: true, volume_ratio: 2.1 },
      is_test: true,
    },
  },
  {
    name: 'TSLA Short 5m (reversal)',
    payload: {
      symbol: 'TSLA',
      direction: 'short',
      timeframe: '5m',
      timestamp: new Date().toISOString(),
      pattern: 'REVERSAL',
      confidence: 0.71,
      indicators: { rsi: 78, divergence: true, volume_ratio: 1.5 },
      is_test: true,
    },
  },
  {
    name: 'NVDA Long 15m (trend continuation)',
    payload: {
      symbol: 'NVDA',
      direction: 'long',
      timeframe: '15m',
      timestamp: new Date().toISOString(),
      pattern: 'TREND_CONT',
      confidence: 0.85,
      indicators: { rsi: 62, adx: 32, volume_ratio: 1.6 },
      is_test: true,
    },
  },
  {
    name: 'SPY Short 1m (scalp reversal)',
    payload: {
      symbol: 'SPY',
      direction: 'short',
      timeframe: '1',
      timestamp: new Date().toISOString(),
      pattern: 'SCALP_REV',
      confidence: 0.60,
      indicators: { rsi: 80, tick: -800, volume_ratio: 2.5 },
      is_test: true,
    },
  },
];

async function sendWebhook(name: string, payload: Record<string, any>): Promise<any> {
  const body = JSON.stringify(payload);
  const signature = signPayload(body);

  const response = await fetch(`${BASE_URL}/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-signature': signature,
    },
    body,
  });

  const data = await response.json();
  return { name, status: response.status, data };
}

async function checkUDCSnapshots(token: string): Promise<any> {
  const response = await fetch(`${BASE_URL}/api/udc/snapshots?limit=20`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

async function checkTradingMode(token: string): Promise<any> {
  const response = await fetch(`${BASE_URL}/api/udc/mode`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.json();
}

async function main() {
  const token = generateAdminToken();

  console.log('='.repeat(70));
  console.log('  UDC WEBHOOK TEST');
  console.log('='.repeat(70));

  // Step 1: Check current trading mode
  console.log('\n[1] Checking trading mode...');
  const modeResult = await checkTradingMode(token);
  console.log(`    Trading mode: ${modeResult.mode}`);

  if (modeResult.mode !== 'SHADOW_UDC' && modeResult.mode !== 'UDC_PRIMARY') {
    console.log('    WARNING: UDC is not active. Signals will not be processed by UDC.');
    console.log('    Current mode needs to be SHADOW_UDC or UDC_PRIMARY.');
  }

  // Step 2: Check existing snapshots (before)
  console.log('\n[2] Checking existing UDC snapshots (before)...');
  const snapshotsBefore = await checkUDCSnapshots(token);
  console.log(`    Total snapshots: ${snapshotsBefore.total}`);

  // Step 3: Send test webhooks
  console.log('\n[3] Sending test webhooks...');
  console.log('-'.repeat(70));

  const results: any[] = [];
  for (const webhook of TEST_WEBHOOKS) {
    const result = await sendWebhook(webhook.name, webhook.payload);
    results.push(result);

    const statusIcon = result.status === 200 ? 'OK' : 'FAIL';
    const signalId = result.data?.signal_id || 'n/a';
    const variant = result.data?.variant || result.data?.status || 'n/a';

    console.log(`    [${statusIcon}] ${webhook.name}`);
    console.log(`         Signal ID: ${signalId}`);
    console.log(`         Status: ${variant}`);
    if (result.data?.error) {
      console.log(`         Error: ${result.data.error}`);
    }
    console.log('');

    // Small delay between webhooks
    await new Promise((r) => setTimeout(r, 500));
  }

  // Step 4: Wait for orchestrator to process
  console.log('[4] Waiting 35 seconds for orchestrator to process signals...');
  for (let i = 35; i > 0; i -= 5) {
    process.stdout.write(`    ${i}s remaining...\r`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log('    Done waiting.                  ');

  // Step 5: Check UDC snapshots (after)
  console.log('\n[5] Checking UDC snapshots (after)...');
  const snapshotsAfter = await checkUDCSnapshots(token);
  console.log(`    Total snapshots: ${snapshotsAfter.total}`);
  const newCount = snapshotsAfter.total - snapshotsBefore.total;
  console.log(`    New snapshots: ${newCount}`);

  if (snapshotsAfter.data && snapshotsAfter.data.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('  UDC DECISION SNAPSHOTS (most recent)');
    console.log('='.repeat(70));

    for (const snap of snapshotsAfter.data.slice(0, 10)) {
      console.log(`\n    Signal ID:   ${snap.signal_id}`);
      console.log(`    Decision ID: ${snap.decision_id || 'n/a'}`);
      console.log(`    Status:      ${snap.status}`);
      console.log(`    Reason:      ${snap.reason || 'n/a'}`);
      console.log(`    Created:     ${snap.created_at}`);
      if (snap.order_plan_json) {
        const plan = typeof snap.order_plan_json === 'string'
          ? JSON.parse(snap.order_plan_json)
          : snap.order_plan_json;
        console.log(`    Order Plan:  ${JSON.stringify(plan, null, 2).split('\n').join('\n                 ')}`);
      }
      console.log('    ' + '-'.repeat(50));
    }
  }

  // Step 6: Summary
  console.log('\n' + '='.repeat(70));
  console.log('  SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Webhooks sent:       ${results.length}`);
  console.log(`  Accepted:            ${results.filter((r) => r.data?.variant === 'ACCEPTED' || r.data?.status === 'ACCEPTED').length}`);
  console.log(`  Duplicates:          ${results.filter((r) => r.data?.variant === 'DUPLICATE' || r.data?.status === 'DUPLICATE').length}`);
  console.log(`  Rejected:            ${results.filter((r) => r.data?.variant === 'REJECTED' || r.data?.status === 'REJECTED').length}`);
  console.log(`  New UDC snapshots:   ${newCount}`);
  console.log(`  Trading mode:        ${modeResult.mode}`);
  console.log('='.repeat(70));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
