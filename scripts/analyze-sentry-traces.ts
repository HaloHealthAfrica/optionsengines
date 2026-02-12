#!/usr/bin/env tsx
/**
 * Analyze Sentry Traces for Production E2E Tests
 * 
 * This script helps you analyze Sentry traces to identify:
 * - What's working vs broken
 * - Where data is missing
 * - Performance bottlenecks
 * - Error patterns
 * 
 * Usage:
 *   npx tsx scripts/analyze-sentry-traces.ts
 * 
 * Note: This is a template/guide. You'll need to implement Sentry API integration
 * or manually review traces in the Sentry dashboard.
 */

console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                   SENTRY TRACE ANALYSIS GUIDE                              ║
╚════════════════════════════════════════════════════════════════════════════╝

After running production E2E tests, use this guide to analyze Sentry traces
and identify issues in your webhook processing pipeline.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 STEP 1: ACCESS SENTRY TRACES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Go to your Sentry dashboard
2. Navigate to: Performance > Traces
3. Filter by environment: "production-e2e-test"
4. Sort by: Most Recent

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 STEP 2: WHAT TO LOOK FOR IN EACH TRACE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

A healthy webhook trace should show these spans:

┌─ production-e2e-webhook-test (root span)
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

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ STEP 3: IDENTIFY WHAT'S BROKEN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Look for RED spans (errors) in the trace:

🔴 webhook-ingestion ERROR
   → Problem: Webhook validation or ingestion failed
   → Check: Payload format, required fields, authentication
   → Fix: Update webhook schema validation

🔴 fetch-market-data ERROR
   → Problem: External API call failed
   → Check: API keys, rate limits, network connectivity
   → Fix: Verify API credentials, implement retry logic

🔴 fetch-gex-data ERROR
   → Problem: GEX data unavailable
   → Check: GEX provider status, API keys
   → Fix: Add fallback or graceful degradation

🔴 ab-routing ERROR
   → Problem: Variant assignment failed
   → Check: Feature flags, routing logic
   → Fix: Verify feature flag configuration

🔴 engine-a-decision ERROR
   → Problem: Engine A decision logic failed
   → Check: Decision logic, data availability
   → Fix: Review Engine A code, add error handling

🔴 engine-b-decision ERROR
   → Problem: Multi-agent decision failed
   → Check: Agent activation logic, data requirements
   → Fix: Review agent code, verify data availability

🔴 database-operations ERROR
   → Problem: Database save failed
   → Check: Database connectivity, schema, constraints
   → Fix: Verify database connection, check for schema issues

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  STEP 4: IDENTIFY MISSING DATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Look for MISSING spans (operations that should happen but don't):

⚠️  Missing: data-enrichment span
   → Problem: Enrichment service not running or not instrumented
   → Impact: Engines making decisions without market context
   → Fix: Start enrichment service, add Sentry instrumentation

⚠️  Missing: fetch-gex-data span
   → Problem: GEX data not being fetched
   → Impact: Agents can't adjust for gamma exposure
   → Fix: Enable GEX data fetching, verify API integration

⚠️  Missing: ab-routing span
   → Problem: A/B routing not active
   → Impact: All signals going to Engine A only
   → Fix: Enable A/B routing feature flag

⚠️  Missing: engine-b-decision span
   → Problem: Engine B not executing (even for variant B)
   → Impact: Multi-agent system not being tested
   → Fix: Verify Engine B is enabled, check variant assignment

⚠️  Missing: agent spans (orb-agent, strat-agent, etc.)
   → Problem: Specialist agents not activating
   → Impact: Engine B making decisions without agent input
   → Fix: Check agent activation conditions, verify data availability

⚠️  Missing: shadow-execution span
   → Problem: Shadow execution not happening for Engine B
   → Impact: Can't track Engine B performance
   → Fix: Implement shadow execution, add instrumentation

⚠️  Missing: database-operations span
   → Problem: Data not being persisted
   → Impact: No historical record of decisions
   → Fix: Verify database integration, add save operations

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🐌 STEP 5: IDENTIFY PERFORMANCE ISSUES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Look for SLOW spans (taking longer than expected):

🐌 fetch-market-data > 500ms
   → Problem: External API slow or timing out
   → Impact: Delayed decisions, potential timeouts
   → Fix: Add caching, implement parallel fetching, use faster API

🐌 data-enrichment > 1000ms
   → Problem: Too many sequential API calls
   → Impact: High latency for webhook processing
   → Fix: Parallelize API calls, add caching layer

🐌 engine-b-decision > 500ms
   → Problem: Agent execution too slow
   → Impact: Delayed decisions, poor user experience
   → Fix: Optimize agent logic, add timeouts, parallelize agents

🐌 database-operations > 200ms
   → Problem: Database queries slow
   → Impact: Overall system slowdown
   → Fix: Add indexes, optimize queries, use connection pooling

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ STEP 6: VERIFY WHAT'S WORKING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Look for GREEN spans (successful operations):

✅ webhook-ingestion: 50ms
   → Webhook received and validated successfully
   → Payload format correct, authentication working

✅ data-enrichment: 200ms
   → Market data fetched successfully
   → All external APIs responding
   → Snapshot built correctly

✅ ab-routing: 10ms
   → Variant assigned successfully
   → Feature flags working
   → Routing logic correct

✅ engine-a-decision: 30ms
   → Engine A making decisions
   → Decision logic working
   → Live execution happening

✅ engine-b-decision: 150ms
   → Engine B making decisions
   → Agents activating correctly
   → Shadow execution working

✅ database-operations: 50ms
   → Data persisted successfully
   → All required fields saved
   → Database healthy

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 STEP 7: ANALYZE PATTERNS ACROSS TRACES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Compare multiple traces to identify patterns:

Pattern: All traces missing GEX data
   → Systemic issue: GEX service not running
   → Action: Start GEX service, verify configuration

Pattern: Intermittent fetch-market-data errors
   → Systemic issue: API rate limiting or instability
   → Action: Implement retry logic, add fallback provider

Pattern: Engine B slower than Engine A
   → Expected: Multi-agent processing takes longer
   → Action: Optimize if > 500ms, otherwise acceptable

Pattern: Some traces missing ab-routing
   → Systemic issue: Feature flag inconsistency
   → Action: Verify feature flag configuration

Pattern: Database errors on specific symbols
   → Systemic issue: Data validation or constraint issue
   → Action: Review database schema, check constraints

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔧 STEP 8: PRIORITIZE FIXES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Priority 1 (Critical - Fix Immediately):
  🔴 Webhook ingestion failures
  🔴 Database save failures
  🔴 Engine A decision failures (affects live trading)

Priority 2 (High - Fix Soon):
  ⚠️  Missing data enrichment
  ⚠️  Missing A/B routing
  🐌 Severe performance issues (> 2s total latency)

Priority 3 (Medium - Fix This Week):
  ⚠️  Missing Engine B execution
  ⚠️  Missing agent activations
  🐌 Moderate performance issues (500ms - 2s)

Priority 4 (Low - Fix When Possible):
  ⚠️  Missing optional data (GEX, technical indicators)
  🐌 Minor performance issues (< 500ms)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 STEP 9: DOCUMENT FINDINGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create a findings document with:

1. Summary of test results
2. List of broken components with trace IDs
3. List of missing data/features with trace IDs
4. Performance bottlenecks with measurements
5. Prioritized action items
6. Assigned owners for each fix

Example template:

---
# Production E2E Test Findings - [Date]

## Summary
- Total Tests: 10
- Successful: 7
- Failed: 3
- Critical Issues: 2

## Critical Issues
1. GEX data fetching failing (Trace: abc123)
   - Impact: Agents can't adjust for gamma exposure
   - Owner: [Name]
   - Deadline: [Date]

## High Priority Issues
1. A/B routing not active (Trace: def456)
   - Impact: Engine B not being tested
   - Owner: [Name]
   - Deadline: [Date]

## Performance Issues
1. Data enrichment slow (avg 800ms, Trace: ghi789)
   - Impact: High latency
   - Owner: [Name]
   - Deadline: [Date]

## Working Well
- Webhook ingestion: 100% success
- Engine A decisions: Working correctly
- Database operations: Fast and reliable
---

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 STEP 10: IMPLEMENT FIXES AND RE-TEST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

After implementing fixes:

1. Run production E2E tests again
2. Compare new traces with previous traces
3. Verify issues are resolved
4. Document improvements
5. Update monitoring and alerts

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For more information, see:
- PRODUCTION_E2E_TESTING_GUIDE.md
- .kiro/specs/e2e-testing-with-synthetic-data/

╚════════════════════════════════════════════════════════════════════════════╝
`);
