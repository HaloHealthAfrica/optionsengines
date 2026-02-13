# Production E2E Testing - Quick Start

## 🚀 Run Tests in 30 Seconds

```bash
# 1. Set your production URL
export PRODUCTION_URL=https://your-production-url.com/webhook

# 2. Set your Sentry DSN (optional but recommended)
export SENTRY_DSN=https://your-sentry-dsn@sentry.io/project

# 3. Run the tests
npm run test:production
```

## 📊 What You'll Get

```
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
  View traces in Sentry dashboard
  Filter by environment: "production-e2e-test"
```

## 🔍 Analyze Results

```bash
# View the analysis guide
npm run analyze:sentry
```

This shows you:
- What's broken and why
- What data is missing
- Where performance bottlenecks are
- How to fix each issue

## 📖 Full Documentation

See [PRODUCTION_E2E_TESTING_GUIDE.md](./PRODUCTION_E2E_TESTING_GUIDE.md) for:
- Detailed setup instructions
- How to interpret results
- Troubleshooting guide
- Best practices

## 🎯 Common Use Cases

### Test After Deployment
```bash
PRODUCTION_URL=https://your-prod.com/webhook npm run test:production
```

### Monitor Production Health
```bash
# Run every 6 hours via cron
0 */6 * * * PRODUCTION_URL=... npm run test:production
```

### Debug Specific Issues
```bash
# Run with more tests for better coverage
PRODUCTION_URL=... TEST_COUNT=20 npm run test:production
```

## 🆘 Quick Troubleshooting

### All Tests Failing?
- Check if production server is running
- Verify PRODUCTION_URL is correct
- Check network connectivity

### Missing Data in Responses?
- Check Sentry traces for the specific webhook
- Look for missing spans (operations that didn't happen)
- Review the analysis guide: `npm run analyze:sentry`

### Slow Performance?
- Check Sentry traces for slow spans
- Look for spans > 500ms
- Optimize the slowest operations first

## 📞 Need Help?

1. Run `npm run analyze:sentry` for detailed guidance
2. Check Sentry dashboard for trace details
3. Review [PRODUCTION_E2E_TESTING_GUIDE.md](./PRODUCTION_E2E_TESTING_GUIDE.md)
4. Check your e2e spec: `.kiro/specs/e2e-testing-with-synthetic-data/`
