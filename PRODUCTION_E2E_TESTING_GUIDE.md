# Production E2E Testing with Sentry Tracing

This guide explains how to run end-to-end tests against your production environment with full Sentry tracing to identify what's working, what's broken, and what data is missing.

## Overview

The production E2E testing system:
- Sends real webhook payloads to your production environment
- Traces each webhook through the entire system using Sentry
- Reports on success/failure, missing data, and performance
- Provides Sentry trace IDs for deep debugging

## Prerequisites

1. **Production URL**: Your production webhook endpoint
2. **Sentry DSN**: Your Sentry DSN (optional but recommended)
3. **Access**: Ensure you have permission to send test webhooks to production

## Quick Start

### Basic Test (5 webhooks)

```bash
PRODUCTION_URL=https://your-production-url.com/webhook npm run test:production
```

### With Sentry Tracing

```bash
PRODUCTION_URL=https://your-production-url.com/webhook \
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project \
npm run test:production
```

### Custom Test Count

```bash
PRODUCTION_URL=https://your-production-url.com/webhook \
TEST_COUNT=10 \
npm run test:production
```

## What Gets Tested

The script sends webhooks for various scenarios:
- **ORB_BREAKOUT**: Opening Range Breakout scenario
- **TREND_CONTINUATION**: Trend continuation pattern
- **VOL_EXPANSION**: Volatility expansion scenario
- **ORB_FAKEOUT**: False breakout scenario
- **CHOP**: Choppy market conditions

Each webhook includes:
- Symbol (SPY, QQQ, IWM)
- Direction (long/short)
- Timeframe (1m, 5m, 15m)
- Timestamp
- Test ID for tracking
- Scenario identifier

## Understanding the Report

### Summary Section
```
📊 SUMMARY
  Total Tests: 5
  ✓ Successful: 4
  ✗ Failed: 1
  ⚠ Warnings: 2
```

### Working Section
Shows which scenarios are functioning correctly:
```
✅ WORKING
  ✓ ORB_BREAKOUT (SPY)
  ✓ TREND_CONTINUATION (QQQ)
```

### Broken Section
Shows which scenarios are failing and why:
```
❌ BROKEN
  ✗ VOL_EXPANSION (IWM): HTTP 500: Internal server error
  ✗ ORB_FAKEOUT (SPY): Request failed: Connection timeout
```

### Missing Data Section
Shows what data fields are missing from responses:
```
⚠️  MISSING DATA
  - signal_id
  - enrichment
  - variant
```

### Detailed Results
For each test, you'll see:
- Test ID and scenario
- HTTP status code
- Response time
- **Sentry Trace ID** (use this to debug in Sentry)
- Errors and warnings
- Missing data fields

## Using Sentry for Deep Debugging

### Step 1: Run Tests with Sentry Enabled

```bash
PRODUCTION_URL=https://your-prod.com/webhook \
SENTRY_DSN=https://your-dsn@sentry.io/project \
npm run test:production
```

### Step 2: Get Trace IDs from Report

The report will show trace IDs like:
```
Sentry Trace: 1234567890abcdef1234567890abcdef
```

### Step 3: View in Sentry Dashboard

1. Go to your Sentry dashboard
2. Navigate to **Performance > Traces**
3. Filter by environment: `production-e2e-test`
4. Search for the trace ID

### Step 4: Analyze the Trace

In Sentry, you'll see the complete webhook flow:

```
production-e2e-webhook-test (200ms)
├─ webhook-ingestion (50ms)
│  └─ validate-payload (5ms)
├─ data-enrichment (100ms)
│  ├─ fetch-market-data (40ms)
│  ├─ fetch-gex-data (35ms)
│  └─ build-snapshot (25ms)
├─ ab-routing (10ms)
│  └─ assign-variant (8ms)
├─ engine-execution (30ms)
│  ├─ engine-a-decision (15ms)
│  └─ engine-b-decision (15ms)
└─ database-save (10ms)
```

### What to Look For in Sentry

1. **Errors**: Red spans indicate failures
2. **Slow Operations**: Long spans indicate performance issues
3. **Missing Spans**: Gaps indicate missing instrumentation or failed operations
4. **External API Calls**: Check if enrichment APIs are being called
5. **Database Operations**: Verify data is being saved
6. **A/B Routing**: Check if variant assignment is happening

## Common Issues and Solutions

### Issue: All Tests Failing with Connection Error

**Symptom:**
```
✗ Request failed: Connection timeout
```

**Solutions:**
- Verify PRODUCTION_URL is correct
- Check if production server is running
- Verify network connectivity
- Check firewall rules

### Issue: Missing `signal_id` in Response

**Symptom:**
```
⚠️  MISSING DATA
  - signal_id
```

**Solutions:**
- Check webhook ingestion endpoint returns signal_id
- Verify database insert is successful
- Check response format in webhook handler

### Issue: Missing `variant` in Response

**Symptom:**
```
⚠ variant not in response (A/B routing may not be active)
```

**Solutions:**
- Check if A/B routing feature flag is enabled
- Verify Strategy Router is running
- Check if variant assignment logic is executing

### Issue: Missing `enrichment` Data

**Symptom:**
```
⚠️  MISSING DATA
  - enrichment
```

**Solutions:**
- Check if enrichment service is running
- Verify external API keys are configured
- Check Sentry trace for enrichment span failures
- Verify market data APIs are accessible

### Issue: HTTP 500 Errors

**Symptom:**
```
✗ HTTP 500: Internal server error
```

**Solutions:**
- Check Sentry for exception details
- Review server logs
- Check database connectivity
- Verify all required environment variables are set

## Advanced Usage

### Testing Specific Scenarios

Modify `scripts/e2e-production-test-with-sentry.ts` to add custom scenarios:

```typescript
const scenarios = [
  { symbol: 'SPY', direction: 'long', timeframe: '5m', scenario: 'CUSTOM_SCENARIO' },
  // Add more scenarios
];
```

### Continuous Monitoring

Run tests on a schedule to monitor production health:

```bash
# Add to cron or CI/CD pipeline
0 */6 * * * PRODUCTION_URL=... npm run test:production
```

### Integration with CI/CD

```yaml
# Example GitHub Actions workflow
- name: Production E2E Test
  run: |
    PRODUCTION_URL=${{ secrets.PRODUCTION_URL }} \
    SENTRY_DSN=${{ secrets.SENTRY_DSN }} \
    npm run test:production
```

## Interpreting Results

### Healthy System
```
📊 SUMMARY
  Total Tests: 5
  ✓ Successful: 5
  ✗ Failed: 0
  ⚠ Warnings: 0
```

All webhooks processed successfully, no missing data.

### Degraded System
```
📊 SUMMARY
  Total Tests: 5
  ✓ Successful: 4
  ✗ Failed: 1
  ⚠ Warnings: 3
```

Most webhooks work, but some failures or missing data. Investigate warnings.

### Broken System
```
📊 SUMMARY
  Total Tests: 5
  ✓ Successful: 0
  ✗ Failed: 5
  ⚠ Warnings: 0
```

All webhooks failing. Critical issue - check server status and Sentry immediately.

## Best Practices

1. **Run During Low Traffic**: Avoid peak trading hours
2. **Start Small**: Begin with 5-10 test webhooks
3. **Monitor Sentry**: Keep Sentry dashboard open during tests
4. **Document Issues**: Save trace IDs for failed tests
5. **Test Regularly**: Run tests after deployments
6. **Alert on Failures**: Set up alerts for test failures

## Troubleshooting

### Sentry Not Showing Traces

1. Verify SENTRY_DSN is correct
2. Check Sentry project settings
3. Ensure traces sample rate is > 0
4. Wait a few minutes for traces to appear

### Tests Timing Out

1. Increase timeout in fetch call
2. Check production server performance
3. Verify no rate limiting is blocking requests

### Inconsistent Results

1. Check for race conditions in code
2. Verify database state between tests
3. Check for external API rate limits
4. Review Sentry traces for timing issues

## Next Steps

After running production E2E tests:

1. **Fix Critical Issues**: Address all failed tests first
2. **Investigate Warnings**: Check missing data and warnings
3. **Optimize Performance**: Review slow traces in Sentry
4. **Add Monitoring**: Set up alerts for production issues
5. **Document Findings**: Update team on discovered issues

## Support

For issues or questions:
- Check Sentry traces for detailed error information
- Review server logs for additional context
- Consult the E2E testing spec: `.kiro/specs/e2e-testing-with-synthetic-data/`
