# Pipeline Diagnostic Tools

## Overview

This directory contains comprehensive diagnostic tools to analyze the end-to-end webhook processing pipeline, identify gaps at each stage, and explain why GEX/Gamma data may not be producing sensible trading decisions.

## Quick Start

### Windows (PowerShell)
```powershell
.\scripts\diagnostics\run-full-diagnostic.ps1
```

### Linux/Mac (Bash)
```bash
chmod +x scripts/diagnostics/run-full-diagnostic.sh
./scripts/diagnostics/run-full-diagnostic.sh
```

## What Gets Analyzed

### Part 1: Pipeline Health - Stage-by-Stage Analysis

1. **Webhook Ingestion & Validation**
   - How many webhooks were received today
   - Validation pass/fail rates
   - Common rejection reasons (invalid_signature, invalid_payload, etc.)

2. **Deduplication**
   - Duplicate detection rates
   - Symbols/timeframes with excessive duplicates
   - Dedup window effectiveness

3. **Signal Persistence**
   - Webhooks that were processed but have no signal record
   - Signal creation success rate
   - Silent failures

4. **Enrichment (GEX, Market Context, Options Flow)**
   - **CRITICAL**: Did GEX data actually reach the pipeline?
   - Enrichment coverage percentage
   - GEX snapshot availability
   - Market data availability
   - Enrichment delay times

5. **Risk Checks**
   - Signals rejected by risk checks
   - Common rejection reasons (MARKET_CLOSED, MAX_POSITIONS, etc.)
   - Risk check pass rate

6. **Experiment Assignment & Execution Policy**
   - A/B test routing (Engine A vs Engine B)
   - Execution mode distribution
   - Shadow trade vs real order split

7. **Recommendations**
   - Recommendation generation rate
   - Strike/expiration selection success
   - Confidence scores
   - GEX context usage in recommendations

8. **Orders & Fills**
   - Order creation rate
   - Fill rate
   - Time from signal to fill
   - Execution quality

### Part 2: GEX & Gamma Deep Dive

**Why This Matters**: GEX/Gamma data should inform position sizing, direction confirmation, strategy selection, and strike selection. If trades "made no sense," this section identifies why.

1. **GEX Data Quality Check**
   - Are GEX snapshots being saved?
   - Is data all zeros (API failure)?
   - Is zero gamma level calculated?
   - Which provider is being used (Unusual Whales vs MarketData.app)?

2. **GEX Data Flow Tracing**
   - Snapshot → Enrichment → Recommendation
   - Where does GEX data get lost?
   - Is gamma regime being calculated?
   - Are size multipliers being applied?

3. **GEX vs Trade Direction Alignment**
   - Are we trading WITH or AGAINST GEX signals?
   - Long gamma + long direction = mean reversion (aligned)
   - Short gamma + long direction = breakout (high risk)
   - Price vs zero gamma level analysis

4. **Options Flow Alignment**
   - Put/Call ratio vs trade direction
   - Flow confirms vs contradicts trades
   - Dark pool activity correlation

### Part 3: Trade Quality Forensics

1. **Full Trade Audit Trail**
   - Complete story: webhook → enrichment → recommendation → order → fill → P&L
   - Timing analysis
   - Data quality at each step

2. **Trades That Violated GEX Logic**
   - NO_GEX_DATA: Trade made without GEX context
   - SHORT_GAMMA_NO_SIZE_REDUCTION: Should have reduced size, didn't
   - SHORT_GAMMA_OVERSIZED: Position too large for short gamma regime
   - LONG_BELOW_ZERO_GAMMA: Long position below pivot point
   - SHORT_ABOVE_ZERO_GAMMA: Short position above pivot point
   - LONG_AGAINST_BEARISH_FLOW: Trading against options flow
   - NO_STRIKE_SELECTED: Strike selection failed

## Output

### Report Location
```
scripts/diagnostics/reports/diagnostic_report_YYYYMMDD_HHMMSS.txt
```

### Report Structure

```
============================================================================
EXECUTIVE SUMMARY: PIPELINE HEALTH BY STAGE
============================================================================

Stage                    | Total | Passed | Failed | Pending | Pass Rate % | Top Failure Reason
-------------------------|-------|--------|--------|---------|-------------|-------------------
Webhook Validation       |   150 |    142 |      8 |       0 |        94.7 | invalid_signature
Deduplication            |   142 |    128 |     14 |       0 |        90.1 | Duplicate within 60s
Signal Persistence       |   142 |    142 |      0 |       0 |       100.0 | -
Enrichment               |   142 |     89 |     53 |       0 |        62.7 | GEX data not fetched
Risk Checks              |   142 |    120 |     22 |       0 |        84.5 | MARKET_CLOSED
Experiment Assignment    |   120 |    120 |      0 |       0 |       100.0 | -
Recommendations          |   120 |     98 |     22 |       0 |        81.7 | No strike selected
Order Creation           |   120 |     95 |     25 |       0 |        79.2 | Order not created
Fills                    |    95 |     87 |      8 |       5 |        91.6 | Order not filled

============================================================================
ROOT CAUSE ANALYSIS CHECKLIST
============================================================================

Data Pipeline Issues:
  GEX Snapshots Today: 0 ❌ CRITICAL
  GEX Data All Zeros: 15 ⚠️ WARNING
  Enrichment Without GEX: 53 ⚠️ WARNING

Decision Engine Issues:
  Recommendations Without Strike: 22 ❌ CRITICAL
  Recommendations Without GEX Context: 89 ⚠️ WARNING

============================================================================
FINAL VERDICT
============================================================================

Trades made no sense because:
1. GEX data was not being fetched (0 snapshots today)
2. Enrichment proceeded without GEX context (53 signals)
3. Recommendations ignored gamma regime (89 signals)
4. Strike selection failed without GEX pivot points (22 signals)
```

## Interpreting Results

### Critical Issues (❌)
- **0 GEX Snapshots**: Unusual Whales API key expired or provider not configured
- **Recommendations Without Strike**: Strike selection module is broken
- **Signal Persistence Failures**: Database insert is failing silently

### Warnings (⚠️)
- **GEX Data All Zeros**: API returning empty data (symbol not supported or rate limited)
- **Enrichment Without GEX**: GEX snapshots exist but aren't being passed to enrichment
- **Recommendations Without GEX Context**: Decision engine not reading enriched data

### Good Signs (✅)
- **100% Signal Persistence**: Webhooks → Signals working correctly
- **100% Experiment Assignment**: A/B testing routing is working
- **>90% Fill Rate**: Order execution is reliable

## Common Root Causes

### 1. GEX Data Not Fetched
**Symptoms**: 0 GEX snapshots, enrichment_has_gex = false

**Possible Causes**:
- Unusual Whales API key expired
- Provider priority doesn't include `unusualwhales` or `marketdata`
- GEX service not running
- Rate limit exceeded

**Fix**:
```typescript
// Check src/services/providers/unusualwhales-client.ts
// Verify API key in environment variables
// Check provider priority in config
```

### 2. GEX Data Not Reaching Enrichment
**Symptoms**: GEX snapshots exist, but enrichment_has_gex = false

**Possible Causes**:
- Enrichment service not reading from `gex_snapshots` table
- Time window mismatch (looking for GEX data outside 5-minute window)
- Wiring issue between services

**Fix**:
```typescript
// Check src/services/signal-enrichment.service.ts
// Verify GEX snapshot query logic
// Check time window alignment
```

### 3. Decision Engine Ignoring GEX
**Symptoms**: enrichment_has_gex = true, but rec_gamma_regime = NULL

**Possible Causes**:
- Engine A doesn't read `gammaRegime` field
- Engine B agents don't receive GEX in context
- Position sizing multiplier not implemented
- Confidence adjustments not applied

**Fix**:
```typescript
// Check src/lib/entryEngine/evaluator.ts (Engine A)
// Check src/agents/core/*.ts (Engine B)
// Verify GEX fields are being read from enriched_data
```

### 4. Strike Selection Failing
**Symptoms**: Recommendations with strike = NULL

**Possible Causes**:
- Zero gamma level not available
- Strike selection module not using GEX pivot points
- Options chain data not available

**Fix**:
```typescript
// Check src/services/strike-selection.service.ts
// Verify zero gamma level is being used
// Check options chain data availability
```

## Running Individual Queries

If you want to run specific diagnostic queries:

```bash
# Just the summary
psql -d optionsengines -f scripts/diagnostics/generate-summary.sql

# Just pipeline forensics
psql -d optionsengines -f scripts/diagnostics/pipeline-forensics.sql

# Just GEX analysis
psql -d optionsengines -f scripts/diagnostics/gex-deep-dive.sql

# Just trade quality
psql -d optionsengines -f scripts/diagnostics/trade-quality-forensics.sql
```

## Customizing the Analysis

### Change Date Range
Edit the SQL files and replace:
```sql
WHERE created_at >= CURRENT_DATE
```

With:
```sql
WHERE created_at >= '2026-02-08'  -- Specific date
WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'  -- Last 7 days
```

### Filter by Symbol
Add to WHERE clauses:
```sql
AND symbol = 'SPY'
```

### Filter by Timeframe
Add to WHERE clauses:
```sql
AND timeframe = '5m'
```

## Troubleshooting

### "psql: command not found"
Install PostgreSQL client:
- **Windows**: Download from postgresql.org
- **Mac**: `brew install postgresql`
- **Linux**: `sudo apt-get install postgresql-client`

### "Connection refused"
Check database connection settings:
```bash
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=optionsengines
export DB_USER=postgres
```

### "Permission denied"
Make script executable:
```bash
chmod +x scripts/diagnostics/run-full-diagnostic.sh
```

## Next Steps After Diagnosis

1. **Review the report** - Look for ❌ CRITICAL and ⚠️ WARNING flags
2. **Identify root cause** - Use the checklist to pinpoint the issue
3. **Fix the code** - Update the relevant service/module
4. **Re-run diagnostic** - Verify the fix worked
5. **Monitor production** - Set up alerts for these metrics

## Support

For questions or issues with the diagnostic tools, check:
- `.kiro/specs/ui-data-quality-audit/` - Full audit documentation
- `src/services/` - Service implementations
- `src/routes/` - API endpoints
