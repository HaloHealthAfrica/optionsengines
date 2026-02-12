#!/usr/bin/env tsx
/**
 * Production E2E Test with Sentry Tracing
 * 
 * This script runs end-to-end tests against production with full Sentry tracing
 * to identify what's working, what's broken, and what data is missing.
 * 
 * Usage:
 *   npx tsx scripts/e2e-production-test-with-sentry.ts [--url=URL] [--count=N] [--sentry-dsn=DSN]
 * 
 * Env:
 *   PRODUCTION_URL - Production webhook endpoint (required)
 *   SENTRY_DSN - Sentry DSN for tracing (optional, uses default if not set)
 *   TEST_COUNT - Number of test webhooks to send (default: 5)
 */

import * as Sentry from '@sentry/node';

interface TestWebhook {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  timeframe: string;
  timestamp: string;
  scenario: string;
}

interface TestResult {
  webhook: TestWebhook;
  sentryTraceId: string;
  httpStatus: number;
  responseData: any;
  success: boolean;
  errors: string[];
  warnings: string[];
  missingData: string[];
  timing: {
    sent: number;
    received: number;
    duration: number;
  };
}

interface TestReport {
  summary: {
    total: number;
    successful: number;
    failed: number;
    warnings: number;
  };
  results: TestResult[];
  issues: {
    broken: string[];
    working: string[];
    missingData: string[];
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  let url = process.env.PRODUCTION_URL || '';
  let sentryDsn = process.env.SENTRY_DSN || '';
  let count = process.env.TEST_COUNT ? parseInt(process.env.TEST_COUNT) : 5;

  for (const arg of args) {
    if (arg.startsWith('--url=')) url = arg.slice(6);
    else if (arg.startsWith('--sentry-dsn=')) sentryDsn = arg.slice(13);
    else if (arg.startsWith('--count=')) count = parseInt(arg.slice(8));
  }

  if (!url) {
    console.error('ERROR: PRODUCTION_URL is required');
    console.error('Usage: PRODUCTION_URL=https://your-prod-url.com/webhook npx tsx scripts/e2e-production-test-with-sentry.ts');
    process.exit(1);
  }

  return { url, sentryDsn, count };
}

const { url: PRODUCTION_URL, sentryDsn: SENTRY_DSN, count: TEST_COUNT } = parseArgs();

// Initialize Sentry for tracing
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 1.0,
    environment: 'production-e2e-test',
  });
}

function generateTestWebhooks(count: number): TestWebhook[] {
  const scenarios = [
    { symbol: 'SPY', direction: 'long' as const, timeframe: '5m', scenario: 'ORB_BREAKOUT' },
    { symbol: 'QQQ', direction: 'short' as const, timeframe: '15m', scenario: 'TREND_CONTINUATION' },
    { symbol: 'IWM', direction: 'long' as const, timeframe: '1m', scenario: 'VOL_EXPANSION' },
    { symbol: 'SPY', direction: 'short' as const, timeframe: '5m', scenario: 'ORB_FAKEOUT' },
    { symbol: 'QQQ', direction: 'long' as const, timeframe: '15m', scenario: 'CHOP' },
  ];

  const webhooks: TestWebhook[] = [];
  const baseTime = Date.now();

  for (let i = 0; i < count; i++) {
    const scenario = scenarios[i % scenarios.length];
    webhooks.push({
      id: `test-${Date.now()}-${i}`,
      ...scenario,
      timestamp: new Date(baseTime + i * 2000).toISOString(),
    });
  }

  return webhooks;
}

async function sendWebhookWithTracing(webhook: TestWebhook): Promise<TestResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];
  const missingData: string[] = [];

  return await Sentry.startSpan(
    {
      name: 'production-e2e-webhook-test',
      op: 'test.webhook',
      attributes: {
        'test.webhook.id': webhook.id,
        'test.webhook.symbol': webhook.symbol,
        'test.webhook.direction': webhook.direction,
        'test.webhook.scenario': webhook.scenario,
      },
    },
    async (span) => {
      const traceId = span.spanContext().traceId;

      try {
        const response = await fetch(PRODUCTION_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'sentry-trace': span.toTraceparent(),
          },
          body: JSON.stringify({
            symbol: webhook.symbol,
            direction: webhook.direction,
            timeframe: webhook.timeframe,
            timestamp: webhook.timestamp,
            test_id: webhook.id,
            test_scenario: webhook.scenario,
          }),
        });

        const responseText = await response.text();
        let responseData: any;
        try {
          responseData = responseText ? JSON.parse(responseText) : null;
        } catch {
          responseData = responseText;
        }

        const endTime = Date.now();
        const success = response.status >= 200 && response.status < 300;

        // Analyze response for issues
        if (!success) {
          errors.push(`HTTP ${response.status}: ${responseData?.error || responseData?.message || 'Unknown error'}`);
        }

        // Check for missing data in response
        if (responseData) {
          if (!responseData.signal_id) missingData.push('signal_id');
          if (!responseData.status) missingData.push('status');
          if (!responseData.variant) warnings.push('variant not in response (A/B routing may not be active)');
          if (!responseData.enrichment) warnings.push('enrichment data not in response');
        }

        span.setStatus({ code: success ? 1 : 2 });
        span.setAttribute('http.status_code', response.status);
        span.setAttribute('test.success', success);

        return {
          webhook,
          sentryTraceId: traceId,
          httpStatus: response.status,
          responseData,
          success,
          errors,
          warnings,
          missingData,
          timing: {
            sent: startTime,
            received: endTime,
            duration: endTime - startTime,
          },
        };
      } catch (error: any) {
        const endTime = Date.now();
        errors.push(`Request failed: ${error.message}`);
        
        span.setStatus({ code: 2 });
        span.setAttribute('test.success', false);
        Sentry.captureException(error, {
          tags: {
            test_id: webhook.id,
            scenario: webhook.scenario,
          },
        });

        return {
          webhook,
          sentryTraceId: traceId,
          httpStatus: 0,
          responseData: null,
          success: false,
          errors,
          warnings,
          missingData,
          timing: {
            sent: startTime,
            received: endTime,
            duration: endTime - startTime,
          },
        };
      }
    }
  );
}

function generateReport(results: TestResult[]): TestReport {
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const withWarnings = results.filter(r => r.warnings.length > 0).length;

  const broken: string[] = [];
  const working: string[] = [];
  const allMissingData = new Set<string>();

  for (const result of results) {
    if (result.success) {
      working.push(`✓ ${result.webhook.scenario} (${result.webhook.symbol})`);
    } else {
      broken.push(`✗ ${result.webhook.scenario} (${result.webhook.symbol}): ${result.errors.join(', ')}`);
    }

    result.missingData.forEach(d => allMissingData.add(d));
  }

  return {
    summary: {
      total: results.length,
      successful,
      failed,
      warnings: withWarnings,
    },
    results,
    issues: {
      broken,
      working,
      missingData: Array.from(allMissingData),
    },
  };
}

function printReport(report: TestReport) {
  console.log('\n' + '='.repeat(80));
  console.log('PRODUCTION E2E TEST REPORT WITH SENTRY TRACING');
  console.log('='.repeat(80));
  
  console.log('\n📊 SUMMARY');
  console.log(`  Total Tests: ${report.summary.total}`);
  console.log(`  ✓ Successful: ${report.summary.successful}`);
  console.log(`  ✗ Failed: ${report.summary.failed}`);
  console.log(`  ⚠ Warnings: ${report.summary.warnings}`);

  if (report.issues.working.length > 0) {
    console.log('\n✅ WORKING');
    report.issues.working.forEach(item => console.log(`  ${item}`));
  }

  if (report.issues.broken.length > 0) {
    console.log('\n❌ BROKEN');
    report.issues.broken.forEach(item => console.log(`  ${item}`));
  }

  if (report.issues.missingData.length > 0) {
    console.log('\n⚠️  MISSING DATA');
    report.issues.missingData.forEach(item => console.log(`  - ${item}`));
  }

  console.log('\n📝 DETAILED RESULTS');
  for (const result of report.results) {
    const status = result.success ? '✓' : '✗';
    console.log(`\n  ${status} Test: ${result.webhook.id}`);
    console.log(`     Scenario: ${result.webhook.scenario}`);
    console.log(`     Symbol: ${result.webhook.symbol} ${result.webhook.direction}`);
    console.log(`     HTTP Status: ${result.httpStatus}`);
    console.log(`     Duration: ${result.timing.duration}ms`);
    console.log(`     Sentry Trace: ${result.sentryTraceId}`);
    
    if (result.errors.length > 0) {
      console.log(`     Errors:`);
      result.errors.forEach(e => console.log(`       - ${e}`));
    }
    
    if (result.warnings.length > 0) {
      console.log(`     Warnings:`);
      result.warnings.forEach(w => console.log(`       - ${w}`));
    }

    if (result.missingData.length > 0) {
      console.log(`     Missing Data:`);
      result.missingData.forEach(d => console.log(`       - ${d}`));
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('🔍 SENTRY TRACING');
  console.log('='.repeat(80));
  console.log('\nView traces in Sentry to see the complete webhook flow:');
  console.log('  1. Go to your Sentry dashboard');
  console.log('  2. Navigate to Performance > Traces');
  console.log('  3. Filter by environment: "production-e2e-test"');
  console.log('  4. Search for trace IDs listed above');
  console.log('\nEach trace shows:');
  console.log('  - Webhook ingestion');
  console.log('  - Data enrichment');
  console.log('  - A/B routing decision');
  console.log('  - Engine execution');
  console.log('  - Database operations');
  console.log('  - External API calls');
  console.log('  - Errors and performance bottlenecks');
  console.log('\n' + '='.repeat(80));
}

async function run() {
  console.log('🚀 Starting Production E2E Tests with Sentry Tracing');
  console.log(`   Target: ${PRODUCTION_URL}`);
  console.log(`   Test Count: ${TEST_COUNT}`);
  console.log(`   Sentry: ${SENTRY_DSN ? 'Enabled' : 'Disabled (set SENTRY_DSN to enable)'}`);
  console.log('');

  const webhooks = generateTestWebhooks(TEST_COUNT);
  const results: TestResult[] = [];

  for (let i = 0; i < webhooks.length; i++) {
    const webhook = webhooks[i];
    console.log(`[${i + 1}/${webhooks.length}] Sending ${webhook.scenario} (${webhook.symbol})...`);
    
    const result = await sendWebhookWithTracing(webhook);
    results.push(result);
    
    const status = result.success ? '✓' : '✗';
    console.log(`  ${status} ${result.httpStatus} - ${result.timing.duration}ms - Trace: ${result.sentryTraceId}`);
    
    // Wait between requests to avoid overwhelming the system
    if (i < webhooks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Flush Sentry events
  if (SENTRY_DSN) {
    console.log('\nFlushing Sentry events...');
    await Sentry.flush(2000);
  }

  const report = generateReport(results);
  printReport(report);

  // Exit with error code if any tests failed
  process.exit(report.summary.failed > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error('Fatal error:', error);
  Sentry.captureException(error);
  process.exit(1);
});
