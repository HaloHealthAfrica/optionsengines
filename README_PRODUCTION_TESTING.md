# Production E2E Testing with Sentry - Complete Guide

## 🎯 What This Does

Run end-to-end tests against your production environment with full Sentry tracing to identify:
- ✅ **What's working** - Which webhook scenarios process successfully
- ❌ **What's broken** - Which operations are failing and why
- ⚠️ **What data is missing** - Which fields or operations are absent
- 🐌 **Where bottlenecks are** - Which operations are slow

## 🚀 Quick Start (30 seconds)

### Option 1: Using Helper Script (Recommended)

**Linux/Mac:**
```bash
chmod +x scripts/test-production.sh
./scripts/test-production.sh
```

**Windows:**
```cmd
scripts\test-production.bat
```

### Option 2: Direct Command

```bash
PRODUCTION_URL=https://your-prod.com/webhook npm run test:production
```

## 📋 Prerequisites

1. **Production URL** - Your production webhook endpoint
2. **Sentry DSN** (optional) - For detailed tracing
3. **Node.js 20+** - Already installed if you're running the app

## 🔧 Setup

### 1. Configure Environment Variables

Add to your `.env` file:

```bash
# Required
PRODUCTION_URL=https://your-production-url.com/webhook

# Optional but highly recommended
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id

# Optional
TEST_COUNT=5  # Number of test webhooks to send
```

### 2. Verify Configuration

```bash
# Check if variables are set
echo $PRODUCTION_URL
echo $SENTRY_DSN
```

### 3. Run Your First Test

```bash
npm run test:production
```

## 📊 Understanding Results

### Console Output

```
🚀 Starting Production E2E Tests with Sentry Tracing
   Target: https://your-prod.com/webhook
   Test Count: 5
   Sentry: Enabled

[1/5] Sending ORB_BREAKOUT (SPY)...
  ✓ 200 - 245ms - Trace: abc123def456...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRODUCTION E2E TEST REPORT WITH SENTRY TRACING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 SUMMARY
  Total Tests: 5
  ✓ Successful: 4
  ✗ Failed: 1
  ⚠ Warnings: 2

✅ WORKING
  ✓ ORB_BREAKOUT (SPY)
  ✓ TREND_CONTINUATION (QQQ)
  ✓ VOL_EXPANSION (IWM)
  ✓ CHOP (QQQ)

❌ BROKEN
  ✗ ORB_FAKEOUT (SPY): HTTP 500: Internal server error

⚠️  MISSING DATA
  - enrichment
  - variant

📝 DETAILED RESULTS
  ✓ Test: test-1234567890-0
     Scenario: ORB_BREAKOUT
     Symbol: SPY long
     HTTP Status: 200
     Duration: 245ms
     Sentry Trace: abc123def456...

  ✗ Test: test-1234567890-3
     Scenario: ORB_FAKEOUT
     Symbol: SPY short
     HTTP Status: 500
     Duration: 1523ms
     Sentry Trace: ghi789jkl012...
     Errors:
       - HTTP 500: Internal server error
     Missing Data:
       - signal_id

🔍 SENTRY TRACING
View traces in Sentry to see the complete webhook flow:
  1. Go to your Sentry dashboard
  2. Navigate to Performance > Traces
  3. Filter by environment: "production-e2e-test"
  4. Search for trace IDs listed above
```

### What Each Section Means

#### 📊 Summary
- **Total Tests**: Number of webhooks sent
- **Successful**: Webhooks that returned 2xx status
- **Failed**: Webhooks that returned errors
- **Warnings**: Webhooks with missing data

#### ✅ Working
Lists scenarios that processed successfully. These are your healthy code paths.

#### ❌ Broken
Lists scenarios that failed with error details. **Fix these first.**

#### ⚠️ Missing Data
Lists data fields missing from responses. Indicates incomplete features or missing instrumentation.

#### 📝 Detailed Results
Shows per-test details including:
- **Sentry Trace ID** - Use this to debug in Sentry
- **Duration** - Response time
- **Errors** - What went wrong
- **Missing Data** - What's absent

## 🔍 Analyzing in Sentry

### Step 1: Access Sentry

1. Go to your Sentry dashboard
2. Navigate to **Performance > Traces**
3. Filter by environment: `production-e2e-test`

### Step 2: Find Your Test

Use the trace ID from the console output or sort by "Most Recent"

### Step 3: Analyze the Trace

A healthy trace looks like:

```
production-e2e-webhook-test (245ms) ✅
├─ webhook-ingestion (50ms) ✅
│  ├─ validate-payload (5ms) ✅
│  └─ deduplicate-check (10ms) ✅
├─ data-enrichment (120ms) ✅
│  ├─ fetch-market-data (40ms) ✅
│  ├─ fetch-gex-data (35ms) ✅
│  └─ build-snapshot (25ms) ✅
├─ ab-routing (10ms) ✅
│  └─ assign-variant (8ms) ✅
├─ engine-execution (45ms) ✅
│  └─ engine-a-decision (45ms) ✅
└─ database-save (20ms) ✅
```

### Step 4: Identify Issues

**Red Spans (Errors)** - Operations that failed
```
🔴 fetch-gex-data ERROR
   → GEX API call failed
   → Check API keys, rate limits
```

**Missing Spans** - Operations that didn't happen
```
⚠️  Missing: ab-routing
   → A/B routing not executing
   → Check feature flags
```

**Slow Spans** - Performance bottlenecks
```
🐌 data-enrichment (800ms)
   → Too slow, should be < 200ms
   → Parallelize API calls
```

### Step 5: Get Detailed Analysis

```bash
npm run analyze:sentry
```

This shows an interactive guide with:
- What each span means
- How to identify issues
- How to fix common problems
- How to prioritize fixes

## 🎯 Common Use Cases

### After Deployment

Verify deployment didn't break anything:

```bash
npm run test:production
```

### Debugging Production Issues

Reproduce and trace the issue:

```bash
TEST_COUNT=10 npm run test:production
```

Then check Sentry traces for the failing tests.

### Performance Monitoring

Run tests regularly to track performance:

```bash
# Add to cron (every 6 hours)
0 */6 * * * cd /path/to/app && npm run test:production
```

### Feature Validation

Test new features (e.g., A/B routing):

1. Enable feature flag in production
2. Run tests: `npm run test:production`
3. Check Sentry for new spans (e.g., `ab-routing`)
4. Verify feature is working

## 🔧 Troubleshooting

### All Tests Failing

**Symptom:** All webhooks return errors or timeouts

**Solutions:**
1. Check if production server is running
2. Verify `PRODUCTION_URL` is correct
3. Check network connectivity
4. Review server logs

### Missing Data in Responses

**Symptom:** Warnings about missing fields

**Solutions:**
1. Check Sentry traces for missing spans
2. Verify services are running (enrichment, routing)
3. Check feature flags
4. Review API integrations

### Slow Performance

**Symptom:** High response times (> 500ms)

**Solutions:**
1. Check Sentry traces for slow spans
2. Identify bottlenecks
3. Optimize slow operations
4. Add caching where appropriate

### No Traces in Sentry

**Symptom:** Tests run but no traces appear

**Solutions:**
1. Verify `SENTRY_DSN` is correct
2. Check Sentry project settings
3. Wait a few minutes for traces to appear
4. Verify traces sample rate > 0

## 📚 Documentation

- **Quick Start:** [PRODUCTION_TESTING_QUICK_START.md](./PRODUCTION_TESTING_QUICK_START.md)
- **Full Guide:** [PRODUCTION_E2E_TESTING_GUIDE.md](./PRODUCTION_E2E_TESTING_GUIDE.md)
- **Setup Complete:** [PRODUCTION_E2E_SETUP_COMPLETE.md](./PRODUCTION_E2E_SETUP_COMPLETE.md)
- **E2E Spec:** `.kiro/specs/e2e-testing-with-synthetic-data/`

## 🛠️ Available Commands

```bash
# Run production E2E tests
npm run test:production

# View Sentry analysis guide
npm run analyze:sentry

# Helper scripts
./scripts/test-production.sh      # Linux/Mac
scripts\test-production.bat       # Windows
```

## 📈 Best Practices

1. **Run After Deployments** - Verify nothing broke
2. **Monitor Regularly** - Schedule tests every few hours
3. **Check Sentry** - Always review traces for failures
4. **Fix Critical First** - Prioritize webhook ingestion and database issues
5. **Document Issues** - Save trace IDs for failed tests
6. **Re-test After Fixes** - Verify fixes worked

## 🎊 You're Ready!

Run your first production E2E test:

```bash
npm run test:production
```

Then check Sentry to see exactly what's working, what's broken, and what data is missing in your webhook processing pipeline.

## 🆘 Need Help?

1. Run `npm run analyze:sentry` for detailed guidance
2. Check [PRODUCTION_E2E_TESTING_GUIDE.md](./PRODUCTION_E2E_TESTING_GUIDE.md)
3. Review Sentry traces for error details
4. Check your e2e spec: `.kiro/specs/e2e-testing-with-synthetic-data/`

Happy testing! 🚀
