# Production E2E Testing Flow

## Overview

This document visualizes how production E2E testing with Sentry tracing works.

## The Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PRODUCTION E2E TEST FLOW                            │
└─────────────────────────────────────────────────────────────────────────────┘

Step 1: Run Tests
─────────────────
  $ npm run test:production
         │
         ├─ Loads configuration (PRODUCTION_URL, SENTRY_DSN)
         ├─ Generates test webhooks (ORB_BREAKOUT, TREND_CONTINUATION, etc.)
         └─ Initializes Sentry tracing
         
         
Step 2: Send Webhooks with Tracing
───────────────────────────────────
  Test Script                    Production Server
  ───────────                    ─────────────────
      │                                 │
      │  POST /webhook                  │
      │  + Sentry trace header          │
      ├────────────────────────────────>│
      │                                 │
      │                                 ├─ Webhook Ingestion
      │                                 │  └─ Validate payload
      │                                 │
      │                                 ├─ Data Enrichment
      │                                 │  ├─ Fetch market data
      │                                 │  ├─ Fetch GEX data
      │                                 │  └─ Build snapshot
      │                                 │
      │                                 ├─ A/B Routing
      │                                 │  └─ Assign variant
      │                                 │
      │                                 ├─ Engine Execution
      │                                 │  ├─ Engine A (if variant A)
      │                                 │  └─ Engine B (if variant B)
      │                                 │     ├─ ORB Agent
      │                                 │     ├─ Strat Agent
      │                                 │     ├─ TTM Agent
      │                                 │     ├─ Risk Agent
      │                                 │     └─ Meta-Decision
      │                                 │
      │                                 └─ Database Save
      │                                 
      │  Response (200/500)             │
      │<────────────────────────────────┤
      │                                 │
      ├─ Capture result                 │
      ├─ Record timing                  │
      └─ Save trace ID                  │
      
      
Step 3: Analyze Results
───────────────────────
  Test Script
  ───────────
      │
      ├─ Collect all results
      ├─ Identify successes ✅
      ├─ Identify failures ❌
      ├─ Identify missing data ⚠️
      └─ Generate report
      
      
Step 4: View in Sentry
──────────────────────
  Sentry Dashboard
  ────────────────
      │
      ├─ Filter by environment: "production-e2e-test"
      ├─ Find trace by ID
      └─ View complete trace:
      
         production-e2e-webhook-test (245ms)
         ├─ webhook-ingestion (50ms) ✅
         ├─ data-enrichment (120ms) ✅
         ├─ ab-routing (10ms) ✅
         ├─ engine-execution (45ms) ✅
         └─ database-save (20ms) ✅
```

## What Gets Tested

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TEST SCENARIOS                                    │
└─────────────────────────────────────────────────────────────────────────────┘

1. ORB_BREAKOUT (SPY, long, 5m)
   Tests: Opening range breakout detection and execution
   
2. TREND_CONTINUATION (QQQ, short, 15m)
   Tests: Trend following logic and agent coordination
   
3. VOL_EXPANSION (IWM, long, 1m)
   Tests: Volatility detection and risk management
   
4. ORB_FAKEOUT (SPY, short, 5m)
   Tests: False breakout detection and veto logic
   
5. CHOP (QQQ, long, 15m)
   Tests: Choppy market handling and agent disagreement
```

## What Gets Traced

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SENTRY TRACE SPANS                                  │
└─────────────────────────────────────────────────────────────────────────────┘

Root Span: production-e2e-webhook-test
│
├─ webhook-ingestion
│  ├─ validate-payload
│  └─ deduplicate-check
│
├─ data-enrichment
│  ├─ fetch-market-data (TwelveData/Alpaca/MarketDataApp)
│  ├─ fetch-gex-data
│  ├─ fetch-technical-indicators
│  └─ build-snapshot
│
├─ ab-routing
│  ├─ calculate-variant
│  └─ log-assignment
│
├─ engine-execution
│  ├─ engine-a-decision (if variant A)
│  │  └─ live-execution
│  │
│  └─ engine-b-decision (if variant B)
│     ├─ orb-agent
│     ├─ strat-agent
│     ├─ ttm-agent
│     ├─ satyland-agent
│     ├─ risk-agent
│     ├─ meta-decision-agent
│     └─ shadow-execution
│
└─ database-operations
   ├─ save-signal
   ├─ save-enrichment
   └─ save-decision
```

## Issue Detection

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        HOW ISSUES ARE DETECTED                              │
└─────────────────────────────────────────────────────────────────────────────┘

✅ WORKING
──────────
  Span present + Green (no errors) + Fast (< threshold)
  
  Example:
    webhook-ingestion (50ms) ✅
    → Webhook received and validated successfully


❌ BROKEN
─────────
  Span present + Red (error) + May be slow
  
  Example:
    fetch-gex-data ERROR ❌
    → GEX API call failed
    → Check: API keys, rate limits, network


⚠️  MISSING DATA
────────────────
  Span absent (should be present)
  
  Example:
    Missing: ab-routing ⚠️
    → A/B routing not executing
    → Check: Feature flags, routing service


🐌 SLOW
───────
  Span present + Green + Slow (> threshold)
  
  Example:
    data-enrichment (800ms) 🐌
    → Too slow, should be < 200ms
    → Fix: Parallelize API calls, add caching
```

## Decision Tree

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      WHAT TO DO WITH RESULTS                                │
└─────────────────────────────────────────────────────────────────────────────┘

Test Result?
    │
    ├─ All Successful ✅
    │  └─ System healthy
    │     └─ Continue monitoring
    │
    ├─ Some Failed ❌
    │  └─ Check Sentry traces
    │     ├─ Red spans? → Fix errors immediately
    │     ├─ Missing spans? → Enable missing features
    │     └─ Slow spans? → Optimize performance
    │
    └─ All Failed ❌
       └─ Critical issue
          ├─ Check server status
          ├─ Review server logs
          ├─ Check Sentry errors
          └─ Fix immediately
```

## Example: Debugging a Failed Test

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DEBUGGING WORKFLOW EXAMPLE                               │
└─────────────────────────────────────────────────────────────────────────────┘

1. Test Fails
   ───────────
   ✗ ORB_FAKEOUT (SPY): HTTP 500: Internal server error
   Trace: abc123def456...


2. Check Console Output
   ────────────────────
   Errors:
     - HTTP 500: Internal server error
   Missing Data:
     - signal_id
     - enrichment


3. Open Sentry
   ───────────
   Navigate to: Performance > Traces
   Filter: environment = "production-e2e-test"
   Search: abc123def456


4. Analyze Trace
   ─────────────
   production-e2e-webhook-test (1523ms) ❌
   ├─ webhook-ingestion (50ms) ✅
   ├─ data-enrichment (1200ms) ❌ ERROR
   │  ├─ fetch-market-data (40ms) ✅
   │  └─ fetch-gex-data (1160ms) ❌ TIMEOUT
   └─ (rest of trace missing)


5. Identify Root Cause
   ───────────────────
   Issue: fetch-gex-data timing out
   Cause: GEX API not responding
   Impact: Enrichment fails, webhook processing aborts


6. Fix
   ───
   - Check GEX API status
   - Verify API keys
   - Add timeout handling
   - Add fallback for missing GEX data


7. Re-test
   ───────
   npm run test:production
   
   Result:
   ✓ ORB_FAKEOUT (SPY): 200 - 245ms ✅
   
   Trace shows:
   production-e2e-webhook-test (245ms) ✅
   ├─ webhook-ingestion (50ms) ✅
   ├─ data-enrichment (120ms) ✅
   │  ├─ fetch-market-data (40ms) ✅
   │  └─ fetch-gex-data (35ms) ✅
   ├─ ab-routing (10ms) ✅
   ├─ engine-execution (45ms) ✅
   └─ database-save (20ms) ✅
```

## Integration with CI/CD

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CI/CD INTEGRATION                                   │
└─────────────────────────────────────────────────────────────────────────────┘

GitHub Actions Example:
───────────────────────

name: Production E2E Tests
on:
  push:
    branches: [main]
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Setup Node
        uses: actions/setup-node@v2
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm install
      
      - name: Run production E2E tests
        env:
          PRODUCTION_URL: ${{ secrets.PRODUCTION_URL }}
          SENTRY_DSN: ${{ secrets.SENTRY_DSN }}
          TEST_COUNT: 10
        run: npm run test:production
      
      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v2
        with:
          name: test-results
          path: test-results/
```

## Monitoring Dashboard

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      SENTRY DASHBOARD VIEW                                  │
└─────────────────────────────────────────────────────────────────────────────┘

Performance > Traces
────────────────────

Filter: environment = "production-e2e-test"

Recent Traces:
┌────────────────────────────────────────────────────────────────────────────┐
│ Trace ID          │ Status │ Duration │ Timestamp           │ Errors       │
├────────────────────────────────────────────────────────────────────────────┤
│ abc123def456...   │   ✅   │  245ms   │ 2024-01-15 10:30:00 │ 0            │
│ ghi789jkl012...   │   ✅   │  312ms   │ 2024-01-15 10:30:02 │ 0            │
│ mno345pqr678...   │   ❌   │ 1523ms   │ 2024-01-15 10:30:04 │ 1 (timeout)  │
│ stu901vwx234...   │   ✅   │  198ms   │ 2024-01-15 10:30:06 │ 0            │
│ yza567bcd890...   │   ✅   │  267ms   │ 2024-01-15 10:30:08 │ 0            │
└────────────────────────────────────────────────────────────────────────────┘

Click any trace to see detailed span breakdown
```

## Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            QUICK REFERENCE                                  │
└─────────────────────────────────────────────────────────────────────────────┘

Run Tests:
  npm run test:production

View Analysis Guide:
  npm run analyze:sentry

Check Sentry:
  1. Go to Sentry dashboard
  2. Performance > Traces
  3. Filter: environment = "production-e2e-test"
  4. Find trace by ID

Fix Issues:
  1. Identify issue type (error, missing, slow)
  2. Check Sentry trace for details
  3. Fix root cause
  4. Re-test to verify

Monitor:
  - Run after deployments
  - Schedule regular tests (every 6 hours)
  - Set up alerts for failures
  - Track trends over time
```
