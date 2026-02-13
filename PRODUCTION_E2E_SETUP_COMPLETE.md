# ✅ Production E2E Testing with Sentry - Setup Complete

Your production end-to-end testing system with Sentry tracing is now ready to use!

## 🎉 What's Been Set Up

### 1. Production Test Runner
**File:** `scripts/e2e-production-test-with-sentry.ts`

Sends real webhooks to production and traces them through Sentry to identify:
- ✅ What's working
- ❌ What's broken
- ⚠️ What data is missing
- 🐌 Performance bottlenecks

### 2. Sentry Trace Analysis Guide
**File:** `scripts/analyze-sentry-traces.ts`

Interactive guide that shows you:
- How to read Sentry traces
- What each span means
- How to identify issues
- How to prioritize fixes

### 3. Documentation
- **Quick Start:** `PRODUCTION_TESTING_QUICK_START.md`
- **Full Guide:** `PRODUCTION_E2E_TESTING_GUIDE.md`
- **Environment Variables:** Updated `.env.example`

### 4. NPM Scripts
```json
{
  "test:production": "Run E2E tests against production",
  "analyze:sentry": "View Sentry trace analysis guide"
}
```

## 🚀 Get Started in 3 Steps

### Step 1: Configure Environment

Add to your `.env` file:

```bash
# Required
PRODUCTION_URL=https://your-production-url.com/webhook

# Optional but recommended
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
TEST_COUNT=5
```

### Step 2: Run Tests

```bash
npm run test:production
```

### Step 3: Analyze Results

```bash
# View the analysis guide
npm run analyze:sentry

# Then check Sentry dashboard for detailed traces
```

## 📊 What You'll See

### Console Output
```
🚀 Starting Production E2E Tests with Sentry Tracing
   Target: https://your-prod.com/webhook
   Test Count: 5
   Sentry: Enabled

[1/5] Sending ORB_BREAKOUT (SPY)...
  ✓ 200 - 245ms - Trace: abc123...

[2/5] Sending TREND_CONTINUATION (QQQ)...
  ✓ 200 - 312ms - Trace: def456...

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

❌ BROKEN
  ✗ VOL_EXPANSION (IWM): HTTP 500: Internal server error

⚠️  MISSING DATA
  - enrichment
  - variant

🔍 SENTRY TRACING
  View traces in Sentry to see the complete webhook flow
```

### Sentry Dashboard

Each trace shows the complete webhook journey:

```
production-e2e-webhook-test (245ms)
├─ webhook-ingestion (50ms) ✅
├─ data-enrichment (120ms) ⚠️ Missing GEX data
├─ ab-routing (10ms) ❌ Not executing
├─ engine-a-decision (45ms) ✅
└─ database-save (20ms) ✅
```

## 🔍 How to Use Sentry Traces

### 1. Access Traces
- Go to Sentry dashboard
- Navigate to: **Performance > Traces**
- Filter by environment: `production-e2e-test`

### 2. Find Your Test
- Use the trace ID from the console output
- Or sort by "Most Recent"

### 3. Analyze the Trace
- **Green spans** = Working correctly
- **Red spans** = Errors (fix immediately)
- **Missing spans** = Features not running (investigate)
- **Slow spans** = Performance issues (optimize)

### 4. Identify Issues

**Example: Missing GEX Data**
```
Expected span: fetch-gex-data
Actual: Span missing
Issue: GEX service not running or not instrumented
Fix: Start GEX service, add Sentry instrumentation
```

**Example: Slow Enrichment**
```
Expected: < 200ms
Actual: 800ms
Issue: Sequential API calls
Fix: Parallelize API calls, add caching
```

## 🎯 Common Scenarios

### Scenario 1: After Deployment
```bash
# Verify deployment didn't break anything
PRODUCTION_URL=https://your-prod.com/webhook npm run test:production
```

### Scenario 2: Debugging Production Issues
```bash
# Run tests to reproduce the issue
PRODUCTION_URL=https://your-prod.com/webhook TEST_COUNT=10 npm run test:production

# Check Sentry traces for the failing tests
npm run analyze:sentry
```

### Scenario 3: Performance Monitoring
```bash
# Run tests regularly to track performance
# Add to cron: 0 */6 * * *
PRODUCTION_URL=https://your-prod.com/webhook npm run test:production
```

### Scenario 4: Feature Validation
```bash
# Test new feature (e.g., A/B routing)
# Enable feature flag in production
PRODUCTION_URL=https://your-prod.com/webhook npm run test:production

# Check Sentry traces for ab-routing span
# Verify variant assignment is happening
```

## 🔧 Troubleshooting

### Issue: "PRODUCTION_URL is required"
**Solution:** Set the environment variable
```bash
export PRODUCTION_URL=https://your-prod.com/webhook
npm run test:production
```

### Issue: No traces in Sentry
**Solution:** Verify Sentry DSN is correct
```bash
export SENTRY_DSN=https://your-dsn@sentry.io/project
npm run test:production
```

### Issue: All tests failing
**Solution:** Check production server status
```bash
# Verify server is running
curl https://your-prod.com/health

# Check server logs
# Review Sentry errors
```

### Issue: Tests pass but data missing
**Solution:** Check Sentry traces for missing spans
```bash
npm run analyze:sentry
# Look for "Missing spans" section
```

## 📈 Next Steps

### 1. Run Your First Test
```bash
PRODUCTION_URL=https://your-prod.com/webhook npm run test:production
```

### 2. Review Results
- Check console output for summary
- Note any failures or warnings
- Copy trace IDs for failed tests

### 3. Analyze in Sentry
```bash
npm run analyze:sentry
```
- Open Sentry dashboard
- Find traces using trace IDs
- Identify root causes

### 4. Fix Issues
- Prioritize critical issues (webhook ingestion, database)
- Fix high priority issues (missing enrichment, A/B routing)
- Optimize performance bottlenecks

### 5. Re-test
```bash
npm run test:production
```
- Verify fixes worked
- Compare new traces with old traces
- Document improvements

### 6. Set Up Monitoring
- Add to CI/CD pipeline
- Schedule regular tests (cron)
- Set up alerts for failures

## 📚 Additional Resources

### Documentation
- **Quick Start:** [PRODUCTION_TESTING_QUICK_START.md](./PRODUCTION_TESTING_QUICK_START.md)
- **Full Guide:** [PRODUCTION_E2E_TESTING_GUIDE.md](./PRODUCTION_E2E_TESTING_GUIDE.md)
- **E2E Spec:** `.kiro/specs/e2e-testing-with-synthetic-data/`

### Scripts
- **Test Runner:** `scripts/e2e-production-test-with-sentry.ts`
- **Analysis Guide:** `scripts/analyze-sentry-traces.ts`
- **Webhook Replay:** `scripts/replay-webhooks-from-file.ts`

### Existing E2E Tests
Your comprehensive e2e test suite is in `tests/e2e/`:
- Synthetic data generators
- Test orchestration
- Validation framework
- Phase-specific tests

## 🎊 You're All Set!

Your production E2E testing system is ready. Run your first test:

```bash
PRODUCTION_URL=https://your-production-url.com/webhook npm run test:production
```

Then analyze the results in Sentry to see exactly what's working, what's broken, and what data is missing in your webhook processing pipeline.

Happy testing! 🚀
