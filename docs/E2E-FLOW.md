# End-to-End System Documentation

## Dual-Engine Options Trading Platform

**Version**: 1.0.0
**Last Updated**: 2026-02-15
**Classification**: Internal Technical Reference

---

# 1. SYSTEM OVERVIEW

## System Name

**Dual-Engine Options Trading Platform** (`dual-engine-options-trading-platform`)

## Purpose

A production-grade, webhook-driven automated options trading system that ingests trading signals from TradingView, processes them through a dual-engine decision architecture (rule-based + AI multi-agent), applies risk management gates, selects option strikes, executes paper trades via Alpaca, monitors positions for exit conditions, and captures performance feedback for adaptive tuning.

## Current Environment

| Property | Value |
|---|---|
| Mode | **PAPER** (paper trading only) |
| Environment | Production deployment on Vercel/Railway + Neon PostgreSQL + Upstash Redis |
| Node.js | >= 20.0.0 |
| Module System | ESM (`"type": "module"`) |
| Frontend | Next.js dashboard at `optionsengines.vercel.app` |

## Core Objective

Fully automated webhook-to-execution options trading pipeline:
1. Receive TradingView webhook signals
2. Normalize and validate payloads
3. Enrich with market data (GEX, options flow, indicators)
4. Route through dual decision engines via A/B experiment framework
5. Apply multi-layered risk gating (position limits, market hours, MTF bias, portfolio guard, confluence)
6. Select option strikes and create paper orders
7. Monitor positions for exit conditions (profit target, stop loss, time stop, DTE, exit intelligence)
8. Capture outcomes for performance feedback and adaptive tuning

## Supported Instruments

| Symbol | Type | Status |
|---|---|---|
| SPY | ETF Options | Primary |
| QQQ | ETF Options | Primary |
| IWM | ETF Options | Primary |
| SPX | Index Options | Supported |

Configurable via `GAMMA_METRICS_SYMBOLS` (default: `SPY,QQQ,IWM`).

## Execution Mode

**Paper only** (`APP_MODE=PAPER`). The system creates paper orders and simulated fills. No live brokerage execution occurs. Engine B operates in shadow mode for A/B comparison. The policy engine enforces `ENGINE_A_PRIMARY` in paper mode, with Engine B running shadow trades when enabled.

## High-Level Flow

```
TradingView Alert
    │
    ▼
POST /webhook (Express)
    │
    ├── V3 MTF Bias payload? → BiasStateAggregator
    ├── Legacy BIAS_SNAPSHOT? → V1 MTF Bias handler
    └── Trading signal? → processWebhookPayload()
        │
        ▼
    Validate (Zod) → Normalize (direction, timeframe, timestamp)
    → Deduplicate (SHA-256 hash, 60s window)
    → Store signal (status: 'pending')
    → Log webhook_event
        │
        ▼
    OrchestratorWorker (polls every 30s)
    → getUnprocessedSignals() [SELECT FOR UPDATE SKIP LOCKED]
    → buildSignalEnrichment()
        ├── Market session evaluation
        ├── Risk limit checks (positions, exposure)
        ├── Market data fetch (price, candles, indicators)
        ├── GEX snapshot
        ├── Options flow snapshot
        └── Confluence scoring
    → createExperiment() [deterministic hash → variant A or B]
    → getExecutionPolicy() [ENGINE_A_PRIMARY | SHADOW_ONLY]
    → invokeEngine{A|B}()
        │
        ├── Engine A: buildRecommendation()
        │   ├── MTF Bias gate
        │   ├── Portfolio guard
        │   ├── Entry decision engine (Tier 1-3 rules)
        │   ├── Strike selection
        │   └── Risk multiplier sizing
        │
        └── Engine B: buildEngineBRecommendation()
            ├── MTF Bias gate
            ├── Portfolio guard
            ├── Multi-agent analysis (8 agents)
            ├── MetaDecisionAgent aggregation
            ├── Strike selection
            └── Risk multiplier sizing
        │
        ▼
    applyGammaOverride() → applyPolicyToRecommendation()
    → persistRecommendation() → updateSignalStatus()
    → createPaperOrders() → handleShadowExecution()
        │
        ▼
    OrderCreatorWorker (30s) → PaperExecutorWorker (10s)
    → Fetch option price → Create trade → Create/close position
        │
        ▼
    PositionRefresherWorker (60s) → Update current_price, unrealized_pnl
    ExitMonitorWorker (60s)
        ├── Exit Intelligence (bias-aware adjustments)
        ├── Exit Decision Engine (Tier 1-4 rules)
        ├── Profit target / Stop loss
        ├── Max hold time / Min DTE
        └── Create closing order → PaperExecutor fills → captureTradeOutcome()
        │
        ▼
    Performance Feedback → bias_trade_performance table
    → Adaptive tuning → Dashboard reflection
```

---

# 2. ARCHITECTURE DIAGRAM (TEXTUAL)

## Layer 1 — Ingestion

| Property | Details |
|---|---|
| **Files** | `src/routes/webhook.ts`, `src/routes/market-webhooks.ts`, `src/routes/mtf-bias-webhook.ts` |
| **Services** | `webhook-ingestion.service.ts`, `mtf-bias-webhook-handler.service.ts` |
| **Entry Function** | `processWebhookPayload()` in `webhook.ts` |
| **Output Contract** | `{ httpStatus, response, status: 'ACCEPTED'|'DUPLICATE'|'REJECTED'|'ERROR', requestId }` |
| **DB Tables** | `signals`, `webhook_events` |
| **Redis Keys** | `flow:{symbol}:{date}` (sorted sets for flow data), `price:{symbol}` (price ticks) |
| **External APIs** | None (receives from TradingView) |

## Layer 2 — Normalization

| Property | Details |
|---|---|
| **Files** | `src/routes/webhook.ts` (inline functions) |
| **Services** | None (inline in route handler) |
| **Entry Functions** | `normalizeDirection()`, `normalizeTimeframe()`, `normalizeTimestamp()` |
| **Output Contract** | `{ symbol: string, direction: 'long'|'short', timeframe: string, timestamp: Date }` |
| **DB Tables** | None (pre-storage normalization) |
| **Redis Keys** | None |
| **External APIs** | None |

## Layer 3 — Orchestration

| Property | Details |
|---|---|
| **Files** | `src/orchestrator/orchestrator-service.ts`, `src/orchestrator/signal-processor.ts`, `src/workers/orchestrator-worker.ts` |
| **Services** | `OrchestratorService`, `SignalProcessor`, `ExperimentManager`, `PolicyEngine` |
| **Entry Function** | `OrchestratorService.processSignals()` → `processSignal()` |
| **Output Contract** | `ExperimentResult { experiment, policy, market_context, engine_a_recommendation?, engine_b_recommendation?, success, error? }` |
| **DB Tables** | `signals` (status update), `experiments`, `execution_policies`, `decision_recommendations` |
| **Redis Keys** | None directly (enrichment may use cache) |
| **External APIs** | None directly |

## Layer 4 — Decision Engines

| Property | Details |
|---|---|
| **Files** | `src/orchestrator/engine-invokers.ts`, `src/lib/entryEngine/evaluator.ts`, `src/agents/core/*.ts`, `src/agents/specialists/*.ts`, `src/agents/subagents/*.ts` |
| **Services** | `buildRecommendation()` (Engine A), `buildEngineBRecommendation()` (Engine B), `MetaDecisionAgent` |
| **Entry Functions** | `createEngineAInvoker()`, `createEngineBInvoker()` |
| **Output Contract** | `TradeRecommendation { experiment_id, engine, symbol, direction, strike, expiration, quantity, entry_price, is_shadow }` |
| **DB Tables** | `agent_decisions` (Engine B outputs), `decision_recommendations` |
| **Redis Keys** | None |
| **External APIs** | Market data providers (TwelveData, MarketData.app, Alpaca) for Engine B candles/indicators |

## Layer 5 — Strike Selection

| Property | Details |
|---|---|
| **Files** | `src/services/strike-selection.service.ts` |
| **Services** | `selectStrike()` |
| **Entry Function** | `selectStrike(symbol, direction)` |
| **Output Contract** | `StrikeSelection { strike: number, expiration: Date, optionType: 'call'|'put' }` |
| **DB Tables** | None |
| **Redis Keys** | None |
| **External APIs** | Market data (stock price for ATM strike calculation) |

## Layer 6 — Risk Gate

| Property | Details |
|---|---|
| **Files** | `src/services/signal-enrichment.service.ts`, `src/agents/core/risk-agent.ts`, `src/services/bias-state-aggregator/portfolio-guard-integration.service.ts`, `src/services/bias-state-aggregator/risk-model-integration.service.ts`, `src/services/bias-state-aggregator/effective-gating.ts` |
| **Services** | `buildSignalEnrichment()`, `RiskAgent`, `evaluateExposure()`, `getRiskMultiplierFromState()` |
| **Entry Function** | `buildSignalEnrichment()` (pre-engine), `RiskAgent.analyze()` (Engine B) |
| **Output Contract** | `SignalEnrichmentResult { enrichedData, riskResult, rejectionReason, queueUntil?, decisionOnly? }` |
| **DB Tables** | `risk_limits`, `refactored_positions` (count queries), `bias_state_current` |
| **Redis Keys** | Bias state cache keys |
| **External APIs** | Market hours check |

## Layer 7 — Order Management

| Property | Details |
|---|---|
| **Files** | `src/orchestrator/orchestrator-service.ts` (`createPaperOrders()`), `src/workers/order-creator.ts` |
| **Services** | `OrchestratorService.createPaperOrders()`, `OrderCreatorWorker` |
| **Entry Function** | Inline in `processSignal()` |
| **Output Contract** | Row in `orders` table with `status: 'pending_execution'` |
| **DB Tables** | `orders` |
| **Redis Keys** | None |
| **External APIs** | None |

## Layer 8 — Execution

| Property | Details |
|---|---|
| **Files** | `src/workers/paper-executor.ts` |
| **Services** | `PaperExecutorWorker` |
| **Entry Function** | `PaperExecutorWorker.run()` |
| **Output Contract** | `orders.status = 'filled'`, new row in `trades`, new row in `refactored_positions` |
| **DB Tables** | `orders`, `trades`, `refactored_positions` |
| **Redis Keys** | None |
| **External APIs** | Market data (option price for fill price) |

## Layer 9 — Position Monitoring

| Property | Details |
|---|---|
| **Files** | `src/workers/position-refresher.ts` |
| **Services** | `PositionRefresherWorker` |
| **Entry Function** | `PositionRefresherWorker.run()` |
| **Output Contract** | Updated `current_price`, `unrealized_pnl` on `refactored_positions` |
| **DB Tables** | `refactored_positions` |
| **Redis Keys** | None |
| **External APIs** | Market data (option price) |

## Layer 10 — Exit Logic

| Property | Details |
|---|---|
| **Files** | `src/workers/exit-monitor.ts`, `src/lib/exitEngine/evaluator.ts`, `src/services/exit-intelligence/exit-intelligence.service.ts` |
| **Services** | `ExitMonitorWorker`, `evaluateExitDecision()`, `evaluateExitAdjustments()` |
| **Entry Function** | `ExitMonitorWorker.run()` |
| **Output Contract** | Position status → `'closing'`, new exit order in `orders` |
| **DB Tables** | `refactored_positions`, `orders`, `exit_rules` |
| **Redis Keys** | None |
| **External APIs** | Market data (option + stock price) |

## Layer 11 — Performance Feedback

| Property | Details |
|---|---|
| **Files** | `src/services/performance-feedback/performance-collector.service.ts`, `src/services/performance-feedback/performance-analyzer.service.ts`, `src/services/performance-feedback/adaptive-tuner.service.ts` |
| **Services** | `captureTradeOutcome()`, `PerformanceAnalyzer`, `AdaptiveTuner` |
| **Entry Function** | `captureTradeOutcome()` (called from PaperExecutor on position close) |
| **Output Contract** | Row in `bias_trade_performance` |
| **DB Tables** | `bias_trade_performance`, `bias_adaptive_config_history` |
| **Redis Keys** | `performance:*` (cached analytics) |
| **External APIs** | None |

## Layer 12 — UI / Monitoring

| Property | Details |
|---|---|
| **Files** | `frontend/components/Dashboard.js`, `frontend/components/Orders.js`, `frontend/components/Positioning.js`, `src/routes/dashboard.ts`, `src/routes/monitoring.ts`, `src/routes/orders.ts` |
| **Services** | Express API routes, WebSocket real-time updates |
| **Entry Function** | Various route handlers |
| **Output Contract** | JSON API responses, WebSocket position/risk updates |
| **DB Tables** | All tables (read) |
| **Redis Keys** | `gex:*`, `analytics:*`, `performance:*` |
| **External APIs** | None (serves to frontend) |

---

# 3. WEBHOOK INGESTION

## Expected Webhooks

The system accepts three webhook types at different endpoints:

### 1. Trading Signal Webhooks — `POST /webhook`
Primary TradingView trading signals. Also routes MTF Bias V3 and legacy BIAS_SNAPSHOT payloads.

### 2. Market Data Webhooks — `POST /api/webhooks/{flow|price|chain}`
Market data ingestion (flow, price ticks, options chain snapshots). HMAC-signed.

### 3. MTF Bias Webhooks — `POST /api/webhooks/mtf-bias`
Multi-timeframe bias engine payloads.

## Trading Signal Payload Schema

Validated by Zod schema in `src/routes/webhook.ts`:

```json
{
  "symbol": "SPY",
  "direction": "long",
  "timeframe": "5m",
  "timestamp": "2026-02-15T10:30:00Z",
  "price": 595.42,
  "indicators": {
    "ema8": 595.10,
    "ema21": 594.80,
    "atr": 1.25
  },
  "confidence": 75,
  "pattern_strength": 80,
  "mtf_alignment": 70,
  "secret": "your-hmac-secret"
}
```

**Required fields** (at least one of):
- `symbol` OR `ticker` OR `meta.ticker` — instrument identifier (1–20 chars)

**Direction** (at least one of, normalized to `'long'`/`'short'`):
- `direction` — `'long'|'short'|'LONG'|'SHORT'|'CALL'|'PUT'|'BUY'|'SELL'`
- `side`, `trend`, `bias`, `action` — mapped through `normalizeDirection()`
- `signal.type`, `signal.direction` — nested signal object
- `regime_context.local_bias`, `execution_guidance.bias`, `market.market_bias` — deep extraction

**Timeframe** (at least one of, normalized to `'5m'`/`'1h'`/`'1d'` etc.):
- `timeframe`, `tf`, `interval`, `trigger_timeframe`, `triggerTimeframe`, `meta.timeframe`
- Numeric values treated as minutes (e.g., `5` → `"5m"`)
- Fallback: session-based detection (`OPEN`/`PRE`/`POST` → `"1d"`)

**Optional fields**:
- `timestamp` — Unix epoch (seconds or ms) or ISO string. Default: `new Date()`
- `price` — Current price at signal time
- `indicators` — Technical indicator snapshot
- `strike`, `expiration` — Pre-selected option parameters
- `is_test`, `test_session_id`, `test_scenario`, `sequence_number` — Test metadata
- `secret` — HMAC authentication (stripped before storage)
- `metadata` — Nested test metadata object

**Passthrough**: Schema uses `.passthrough()` to accept additional fields from various TradingView indicator formats.

## Validation Logic

1. **Payload size check**: Max 128KB raw body. Returns 413 if exceeded.
2. **HMAC signature verification**: If `HMAC_SECRET` is configured and `X-Webhook-Signature` header present, validates SHA-256 HMAC. Returns 401 on mismatch.
3. **Zod schema validation**: `webhookSchema.safeParse(body)`. Returns 400 with field-level errors on failure.
4. **Symbol extraction**: Must resolve `symbol` from `symbol`, `ticker`, or `meta.ticker`. Returns 400 if missing.
5. **Timeframe normalization**: Must produce a valid timeframe string. Returns 400 if unresolvable.
6. **Direction normalization**: Must resolve to `'long'` or `'short'`. Returns 400 if unresolvable.

## Idempotency Logic

**Deduplication** via `isDuplicate()`:
- Queries `signals` table for matching `(symbol, direction, timeframe)` within a 60-second sliding window
- Filters by `is_test` flag to isolate test signals
- Returns HTTP 200 with `status: 'DUPLICATE'` (not an error)

**Signal hash**: SHA-256 of `{symbol}:{direction}:{timeframe}:{timestamp}` stored in `signal_hash` column.

## Failure Handling

| Failure | HTTP Code | Status | Logged |
|---|---|---|---|
| Payload too large | 413 | `REJECTED` | `webhook_events.status = 'invalid_payload'` |
| Invalid HMAC | 401 | `REJECTED` | `webhook_events.status = 'invalid_signature'` |
| Invalid payload | 400 | `REJECTED` | `webhook_events.status = 'invalid_payload'` |
| Missing symbol | 400 | `REJECTED` | `webhook_events.status = 'invalid_payload'` |
| Missing timeframe | 400 | `REJECTED` | `webhook_events.status = 'invalid_payload'` |
| Missing direction | 400 | `REJECTED` | `webhook_events.status = 'invalid_payload'` |
| Duplicate signal | 200 | `DUPLICATE` | `webhook_events.status = 'duplicate'` |
| Internal error | 500 | `ERROR` | `webhook_events.status = 'error'` |

## Logging

Every webhook invocation creates a row in `webhook_events` with:
- `request_id` (UUID, generated per request)
- `signal_id` (if signal was created)
- `experiment_id`, `variant` (if available)
- `status` — `'accepted'|'duplicate'|'invalid_signature'|'invalid_payload'|'error'`
- `error_message` — Human-readable error
- `processing_time_ms` — Wall-clock processing time
- `raw_payload` — Truncated to 32KB for storage (with `secret` field redacted)
- `is_test`, `test_session_id`, `test_scenario`

## Retry Strategy

Webhook processing is synchronous — there is no built-in webhook retry. TradingView must retry on failure. Downstream orchestrator has a retry mechanism:
- Signals that fail processing get 1 retry attempt via `scheduleRetry()`
- `next_retry_at` column on `signals` table
- After 1 failed retry, signal is marked `rejected` with reason

## Dead Letter Handling

No formal dead letter queue. Failed signals are:
1. Logged in `webhook_events` with `status = 'error'`
2. If past orchestrator processing, marked as `rejected` in `signals` table with `processing_failed` flag
3. Visible in monitoring dashboard

## Example Valid Webhook

```json
{
  "symbol": "SPY",
  "direction": "long",
  "timeframe": "5m",
  "timestamp": 1739612400,
  "price": 595.42,
  "indicators": {
    "ema8": 595.10,
    "ema21": 594.80,
    "atr": 1.25
  },
  "confidence": 75,
  "secret": "your-hmac-secret"
}
```

**Response** (200):
```json
{
  "status": "ACCEPTED",
  "signal_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "request_id": "f0e1d2c3-b4a5-6789-0123-456789abcdef",
  "processing_time_ms": 45,
  "webhook_event_id": "11223344-5566-7788-99aa-bbccddeeff00",
  "test_session_id": null,
  "is_test": false
}
```

## Example Invalid Webhook

```json
{
  "price": 595.42
}
```

**Response** (400):
```json
{
  "status": "REJECTED",
  "error": "Invalid payload",
  "details": [
    { "field": "symbol", "message": "symbol is required" }
  ],
  "request_id": "...",
  "webhook_event_id": "..."
}
```

## Example Normalized Signal Object

Stored in `signals` table:
```json
{
  "signal_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "symbol": "SPY",
  "direction": "long",
  "timeframe": "5m",
  "timestamp": "2026-02-15T10:30:00.000Z",
  "status": "pending",
  "raw_payload": { "symbol": "SPY", "direction": "long", "timeframe": "5m", "price": 595.42, "indicators": {...} },
  "signal_hash": "sha256:...",
  "is_test": false,
  "test_session_id": null,
  "test_scenario": null,
  "created_at": "2026-02-15T10:30:00.500Z"
}
```

---

# 4. SIGNAL PROCESSING FLOW

## Complete Flow: TradingView → Trade or Reject

### Step 1: HTTP Ingestion (Synchronous)

```
TradingView → POST /webhook
  → Express middleware (helmet, cors, json, morgan, performanceMonitor)
  → Route handler checks:
      if (body.event_id_raw && shouldRouteToV3(body)) → BiasStateAggregator.update()
      if (body.event_type === 'BIAS_SNAPSHOT') → handleMTFBiasWebhook()
      else → handleWebhook() → processWebhookPayload()
  → Zod validation → normalization → dedup check → INSERT into signals
  → Return { status: 'ACCEPTED', signal_id }
```

**This is synchronous**. The HTTP response is returned immediately after the signal is stored. No engine processing occurs during the webhook request.

### Step 2: Orchestrator Worker (Asynchronous, Polled)

The `OrchestratorWorker` runs on a configurable interval (default 30s):

```
OrchestratorWorker.run()
  → orchestratorService.processSignals(batchSize)
    → signalProcessor.getUnprocessedSignals(limit)
      → SQL: SELECT ... FROM signals WHERE status = 'pending'
              AND (next_retry_at IS NULL OR next_retry_at <= NOW())
              ORDER BY created_at ASC
              FOR UPDATE SKIP LOCKED
              LIMIT $1
    → For each signal (concurrent up to orchestratorConcurrency):
        processSignalWithTimeout(signal, timeoutMs, retryDelayMs)
```

### Step 3: Signal Enrichment

```
buildSignalEnrichment(signal)
  1. Extract signal metadata (confidence, pattern_strength, mtf_alignment)
  2. Evaluate market session (RTH/ETH/closed, grace period)
     - If market closed AND signal stale → rejectionReason = 'signal_stale'
     - If market closed AND decisionOnlyWhenMarketClosed → decisionOnly = true
     - If market closed AND queuing enabled → queueUntil = nextMarketOpen
  3. Load risk limits from DB
  4. Count open positions (total and per-symbol)
  5. Check position replacement eligibility
  6. Fetch market data: current price, candles, indicators
  7. Fetch GEX snapshot and options flow
  8. Compute confluence score (netflow + gamma + direction alignment)
  9. Apply confluence gate → rejectionReason = 'confluence_below_threshold'
  10. Return { enrichedData, riskResult, rejectionReason, queueUntil, decisionOnly }
```

### Step 4: Experiment Assignment

```
experimentManager.createExperiment(signal, splitToA, 'v1.0')
  → assignment_hash = SHA256(signal.symbol + ':' + signal.timeframe + ':' + signal_id)
  → bucket = parseInt(hash.slice(0, 8), 16) / 0xFFFFFFFF
  → variant = bucket < splitToA ? 'A' : 'B'
  → INSERT into experiments
```

**Deterministic**: Same signal always gets same variant. `AB_SPLIT_PERCENTAGE` controls Engine B allocation (0 = all A, 100 = all B).

### Step 5: Policy Resolution

```
policyEngine.getExecutionPolicy(experiment_id, 'v1.0', preferredEngine)
  → If PAPER mode:
      If preferred engine available → that engine PRIMARY
      Else if Engine A available → ENGINE_A_PRIMARY
  → Else: SHADOW_ONLY
  → INSERT into execution_policies
```

### Step 6: Engine Invocation

Based on experiment variant:
- **Variant A** → `engineCoordinator.invokeEngineA(signal, context)` → `buildRecommendation('A', ...)`
- **Variant B** → `engineCoordinator.invokeEngineB(signal, context)` → `buildEngineBRecommendation(...)`

### Step 7: Gamma Override

```
applyGammaOverride(variant, engineA, engineB, dealerDecision, signal)
  → If dealer confidence >= 0.7 and variant A: override direction + adjust quantity
  → If variant B and direction conflicts: null out Engine B recommendation
  → Apply position_size_multiplier to quantity
```

### Step 8: Policy Application

```
applyPolicyToRecommendation(experiment_id, execution_mode, engine, recommendation)
  → SHADOW_ONLY: is_shadow = true for all
  → ENGINE_A_PRIMARY: is_shadow = true for Engine B, false for A
  → ENGINE_B_PRIMARY: is_shadow = true for Engine A, false for B
```

### Step 9: Persist and Execute

```
persistRecommendation() → INSERT into decision_recommendations
updateSignalStatus() → UPDATE signals SET status = 'approved'|'rejected'
createPaperOrders() → INSERT into orders (if PAPER mode, signal approved, not shadow)
handleShadowExecution() → shadowExecutor.simulateExecution() (if shadow enabled)
markProcessed() → UPDATE signals SET processed = true
```

## Environment Flags That Change Behavior

| Flag | Effect on Flow |
|---|---|
| `ENABLE_ORCHESTRATOR=false` | Falls back to legacy SignalProcessorWorker |
| `APP_MODE=LIVE` | Would enable live orders (not currently used) |
| `ENABLE_VARIANT_B=false` | All signals route to Engine A |
| `AB_SPLIT_PERCENTAGE=0` | All signals route to Engine A |
| `REQUIRE_MTF_BIAS_FOR_ENTRY=true` | Engines return null (HOLD) if no bias state exists |
| `ENABLE_PORTFOLIO_GUARD=true` | Engines check exposure before recommending |
| `ENABLE_CONFLUENCE_GATE=true` | Signals rejected if confluence score below threshold |
| `DECISION_ONLY_WHEN_MARKET_CLOSED=true` | Engines run but no orders created outside market hours |
| `ENABLE_SHADOW_EXECUTION=true` | Non-primary engine's recommendations create shadow trades |
| `E2E_TEST_MODE=true` | Disables MTF bias requirement and portfolio guard |

---

# 5. DECISION ENGINE A (RULE-BASED)

## Strategy Logic

Engine A (`buildRecommendation('A', signal, context)`) follows a sequential gate chain:

1. **MTF Bias Gate** — If `REQUIRE_MTF_BIAS_FOR_ENTRY=true`:
   - No bias state → HOLD (return null)
   - Trade suppressed by effective gating → HOLD
   - Bias state stale and staleness config = `'block'` → HOLD

2. **Portfolio Guard** — If `ENABLE_PORTFOLIO_GUARD=true`:
   - Load all open positions
   - Evaluate exposure against market state
   - If `BLOCK` → HOLD

3. **Entry Decision Engine** — Three-tier rule evaluation:
   - **Tier 1: Hard Blocks** (e.g., market closed, critical risk) → `BLOCK` → return null
   - **Tier 2: Delays** (e.g., approaching close, low confidence) → `WAIT` → return null
   - **Tier 3: Entry Instructions** (signal qualifies) → `ENTER` → proceed

4. **Strike Selection** → `selectStrike(symbol, direction)` → ATM option
5. **Entry/Exit Plan** → `buildEntryExitPlan()` → fetch option price as entry price
6. **Position Sizing**:
   - Base size = `config.maxPositionSize` (default 10)
   - Apply gamma sizing multiplier (LONG_GAMMA: 1.25x, SHORT_GAMMA: 0.6x)
   - Apply MTF bias risk multiplier

## Inputs Required

```typescript
interface EngineAInputs {
  signal: Signal;              // Normalized signal
  context: MarketContext;      // Market snapshot with enrichment
  mtfBias: MTFBiasContext;     // Multi-timeframe bias state
  entryInput: EntryDecisionInput; // Structured input for tier rules
}
```

## How Confidence is Calculated

Engine A does not produce a separate confidence score. Confidence flows from:
- Signal payload's `confidence` field (from TradingView)
- MTF bias `effectiveConfidence`
- Confluence score (netflow + gamma alignment)
- Entry decision engine tier rules evaluate these as pass/fail gates, not scores

## How Strike is Selected

```typescript
function calculateStrike(price: number, direction: 'long' | 'short'): number {
  return direction === 'long' ? Math.ceil(price) : Math.floor(price);
}
```
- **Long signals** → `Math.ceil(currentPrice)` → nearest ATM call above price
- **Short signals** → `Math.floor(currentPrice)` → nearest ATM put below price
- Expiration: Next Friday from today + `MAX_HOLD_DAYS` (default 5)

## What Causes HOLD (return null)

| Cause | Check Location |
|---|---|
| No MTF bias state | `getMTFBiasContext()` returns null |
| Trade suppressed by bias gating | `mtfBias.tradeSuppressed === true` |
| Bias state stale (block mode) | `mtfBias.unifiedState.isStale && stalenessCfg.behavior === 'block'` |
| Portfolio guard block | `evaluateExposure().result === 'BLOCK'` |
| Entry decision BLOCK | Tier 1 hard block rule triggered |
| Entry decision WAIT | Tier 2 delay rule triggered |
| Market data unavailable | `getStockPrice()` or `getOptionPrice()` throws |

## What Causes REJECT

Engine A itself returns null (HOLD). The orchestrator translates this to signal rejection when:
- No recommendation AND no `decisionOnly` mode → signal status = `'rejected'`
- Shadow-only policy → recommendation tagged `is_shadow = true` → signal not traded

## DB Tables for Decisions

| Table | Purpose |
|---|---|
| `decision_recommendations` | Persisted recommendation (strike, expiration, quantity, rationale) |
| `signals` | Updated status: `'approved'` or `'rejected'` with `rejection_reason` |
| `orders` | Paper order created from approved recommendation |

## Example Decision Object

```json
{
  "experiment_id": "a1b2c3d4-...",
  "engine": "A",
  "symbol": "SPY",
  "direction": "long",
  "strike": 596,
  "expiration": "2026-02-20T00:00:00.000Z",
  "quantity": 8,
  "entry_price": 3.45,
  "is_shadow": false
}
```

---

# 6. DECISION ENGINE B (AI MULTI-AGENT)

## Agents Involved

| Agent | Type | File | Feature Flag |
|---|---|---|---|
| ContextAgent | `core` | `src/agents/core/context-agent.ts` | Always active |
| TechnicalAgent | `core` | `src/agents/core/technical-agent.ts` | Always active |
| RiskAgent | `core` | `src/agents/core/risk-agent.ts` | Always active |
| GammaFlowSpecialist | `specialist` | `src/agents/specialists/gamma-flow-specialist.ts` | GEX/flow data present |
| ORBSpecialist | `specialist` | `src/agents/specialists/orb-specialist.ts` | `ENABLE_ORB_SPECIALIST` |
| StratSpecialist | `specialist` | `src/agents/specialists/strat-specialist.ts` | `ENABLE_STRAT_SPECIALIST` |
| TTMSpecialist | `specialist` | `src/agents/specialists/ttm-specialist.ts` | `ENABLE_TTM_SPECIALIST` |
| SatylandSubAgent | `subagent` | `src/agents/subagents/satyland-sub-agent.ts` | `ENABLE_SATYLAND_SUBAGENT` |
| MetaDecisionAgent | `core` | `src/agents/core/meta-decision-agent.ts` | Always (aggregator) |

## Agent Responsibilities

- **ContextAgent**: Market regime analysis using GEX data (netGex, dealerPosition, zeroGammaLevel), session context (open/closed), volatility analysis
- **TechnicalAgent**: Price action analysis — EMA alignment (EMA8 vs EMA21), price position relative to moving averages
- **RiskAgent**: Absolute veto authority — market hours check, position limit check, exposure check. Outputs `block: true` to veto all trades
- **GammaFlowSpecialist**: Gamma-weighted options flow analysis, dealer positioning signals
- **ORBSpecialist**: Opening Range Breakout pattern detection and confirmation
- **StratSpecialist**: The Strat methodology (1-2-3 bar patterns, continuation/reversal)
- **TTMSpecialist**: TTM Squeeze momentum analysis (squeeze state, momentum direction)
- **SatylandSubAgent**: EMA21 alignment confirmation signals
- **MetaDecisionAgent**: Weighted aggregation of all agent outputs → final approve/reject

## Meta Decision Aggregation

```typescript
const weights: Record<AgentType, number> = {
  specialist: 0.4,   // 40% weight for specialist agents
  core: 0.35,        // 35% weight for core agents
  subagent: 0.25,    // 25% weight for sub-agents
};
```

**Algorithm**:
1. Check risk veto — if any agent with `agent === 'risk'` has `block === true` → immediate reject (confidence=0)
2. For each agent output, accumulate weighted scores by bias (`bullish`, `bearish`, `neutral`):
   - `scores[bias] += weight * confidence`
3. Final bias = bias with highest weighted score
4. Final confidence = `scores[finalBias] / totalWeight` (0–100 scale)
5. Decision = `finalConfidence >= 50 ? 'approve' : 'reject'`

## Confidence Scoring

Each agent outputs:
```typescript
interface AgentOutput {
  agent: string;          // Agent name
  bias: 'bullish' | 'bearish' | 'neutral';
  confidence: number;     // 0-100
  reasons: string[];
  block: boolean;         // Veto flag (only RiskAgent uses this)
  metadata?: Record<string, any>;
}
```

Agent-specific bounds (enforced in tests):
- TTMSpecialist: 0–80
- SatylandSubAgent: 20–90
- All others: 0–100

## Conflict Resolution Logic

1. **Risk Agent Veto**: If `RiskAgent.block === true`, entire meta decision is `reject` with `confidence=0` regardless of other agents
2. **Direction Conflict**: If agents disagree on bias, weighted aggregation resolves — the bias direction with the highest weighted confidence wins
3. **Low Consensus**: If `finalConfidence < 50`, meta decision rejects even if there's a bias majority
4. **Gamma Override**: After meta decision, dealer strategy may override direction or null out Engine B if directions conflict

## Shadow Trading Behavior

When Engine B's recommendation has `is_shadow = true`:
- `ShadowExecutor.simulateExecution()` creates entries in `shadow_trades` and `shadow_positions`
- Shadow positions are monitored separately: `refreshShadowPositions()` updates P&L, `monitorShadowExits()` applies exit rules
- Shadow trades do NOT create real orders
- Performance tracked separately in `agent_performance` table

## Failure Handling

- Any agent exception → caught and logged, agent skipped (does not block other agents)
- `buildEngineBRecommendation()` catches all exceptions → returns null on failure
- Market data unavailable → graceful degradation (fallback indicators using `currentPrice` for all EMAs)
- If `currentPrice` unavailable → entire Engine B returns null

## Example Agent Outputs

```json
[
  {
    "agent": "context",
    "bias": "bullish",
    "confidence": 65,
    "reasons": ["dealer_long_gamma", "rth_session"],
    "block": false,
    "metadata": { "agentType": "core" }
  },
  {
    "agent": "technical",
    "bias": "bullish",
    "confidence": 72,
    "reasons": ["ema8_above_ema21", "price_above_ema8"],
    "block": false,
    "metadata": { "agentType": "core" }
  },
  {
    "agent": "risk",
    "bias": "neutral",
    "confidence": 50,
    "reasons": [],
    "block": false,
    "metadata": { "agentType": "core" }
  },
  {
    "agent": "gamma-flow",
    "bias": "bullish",
    "confidence": 70,
    "reasons": ["positive_gex", "call_premium_dominant"],
    "block": false,
    "metadata": { "agentType": "specialist" }
  }
]
```

**Meta Decision**:
```json
{
  "finalBias": "bullish",
  "finalConfidence": 67,
  "contributingAgents": ["context", "technical", "risk", "gamma-flow"],
  "consensusStrength": 67,
  "decision": "approve",
  "reasons": ["weighted_consensus"]
}
```

---

# 7. STRIKE SELECTION ENGINE

## Inputs

```typescript
selectStrike(symbol: string, direction: 'long' | 'short'): Promise<StrikeSelection>
```

- `symbol` — Underlying ticker (e.g., "SPY")
- `direction` — Trade direction

## Data Providers Used

1. **Primary**: Market data service (`marketData.getStockPrice()`) — uses provider priority chain:
   - TwelveData → MarketData.app (configured via `MARKET_DATA_PROVIDER_PRIORITY`)
2. **Fallback**: Alpaca API (`alpaca-client.ts`) for option quotes

## Liquidity Filters

Currently **not implemented** in production strike selection. The `src/lib/strikeSelection/` directory contains an advanced framework with:
- `filters/liquidity-filter.ts` — Bid-ask spread checks, volume thresholds
- `filters/dte-filter.ts` — DTE range validation
- `filters/greeks-filter.ts` — Delta/gamma/theta constraints
- `scoring/scorer.ts` — Multi-factor scoring system

However, the production `selectStrike()` in `src/services/strike-selection.service.ts` uses the simplified ATM approach.

## DTE Selection Logic

```typescript
function calculateExpiration(dteDays: number): Date {
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + dteDays);
  // Roll to next Friday
  const daysUntilFriday = (5 - base.getUTCDay() + 7) % 7;
  base.setUTCDate(base.getUTCDate() + daysUntilFriday);
  return base;
}
```

- Input: `config.maxHoldDays` (default: 5 days)
- Output: Next Friday on or after `today + maxHoldDays`

## MTF Bias Strike Hints

The `strike-selection-adapter.service.ts` provides delta/DTE hints based on confidence:

| Confidence | Delta Range | DTE Band |
|---|---|---|
| High (≥70) | 0.60–0.70 | Standard |
| Medium (50–69) | 0.45–0.55 | Standard |
| Low (<50) | 0.40–0.50 | Shorter |

These hints are available but not currently consumed by the production `selectStrike()`.

## Risk Reward Filters

No explicit risk/reward filter in current strike selection. Position sizing serves as the primary risk control, with gamma regime and MTF bias multipliers adjusting quantity.

## Fallback Providers

Market data provider chain (`MARKET_DATA_PROVIDER_PRIORITY`):
1. TwelveData (primary)
2. MarketData.app (secondary)
3. If all fail → exception propagates → engine returns null

---

# 8. RISK GATE

The risk gate is multi-layered, with checks distributed across enrichment and engine processing.

## Position Limits

| Limit | Config | Default | Check Location |
|---|---|---|---|
| Max open positions | `MAX_OPEN_POSITIONS` | 5 | `signal-enrichment.service.ts` |
| Max positions per symbol | `risk_limits.max_positions_per_symbol` | 3 | `signal-enrichment.service.ts` |
| Max position size (contracts) | `MAX_POSITION_SIZE` | 10 | `engine-invokers.ts` (base sizing) |
| Max total exposure | `risk_limits.max_total_exposure` | $10,000 | `risk_limits` table |
| Max exposure percent | `MAX_EXPOSURE_PERCENT` | 20% | `risk_limits` table |

## Daily Loss Cap

| Limit | Config | Default |
|---|---|---|
| Max daily loss | `MAX_DAILY_LOSS` | $1,000 |
| Max daily trades | `MAX_DAILY_TRADES` | 0 (unlimited in production, 500 in test) |

Daily trade cap enforced in `PaperExecutorWorker.run()`:
```sql
SELECT COUNT(*)::int FROM trades t JOIN orders o ON o.order_id = t.order_id
WHERE o.order_type = 'paper' AND t.fill_timestamp >= CURRENT_DATE
```

## Cooldown Logic

Position replacement cooldown:
- `MIN_HOLD_MINUTES_FOR_CAPACITY_CLOSE` (default: 15 minutes) — positions must be held at least this long before eligible for capacity-based closing
- Signal deduplication window: 60 seconds (same symbol+direction+timeframe)

## Market Hours Logic

```typescript
evaluateMarketSession({
  timestamp,
  allowPremarket: config.allowPremarket,      // default: false
  allowAfterhours: config.allowAfterhours,    // default: false
  gracePeriodMinutes: config.marketCloseGraceMinutes,  // default: 10
})
```

Behavior when market is closed:
1. If signal age > `SIGNAL_MAX_AGE_MINUTES` (30min) → reject as `signal_stale`
2. If `DECISION_ONLY_WHEN_MARKET_CLOSED=true` → run engines but skip order creation
3. Otherwise → queue signal until next market open

## Duplicate Trade Prevention

1. **Webhook level**: `isDuplicate()` — 60s window dedup on `(symbol, direction, timeframe)`
2. **Order level**: `createPaperOrders()` checks for existing order with same `(signal_id, engine, order_type)`
3. **Position level**: `PaperExecutorWorker` checks for existing position with same `option_symbol`

## Confluence Filtering

When `ENABLE_CONFLUENCE_GATE=true`:
```
confluenceScore = f(netflow, gammaRegime, signalDirection, flowEntriesCount)
if (confluenceScore < CONFLUENCE_MIN_THRESHOLD) → reject 'confluence_below_threshold'
```

## MTF Bias Gating

When `REQUIRE_MTF_BIAS_FOR_ENTRY=true`:
- No bias state for symbol → HOLD
- `tradeSuppressed === true` (effective gating) → HOLD
- Stale state with `behavior: 'block'` → HOLD

## Portfolio Guard

When `ENABLE_PORTFOLIO_GUARD=true`:
- Evaluates new trade against existing portfolio exposure
- Considers market state (regime, volatility, chop score)
- Returns `ALLOW`, `REDUCE`, or `BLOCK`

## All Rejection Codes

| Code | Source | Meaning |
|---|---|---|
| `signal_stale` | Enrichment | Signal too old when market closed |
| `market_closed` | Enrichment | Market closed, no queue/decision mode |
| `max_open_positions_exceeded` | Enrichment | Position count >= `MAX_OPEN_POSITIONS` |
| `max_positions_per_symbol_exceeded` | Enrichment | Symbol position count >= limit |
| `market_data_unavailable` | Enrichment | Failed to fetch price/candles/indicators |
| `confluence_below_threshold` | Enrichment | Confluence score below gate threshold |
| `queued_market_closed` | Orchestrator | Signal queued for next market open |
| `processing_timeout` | Orchestrator | Signal processing exceeded timeout |
| `processing_failed` | Orchestrator | Unhandled exception during processing |
| `retry_scheduled:*` | Orchestrator | Failure, retry attempt scheduled |
| `no_recommendation` | Orchestrator | Engine returned null |
| `shadow_only` | Orchestrator | Policy is SHADOW_ONLY |
| `risk_rejected` | Orchestrator | Generic risk rejection |
| `market_closed` | RiskAgent | Market not open (Engine B) |
| `position_limit_exceeded` | RiskAgent | Position limit hit (Engine B) |
| `exposure_exceeded` | RiskAgent | Exposure limit hit (Engine B) |
| `risk_agent_blocked` | MetaDecision | Risk agent vetoed (Engine B) |

---

# 9. ORDER MANAGEMENT

## Alpaca SDK Usage

**Client**: `src/services/providers/alpaca-client.ts`

| Method | Purpose |
|---|---|
| `getOptionPrice(symbol, strike, expiration, type)` | Fetches option bid/ask/mid for paper fills |
| `getLatestQuote(symbol)` | Stock quote (bid/ask/mid) |
| `isMarketOpen()` | Market hours check |
| `getCandles(symbol, timeframe, limit)` | Historical OHLCV bars |

**Configuration**:
- `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`
- `ALPACA_PAPER=true` (always paper)
- `ALPACA_BASE_URL=https://paper-api.alpaca.markets`

**Important**: Alpaca is used for **market data** in paper mode, not for order submission. Orders are simulated internally.

## Paper Executor Behavior

`PaperExecutorWorker` runs every 10 seconds (configurable):

1. Query all `orders WHERE status = 'pending_execution' AND order_type = 'paper'`
2. For each order (in batches of `PAPER_EXECUTOR_BATCH_SIZE`):
   a. Fetch current option price via market data
   b. If price available → create `trades` record with fill price = current market mid
   c. If existing position with `status = 'closing'` for same `option_symbol` → close it (calculate realized P&L)
   d. If no existing position → create new `refactored_positions` record with `status = 'open'`
   e. Update order `status = 'filled'`
3. Respect `MAX_DAILY_TRADES` cap
4. Publish real-time WebSocket updates for position and risk changes

## Order Lifecycle

```
pending_execution → filled    (successful fill)
pending_execution → failed    (no price available or error)
```

## Fill Logic

Paper fills use the current market mid price at execution time:
```typescript
const price = await marketData.getOptionPrice(symbol, strike, expiration, optionType);
// price = mid price from Alpaca/TwelveData/MarketData.app
```

**No slippage modeling** — fill price equals the market mid at time of PaperExecutorWorker run.

## Partial Fills

Not supported for entry orders. All orders fill completely or fail.

Exit orders support partial quantity via exit intelligence:
```typescript
if (adjustments.forcePartialExit !== undefined) {
  exitQuantity = Math.max(1, Math.round(position.quantity * adjustments.forcePartialExit));
}
```

## P&L Calculation

**Unrealized P&L** (PositionRefresherWorker):
```typescript
unrealized_pnl = (currentPrice - entry_price) * quantity * 100
```
(Options contracts: 100 multiplier)

**Realized P&L** (PaperExecutorWorker on close):
```typescript
realized_pnl = (fillPrice - entry_price) * quantity * 100
pnl_percent = (realized_pnl / costBasis) * 100
pnl_r = realized_pnl / (costBasis * 0.01)
```

## P&L Storage

- **Unrealized**: `refactored_positions.unrealized_pnl`, `refactored_positions.current_price`
- **Realized**: `refactored_positions.realized_pnl` (on close)
- **Performance**: `bias_trade_performance.pnl_r`, `bias_trade_performance.pnl_percent`
- **Computed column**: `position_pnl_percent` (used for capacity management decisions)

## How Positions Close

1. **ExitMonitorWorker** detects exit condition → sets position `status = 'closing'`, `exit_reason` → creates exit order
2. **PaperExecutorWorker** finds exit order → fills at market price → detects position with `status = 'closing'` for same `option_symbol`
3. PaperExecutor calculates realized P&L → updates position `status = 'closed'`, `exit_timestamp`, `realized_pnl`
4. `captureTradeOutcome()` stores performance data in `bias_trade_performance`
5. WebSocket update published

---

# 10. POSITION MONITORING

## Stop Loss Logic

Configured via `exit_rules` table and `STOP_LOSS_PCT` env var (default: 50%):
```typescript
if (pnlPercent <= -Math.abs(rule.stop_loss_percent)) {
  exitReason = 'stop_loss';
}
```

## Trailing Stop Logic

Not implemented as a native trailing stop. The exit intelligence system provides bias-aware stop tightening:
- Exit Decision Engine Tier 4 (Degradation) can issue `TIGHTEN_STOP` actions
- This does not dynamically adjust the stop level but triggers early exits when conditions degrade

## Time Stop

```typescript
if (hoursInPosition >= rule.max_hold_time_hours) {  // default: 120 hours
  exitReason = 'max_hold_time';
}
```

## DTE Exit

```typescript
const daysToExpiration = (expirationDate - now) / 86400000;
if (daysToExpiration <= rule.min_dte_exit) {  // default: 1 day
  exitReason = 'min_dte_exit';
}
```

## Exit Decision Engine

Multi-tier exit evaluation (`src/lib/exitEngine/evaluator.ts`):

| Tier | Name | Actions |
|---|---|---|
| Tier 1 | Hard Fails | `FULL_EXIT` — immediate close (e.g., 100% loss, expired) |
| Tier 2 | Protection | `PARTIAL_EXIT` or `FULL_EXIT` — protect capital (e.g., deep loss, near expiry) |
| Tier 3 | Profit Taking | `PARTIAL_EXIT` — lock in gains (e.g., profit target partial) |
| Tier 4 | Degradation | `TIGHTEN_STOP` or `PARTIAL_EXIT` — conditions worsening |

Enabled via `ENABLE_EXIT_DECISION_ENGINE=true` (default: true).

## Exit Intelligence

Bias-aware exit adjustments (`src/services/exit-intelligence/exit-intelligence.service.ts`):

Runs **before** standard exit rules. Checks:
- **Confidence collapse**: Bias confidence dropped significantly since entry
- **Bias flip**: Market bias reversed from entry direction
- **Chop spike**: Market entered high-chop regime
- **Regime change**: Market regime changed from entry regime

Can force:
- `forceFullExit: true` — close entire position
- `forcePartialExit: 0.5` — close 50% of position

Enabled via `ENABLE_EXIT_INTELLIGENCE=true` (default: true).

## Manual Override Logic

No built-in manual override endpoint. Positions can be manually closed by:
1. Direct database update: `UPDATE refactored_positions SET status = 'closing', exit_reason = 'manual'`
2. The exit monitor will then create the closing order

## WebSocket Usage

Two WebSocket servers:

1. **Testing WebSocket** (`createTestingWebSocketServer`): Real-time test session updates
2. **Realtime WebSocket** (`startRealtimeWebSocketServer`): Production position and risk updates
   - `publishPositionUpdate(positionId)` — broadcasts position changes
   - `publishRiskUpdate()` — broadcasts risk snapshot changes

Frontend connects for live updates to Dashboard and Orders components.

---

# 11. PERFORMANCE FEEDBACK LOOP

## Trade Outcome Capture

On every position close, `captureTradeOutcome()` is called from `PaperExecutorWorker`:

```typescript
captureTradeOutcome({
  positionId,
  symbol,
  direction,
  entryBiasScore,        // Bias score at entry time
  entryMacroClass,       // Macro classification at entry
  entryRegime,           // Regime type at entry
  entryIntent,           // Entry mode hint (BREAKOUT, PULLBACK, etc.)
  entryAcceleration,     // State strength delta at entry
  pnlR,                  // Risk-adjusted P&L
  pnlPercent,            // Percentage P&L
  durationMinutes,       // Time in trade
  exitReasonCodes,       // Array of exit reasons
  timestamp,
  source: 'live',        // 'live' or 'simulation'
})
```

Stored in `bias_trade_performance` table.

## Rolling Statistics

`PerformanceAnalyzer` (`src/services/performance-feedback/performance-analyzer.service.ts`) computes:
- Win rate by regime type
- Average R-multiple by entry mode hint
- P&L distribution by macro class
- Duration statistics

## Bias Adjustment Logic

The performance feedback creates a closed loop:
1. Trade closes → outcome captured with entry bias state
2. Analyzer computes: "For regime X with mode hint Y, win rate = Z%"
3. This informs future risk multipliers via `getRiskMultiplierFromState()`
4. Higher-performing regimes get larger position sizes, lower-performing get reduced sizes

## Adaptive Scoring

`AdaptiveTuner` (`src/services/performance-feedback/adaptive-tuner.service.ts`):
- Analyzes recent trade outcomes
- Adjusts confidence thresholds based on realized performance
- Stores adjustment history in `bias_adaptive_config_history`

## Meta Learning Layer

The system captures entry-state-to-outcome correlations:
- `entry_bias_score` → `pnl_r` correlation
- `entry_macro_class` → win rate mapping
- `entry_regime` → average hold duration
- `entry_acceleration` → outcome quality

This data is accessible for manual analysis and drives the risk multiplier calculation.

## Storage

| Table | Purpose |
|---|---|
| `bias_trade_performance` | Individual trade outcomes with entry state |
| `bias_adaptive_config_history` | Parameter adjustment audit trail |
| `agent_performance` | Per-agent win rate, expectancy metrics |

## UI Reflection

The dashboard shows:
- Portfolio P&L metrics (realized + unrealized)
- Performance charts (1D, 1W, 1M, 6M, 1Y)
- Adaptive tuner badge (indicates if tuning is active)
- Win rate and trade statistics

Cached in Redis with 10-minute TTL (`performance:*` keys).

---

# 12. FRONTEND / DASHBOARD

## Technology

Next.js application deployed on Vercel at `optionsengines.vercel.app`.

## API Routes Used

### Backend Routes (Express)

| Route | Method | Purpose |
|---|---|---|
| `/webhook` | POST | Receive TradingView signals |
| `/webhook/test` | GET | Health check |
| `/auth/login` | POST | JWT authentication |
| `/dashboard/metrics` | GET | Portfolio overview metrics |
| `/orders/active` | GET | Active orders |
| `/orders/trades` | GET | Filled trades |
| `/orders/positions` | GET | Open positions |
| `/history/positions` | GET | Closed positions history |
| `/monitoring/e2e` | GET | End-to-end system status |
| `/positioning/:symbol` | GET | GEX + flow + max pain data |
| `/intel/snapshot` | GET | Market intelligence snapshot |
| `/gamma/:symbol` | GET | Gamma context data |
| `/api/bias/summary` | GET | Bias state summary |
| `/api/cron/process-queue` | POST | Manual pipeline trigger |
| `/feature-flags` | GET | Feature flag states |
| `/metrics` | GET | Performance monitor stats |

### Frontend API Routes (Next.js)

| Route | Purpose |
|---|---|
| `/api/orders` | Proxy to backend orders |
| `/api/dashboard/metrics` | Proxy to backend metrics |
| `/api/positioning/[symbol]` | Proxy to backend positioning |
| `/api/bias/summary` | Proxy to backend bias |
| `/api/auth/login` | Authentication |

## Real-time Subscriptions

WebSocket connections for:
- Position updates (open, close, P&L changes)
- Risk snapshot updates (exposure, position count)
- Test session progress updates

## Monitoring Panels

1. **Portfolio Overview**: Total P&L, win rate, total trades, active positions count
2. **Performance Charts**: Line chart with period selectors (1D, 1W, 1M, 6M, 1Y)
3. **Recent Activity**: Latest signals, orders, and position changes

## Active Positions View

- Symbol, type (call/put), strike, expiration
- Entry price, current price
- Unrealized P&L (absolute and percentage)
- Time in trade
- Engine (A/B)

## Signal Log View

- Via webhook_events table: request_id, status, symbol, direction, timeframe, processing_time_ms
- Filterable by status (accepted, duplicate, rejected, error)

## Error Reporting

- Sentry integration for all backend errors
- `error-tracker.service.ts` for error rate monitoring
- Monitoring endpoint `/monitoring/e2e` for system health

## Why Active Table May Appear Blank

| Cause | Explanation |
|---|---|
| No approved signals | All signals rejected by risk gates or engines |
| Market closed | `DECISION_ONLY_WHEN_MARKET_CLOSED=true` prevents order creation |
| MTF bias missing | `REQUIRE_MTF_BIAS_FOR_ENTRY=true` but no bias webhook received |
| Confluence gate | All signals below confluence threshold |
| API keys missing | Market data fetch fails → engine returns null |
| Paper executor lag | Orders in `pending_execution` but executor hasn't run yet (10s interval) |
| WebSocket disconnect | Frontend not receiving real-time updates |

---

# 13. DATABASE SCHEMA

## Core Tables

### `signals`
Incoming trading signals from TradingView webhooks.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `signal_id` | UUID | PK, default `gen_random_uuid()` | Unique signal identifier |
| `symbol` | VARCHAR(20) | NOT NULL | Ticker symbol |
| `direction` | VARCHAR(10) | NOT NULL, CHECK `('long','short')` | Normalized direction |
| `timeframe` | VARCHAR(10) | NOT NULL | Normalized timeframe |
| `timestamp` | TIMESTAMPTZ | NOT NULL | Signal timestamp |
| `status` | VARCHAR(20) | NOT NULL, CHECK `('pending','approved','rejected')` | Processing status |
| `raw_payload` | JSONB | | Original webhook payload |
| `signal_hash` | VARCHAR(64) | | SHA-256 dedup hash |
| `is_test` | BOOLEAN | | Test signal flag |
| `test_session_id` | VARCHAR(128) | | Test session identifier |
| `test_scenario` | VARCHAR(128) | | Test scenario name |
| `rejection_reason` | TEXT | | Why signal was rejected |
| `processed` | BOOLEAN | | Whether orchestrator has processed |
| `experiment_id` | UUID | FK → experiments | Linked experiment |
| `meta_gamma` | JSONB | | Dealer strategy decision |
| `queued_until` | TIMESTAMPTZ | | Queue until this time |
| `queued_at` | TIMESTAMPTZ | | When queued |
| `queue_reason` | VARCHAR(100) | | Why queued |
| `processing_attempts` | INTEGER | | Retry count |
| `next_retry_at` | TIMESTAMPTZ | | Next retry time |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Creation timestamp |

**Indexes**: `status`, `created_at DESC`, `symbol`, `timestamp DESC`

**Lifecycle**: `pending` → `approved`/`rejected` (by orchestrator)

### `webhook_events`
Webhook processing outcomes for monitoring.

| Column | Type | Description |
|---|---|---|
| `event_id` | UUID | PK |
| `request_id` | UUID | HTTP request identifier |
| `signal_id` | UUID | FK → signals (nullable) |
| `experiment_id` | UUID | FK → experiments (nullable) |
| `variant` | VARCHAR(1) | `'A'` or `'B'` |
| `status` | VARCHAR(30) | `accepted`, `duplicate`, `invalid_signature`, `invalid_payload`, `error` |
| `error_message` | TEXT | Error details |
| `symbol` | VARCHAR(20) | Extracted symbol |
| `direction` | VARCHAR(10) | Normalized direction |
| `timeframe` | VARCHAR(10) | Normalized timeframe |
| `processing_time_ms` | INTEGER | Wall-clock processing time |
| `raw_payload` | JSONB | Truncated payload (32KB max) |
| `is_test` | BOOLEAN | Test flag |
| `test_session_id` | VARCHAR(128) | Test session |
| `test_scenario` | VARCHAR(128) | Test scenario |
| `created_at` | TIMESTAMPTZ | Timestamp |

**Indexes**: `created_at DESC`, `status`, `variant`, `signal_id`

### `refactored_signals`
Enriched signals with market context and risk checks.

| Column | Type | Description |
|---|---|---|
| `refactored_signal_id` | UUID | PK |
| `signal_id` | UUID | FK → signals (CASCADE) |
| `enriched_data` | JSONB | Market data, indicators, GEX, flow |
| `risk_check_result` | JSONB | Risk evaluation results |
| `rejection_reason` | TEXT | If rejected |
| `processed_at` | TIMESTAMPTZ | Processing timestamp |

### `orders`
All orders (paper and live) created from approved signals.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `order_id` | UUID | PK | Order identifier |
| `signal_id` | UUID | FK → signals (nullable) | Source signal (null for exit orders) |
| `symbol` | VARCHAR(20) | NOT NULL | Underlying symbol |
| `option_symbol` | VARCHAR(50) | NOT NULL | OCC option symbol |
| `strike` | DECIMAL(10,2) | NOT NULL | Strike price |
| `expiration` | DATE | NOT NULL | Expiration date |
| `type` | VARCHAR(10) | CHECK `('call','put')` | Option type |
| `quantity` | INTEGER | CHECK `> 0` | Contract count |
| `order_type` | VARCHAR(20) | CHECK `('paper','live')` | Execution mode |
| `status` | VARCHAR(20) | CHECK `('pending_execution','filled','failed')` | Order status |
| `engine` | VARCHAR(1) | | `'A'` or `'B'` |
| `experiment_id` | UUID | | Linked experiment |
| `created_at` | TIMESTAMPTZ | | Timestamp |

**Indexes**: `status`, `signal_id`, `symbol`, `order_type`

**Lifecycle**: `pending_execution` → `filled`/`failed`

### `trades`
Executed trade records with fill prices.

| Column | Type | Description |
|---|---|---|
| `trade_id` | UUID | PK |
| `order_id` | UUID | FK → orders (CASCADE) |
| `fill_price` | DECIMAL(10,4) | Fill price |
| `fill_quantity` | INTEGER | Filled contracts |
| `fill_timestamp` | TIMESTAMPTZ | Fill time |
| `commission` | DECIMAL(10,2) | Commission (default 0) |
| `engine` | VARCHAR(1) | `'A'` or `'B'` |
| `experiment_id` | UUID | Linked experiment |
| `created_at` | TIMESTAMPTZ | Timestamp |

**Indexes**: `order_id`, `fill_timestamp DESC`

### `refactored_positions`
Open and closed positions with P&L tracking.

| Column | Type | Description |
|---|---|---|
| `position_id` | UUID | PK |
| `symbol` | VARCHAR(20) | Underlying |
| `option_symbol` | VARCHAR(50) | OCC option symbol |
| `strike` | DECIMAL(10,2) | Strike |
| `expiration` | DATE | Expiration |
| `type` | VARCHAR(10) | `'call'` or `'put'` |
| `quantity` | INTEGER | Contracts |
| `entry_price` | DECIMAL(10,4) | Entry fill price |
| `current_price` | DECIMAL(10,4) | Latest market price |
| `unrealized_pnl` | DECIMAL(10,2) | Unrealized P&L |
| `realized_pnl` | DECIMAL(10,2) | Realized P&L (on close) |
| `status` | VARCHAR(20) | `'open'`, `'closing'`, `'closed'` |
| `entry_timestamp` | TIMESTAMPTZ | When opened |
| `exit_timestamp` | TIMESTAMPTZ | When closed |
| `exit_reason` | TEXT | Exit reason code |
| `engine` | VARCHAR(1) | `'A'` or `'B'` |
| `experiment_id` | UUID | Linked experiment |
| `entry_bias_score` | NUMERIC | Bias score at entry |
| `entry_regime_type` | VARCHAR(50) | Regime at entry |
| `entry_mode_hint` | VARCHAR(50) | Entry mode (BREAKOUT, etc.) |
| `entry_macro_class` | VARCHAR(50) | Macro class at entry |
| `entry_acceleration_state_strength_delta` | NUMERIC | Acceleration at entry |
| `position_pnl_percent` | NUMERIC | Computed P&L % |
| `last_updated` | TIMESTAMPTZ | Last update time |
| `created_at` | TIMESTAMPTZ | Creation time |

**Indexes**: `status`, `symbol`, `expiration`

**Lifecycle**: `open` → `closing` (exit monitor) → `closed` (paper executor)

### `experiments`
A/B test assignments routing signals to engines.

| Column | Type | Description |
|---|---|---|
| `experiment_id` | UUID | PK |
| `signal_id` | UUID | FK → signals (CASCADE) |
| `variant` | VARCHAR(1) | `'A'` or `'B'` |
| `assignment_hash` | VARCHAR(64) | Deterministic hash |
| `split_percentage` | INTEGER | Split % (0–100) |
| `policy_version` | VARCHAR(20) | Policy version |
| `created_at` | TIMESTAMPTZ | Timestamp |

### `execution_policies`
Execution policy decisions per experiment.

| Column | Type | Description |
|---|---|---|
| `policy_id` | UUID | PK |
| `experiment_id` | UUID | FK → experiments |
| `execution_mode` | VARCHAR(30) | `SHADOW_ONLY`, `ENGINE_A_PRIMARY`, `ENGINE_B_PRIMARY`, `SPLIT_CAPITAL` |
| `executed_engine` | VARCHAR(1) | Which engine trades real |
| `shadow_engine` | VARCHAR(1) | Which engine shadows |
| `reason` | TEXT | Human-readable explanation |
| `policy_version` | VARCHAR(20) | Version |
| `created_at` | TIMESTAMPTZ | Timestamp |

### `decision_recommendations`
Engine recommendations persisted for audit.

| Column | Type | Description |
|---|---|---|
| `experiment_id` | UUID | PK part 1 |
| `engine` | VARCHAR(1) | PK part 2 (`'A'` or `'B'`) |
| `signal_id` | UUID | Source signal |
| `symbol` | VARCHAR(20) | Underlying |
| `direction` | VARCHAR(10) | `'long'` or `'short'` |
| `timeframe` | VARCHAR(10) | Signal timeframe |
| `strike` | DECIMAL(10,2) | Recommended strike |
| `expiration` | DATE | Recommended expiration |
| `quantity` | INTEGER | Recommended contracts |
| `entry_price` | DECIMAL(10,4) | Expected entry price |
| `is_shadow` | BOOLEAN | Shadow trade flag |
| `rationale` | JSONB | Full enrichment + risk + gamma data |

**Unique constraint**: `(experiment_id, engine)` with UPSERT

### `agent_decisions`
Individual agent outputs per signal (Engine B).

| Column | Type | Description |
|---|---|---|
| `decision_id` | UUID | PK |
| `experiment_id` | UUID | FK → experiments |
| `signal_id` | UUID | FK → signals |
| `agent_name` | VARCHAR(50) | Agent identifier |
| `agent_type` | VARCHAR(20) | `'core'`, `'specialist'`, `'subagent'` |
| `bias` | VARCHAR(20) | `'bullish'`, `'bearish'`, `'neutral'` |
| `confidence` | INTEGER | 0–100 |
| `reasons` | JSONB | Reason codes |
| `block` | BOOLEAN | Veto flag |
| `metadata` | JSONB | Additional data |
| `created_at` | TIMESTAMPTZ | Timestamp |

### `shadow_trades`
Simulated trades from non-primary engine.

| Column | Type | Description |
|---|---|---|
| `shadow_trade_id` | UUID | PK |
| `experiment_id` | UUID | FK → experiments |
| `signal_id` | UUID | FK → signals |
| `symbol` | VARCHAR(20) | Underlying |
| `option_symbol` | VARCHAR(50) | OCC symbol |
| `strike` | DECIMAL(10,2) | Strike |
| `expiration` | DATE | Expiration |
| `type` | VARCHAR(10) | `'call'` or `'put'` |
| `quantity` | INTEGER | Contracts |
| `entry_price` | DECIMAL(10,4) | Entry price |
| `entry_timestamp` | TIMESTAMPTZ | Entry time |
| `contributing_agents` | JSONB | Agent names |
| `meta_confidence` | INTEGER | 0–100 |
| `dealer_decision` | JSONB | Gamma strategy data |

### `shadow_positions`
Simulated positions from shadow engine.

Mirrors `refactored_positions` structure with `shadow_position_id` PK and `shadow_trade_id` FK.

### `exit_rules`
Configuration for automatic exit conditions.

| Column | Type | Default |
|---|---|---|
| `rule_id` | UUID | PK |
| `rule_name` | VARCHAR(50) | `'default'` |
| `profit_target_percent` | DECIMAL(5,2) | 50.00 |
| `stop_loss_percent` | DECIMAL(5,2) | 50.00 |
| `max_hold_time_hours` | INTEGER | 120 |
| `min_dte_exit` | INTEGER | 1 |
| `enabled` | BOOLEAN | true |

### `risk_limits`
Risk management limits and constraints.

| Column | Type | Default |
|---|---|---|
| `limit_id` | UUID | PK |
| `max_position_size` | INTEGER | 10 |
| `max_total_exposure` | DECIMAL(10,2) | 10000.00 |
| `max_exposure_percent` | DECIMAL(5,2) | 20.00 |
| `max_positions_per_symbol` | INTEGER | 3 |
| `enabled` | BOOLEAN | true |

### `feature_flags`
Runtime feature toggles.

| Column | Type | Description |
|---|---|---|
| `flag_id` | UUID | PK |
| `name` | VARCHAR(100) | UNIQUE flag name |
| `enabled` | BOOLEAN | Toggle state |
| `description` | TEXT | Human description |
| `updated_at` | TIMESTAMPTZ | Last change |
| `updated_by` | VARCHAR(100) | Who changed it |

### `agent_performance`
Performance metrics per agent.

| Column | Type | Description |
|---|---|---|
| `agent_name` | VARCHAR(50) | UNIQUE agent identifier |
| `total_signals` | INTEGER | Total processed |
| `approved_signals` | INTEGER | Approved count |
| `rejected_signals` | INTEGER | Rejected count |
| `avg_confidence` | DECIMAL(5,2) | Average confidence output |
| `win_rate` | DECIMAL(5,2) | Win rate % |
| `avg_win` | DECIMAL(10,2) | Average winning P&L |
| `avg_loss` | DECIMAL(10,2) | Average losing P&L |
| `expectancy` | DECIMAL(10,2) | Expected value per trade |

### `bias_state_current`
Current MTF bias state per symbol (V3 aggregator).

| Column | Type | Description |
|---|---|---|
| `symbol` | VARCHAR(20) | PK |
| `state` | JSONB | Full UnifiedBiasState object |
| `updated_at` | TIMESTAMPTZ | Last update |

### `bias_trade_performance`
Trade outcomes correlated with entry bias state.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | PK |
| `position_id` | UUID | FK to position |
| `symbol` | VARCHAR(20) | Underlying |
| `direction` | VARCHAR(10) | `'long'` or `'short'` |
| `pnl_r` | NUMERIC | Risk-adjusted P&L |
| `pnl_percent` | NUMERIC | Percentage P&L |
| `duration_minutes` | INTEGER | Hold time |
| `entry_bias_score` | NUMERIC | Bias score at entry |
| `entry_macro_class` | VARCHAR(50) | Macro class at entry |
| `entry_regime` | VARCHAR(50) | Regime at entry |
| `entry_intent` | VARCHAR(50) | Mode hint at entry |
| `entry_acceleration` | NUMERIC | Acceleration at entry |
| `exit_reason_codes` | TEXT[] | Array of exit reasons |
| `source` | VARCHAR(20) | `'live'` or `'simulation'` |
| `created_at` | TIMESTAMPTZ | Capture time |

### `bias_adaptive_config_history`
Parameter adjustment audit trail.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | PK |
| `config_key` | VARCHAR(100) | Parameter name |
| `old_value` | JSONB | Previous value |
| `new_value` | JSONB | New value |
| `reason` | TEXT | Why changed |
| `created_at` | TIMESTAMPTZ | When changed |

---

# 14. REDIS / CACHE

## Cache Architecture

Two cache layers:
1. **In-memory cache** (`node-cache`): `src/services/cache.service.ts` — local process cache
2. **Redis cache** (`ioredis`): `src/services/redis-cache.service.ts` — distributed cache via Upstash

## Redis Keys

| Key Pattern | TTL | Purpose |
|---|---|---|
| `gex:{symbol}:{date}` | 300s (5 min) | GEX snapshot data |
| `analytics:pnl_curve:{period}` | 900s (15 min) | P&L curve data |
| `analytics:daily_returns:{period}` | 900s (15 min) | Daily returns |
| `performance:{metric}:{period}` | 600s (10 min) | Performance metrics |
| `flow:{symbol}:{date}` | Sorted set | Options flow entries (webhook ingestion) |
| `price:{symbol}` | Short TTL | Latest price tick |
| `chain:{symbol}:{date}` | Short TTL | Options chain snapshot |
| `bias:{symbol}:current` | Variable | Current bias state |
| `bias:{symbol}:events` | Variable | Recent bias events |

## TTL Configuration

```typescript
const ttl = {
  gex: 300,        // 5 minutes
  analytics: 900,  // 15 minutes
  performance: 600, // 10 minutes
};
```

## Queue Behavior

Redis pub/sub used for market webhook pipeline triggers:
- `webhookIngestionService.publishPipelineTrigger()` → publishes to channel
- `MarketWebhookPipelineWorker` subscribes → processes flow data into signals

Redis sorted sets used for flow data storage:
- `storeFlow()` → `ZADD flow:{symbol}:{date} timestamp entry`
- `getLatestFlow()` → `ZREVRANGEBYSCORE flow:{symbol}:{date} +inf -inf LIMIT 0 N`

## Locking Behavior

No explicit Redis-based locking. Concurrency control via:
- PostgreSQL `SELECT FOR UPDATE SKIP LOCKED` for signal processing
- Worker `isRunning` flag for worker-level mutual exclusion
- `processing_lock` table for cron-based processing

## Failure Scenarios

| Scenario | Impact | Mitigation |
|---|---|---|
| Redis connection failure | Cache disabled, all queries go to DB | Graceful degradation — `isAvailable()` checked before every operation |
| Redis timeout | Individual cache miss | `connectTimeout: 2000ms`, retry strategy with backoff |
| Upstash TLS error | Full cache unavailable | Auto-TLS detection for Upstash URLs |
| Redis out of memory | Keys evicted | TTL-based expiration, no unbounded keys |

---

# 15. FAILURE MODES & KNOWN ISSUES

## Why Webhooks Fail

| Symptom | Root Cause | Resolution |
|---|---|---|
| 413 Payload Too Large | Payload > 128KB | Reduce indicator data in TradingView alert |
| 401 Invalid Signature | HMAC mismatch | Verify `HMAC_SECRET` matches TradingView config |
| 400 Missing symbol | Payload lacks `symbol`/`ticker`/`meta.ticker` | Add `symbol` field to TradingView alert |
| 400 Missing direction | No direction-like field found | Add explicit `direction` field |
| 400 Missing timeframe | No timeframe-like field found | Add `timeframe` field |
| 500 Internal Error | DB connection failure | Check `DATABASE_URL`, Neon connection limits |

## Why HOLD May Appear

HOLD = engine returns `null` (no recommendation):

| Cause | Log Message |
|---|---|
| No MTF bias state | `Engine A/B HOLD: no MTF bias state` |
| Trade suppressed | `Engine A/B HOLD: trade suppressed by bias gating` |
| Bias state stale | `Engine A/B HOLD: bias state stale, blocking new trades` |
| Portfolio guard block | `Engine A/B HOLD: portfolio guard block` |
| Entry decision BLOCK | `Engine A entry decision blocked` |
| Entry decision WAIT | `Engine A entry decision wait` |
| Engine B meta reject | `Engine B meta decision rejected` |
| Market data missing | `Engine B market data missing, skipping recommendation` |
| DB unavailable | `Engine A/B: DB unavailable for portfolio guard, blocking` |

**Most common production HOLD**: `REQUIRE_MTF_BIAS_FOR_ENTRY=true` but no MTF bias webhook has been received for the symbol.

## Why Positions May Close in Loss

| Exit Reason | Explanation |
|---|---|
| `stop_loss` | P&L % dropped below `-STOP_LOSS_PCT` (default: -50%) |
| `max_hold_time` | Position held longer than `MAX_HOLD_TIME_HOURS` (120h) |
| `min_dte_exit` | Days to expiration ≤ 1 |
| `exit_intelligence` | Bias flip, confidence collapse, chop spike detected |
| `capacity_near_target` | Closed for capacity — near target but new signal arrived |
| `capacity_aged` | Closed for capacity — old position with low P&L |

## Why UI May Not Update

| Cause | Fix |
|---|---|
| WebSocket disconnected | Frontend auto-reconnects; check network |
| Redis cache stale | Cache TTL will expire; hit `/admin/cache` to invalidate |
| API proxy timeout | Frontend Next.js proxy may timeout on slow backend queries |
| CORS rejection | Verify frontend domain in CORS config |
| No data returned | Check if workers are running (`/monitoring/e2e`) |

## Where Race Conditions May Occur

1. **Signal processing overlap**: Mitigated by `SELECT FOR UPDATE SKIP LOCKED` — but if two orchestrator instances run simultaneously, they may process different signals to the same position
2. **Position closing race**: Exit monitor sets `status = 'closing'`, paper executor looks for `status = 'closing'` — if exit monitor runs again before paper executor fills, it may try to close an already-closing position
3. **Worker overlap**: `isRunning` flag is process-local — in multi-instance deployment, duplicate processing is possible

## Where Configuration Flags Conflict

| Conflict | Behavior |
|---|---|
| `ENABLE_ORCHESTRATOR=false` + `ENABLE_CRON_PROCESSING=true` | Cron uses orchestrator internally — inconsistent |
| `REQUIRE_MTF_BIAS_FOR_ENTRY=true` + no bias webhook source | All signals HOLD indefinitely |
| `ENABLE_CONFLUENCE_GATE=true` + no GEX/flow data provider | Confluence can't compute — signals may be rejected |
| `ENABLE_VARIANT_B=false` + `AB_SPLIT_PERCENTAGE=100` | Split sends to B but B is disabled — falls back to A |
| `DECISION_ONLY_WHEN_MARKET_CLOSED=true` + `ALLOW_PREMARKET=true` | Pre-market signals create decisions but may not create orders depending on session evaluation |

---

# 16. CONFIGURATION MATRIX

## All Environment Variables

### Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | 8080 | HTTP server port |
| `NODE_ENV` | development | Environment (development/production/test) |
| `APP_MODE` | PAPER | Trading mode (PAPER/LIVE) |

### Database

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | **required** | PostgreSQL connection string |
| `DB_POOL_MAX` | 20 | Max DB pool connections |
| `REDIS_URL` | '' | Redis connection string (required in production) |

### Authentication

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | **required** (≥32 chars) | JWT signing secret |
| `HMAC_SECRET` | '' | Webhook HMAC verification secret |

### Market Data Providers

| Variable | Default | Description |
|---|---|---|
| `MARKET_DATA_PROVIDER` | twelvedata | Primary provider |
| `MARKET_DATA_PROVIDER_PRIORITY` | twelvedata,marketdata | Provider fallback chain |
| `ALPACA_API_KEY` | '' | Alpaca API key |
| `ALPACA_SECRET_KEY` | '' | Alpaca secret |
| `ALPACA_PAPER` | true | Use paper API |
| `ALPACA_BASE_URL` | https://paper-api.alpaca.markets | API base URL |
| `TWELVE_DATA_API_KEY` | '' | TwelveData key |
| `MARKET_DATA_API_KEY` | '' | MarketData.app key |
| `POLYGON_API_KEY` | '' | Polygon.io key |
| `UNUSUAL_WHALES_API_KEY` | '' | Unusual Whales key |
| `UNUSUAL_WHALES_OPTIONS_ENABLED` | true | Enable UW options data |

### Worker Intervals

| Variable | Default | Description |
|---|---|---|
| `SIGNAL_PROCESSOR_INTERVAL` | 30000 | Signal processor poll (ms) |
| `ORDER_CREATOR_INTERVAL` | 30000 | Order creator poll (ms) |
| `PAPER_EXECUTOR_INTERVAL` | 10000 | Paper executor poll (ms) |
| `PAPER_EXECUTOR_BATCH_SIZE` | 10 | Orders per batch |
| `POSITION_REFRESHER_INTERVAL` | 60000 | Position refresh poll (ms) |
| `EXIT_MONITOR_INTERVAL` | 60000 | Exit check poll (ms) |
| `ORCHESTRATOR_INTERVAL_MS` | 30000 | Orchestrator poll (ms) |
| `ORCHESTRATOR_BATCH_SIZE` | 20 | Signals per batch |
| `ORCHESTRATOR_CONCURRENCY` | 5 | Concurrent signal processing |
| `ORCHESTRATOR_SIGNAL_TIMEOUT_MS` | 30000 | Per-signal timeout |
| `ORCHESTRATOR_RETRY_DELAY_MS` | 60000 | Retry delay (ms) |

### Risk Management

| Variable | Default | Description |
|---|---|---|
| `MAX_POSITION_SIZE` | 10 | Max contracts per trade |
| `MAX_DAILY_LOSS` | 1000 | Max daily P&L loss ($) |
| `MAX_OPEN_POSITIONS` | 5 | Max concurrent positions |
| `MAX_EXPOSURE_PERCENT` | 20 | Max portfolio exposure % |
| `ALLOW_PREMARKET` | false | Allow pre-market signals |
| `ALLOW_AFTERHOURS` | false | Allow after-hours signals |
| `DECISION_ONLY_WHEN_MARKET_CLOSED` | true | Run engines but skip orders when closed |
| `MARKET_CLOSE_GRACE_MINUTES` | 10 | Minutes before close to still accept |
| `SIGNAL_MAX_AGE_MINUTES` | 30 | Max signal age when market closed |
| `MAX_DAILY_TRADES` | 0 | Daily trade cap (0=unlimited) |
| `POSITION_REPLACEMENT_ENABLED` | false | Enable capacity-based position closing |
| `MIN_CONFIDENCE_FOR_REPLACEMENT` | 70 | Min confidence for replacement |
| `AUTO_CLOSE_NEAR_TARGET` | false | Close positions near profit target for capacity |
| `CLOSE_AGED_POSITIONS` | false | Close old low-P&L positions for capacity |

### Exit Rules

| Variable | Default | Description |
|---|---|---|
| `PROFIT_TARGET_PCT` | 50 | Profit target % |
| `STOP_LOSS_PCT` | 50 | Stop loss % |
| `TIME_STOP_DTE` | 1 | Min DTE before forced exit |
| `MAX_HOLD_DAYS` | 5 | Max hold period (also DTE for expiration) |
| `ENABLE_EXIT_DECISION_ENGINE` | true | Enable tiered exit engine |
| `ENABLE_EXIT_INTELLIGENCE` | true | Enable bias-aware exit adjustments |

### Feature Flags

| Variable | Default | Description |
|---|---|---|
| `ENABLE_ORCHESTRATOR` | true | Use orchestrator (vs legacy signal processor) |
| `ENABLE_VARIANT_B` | false | Enable Engine B |
| `AB_SPLIT_PERCENTAGE` | 0 | % of signals to Engine B (0–100) |
| `ENABLE_ORB_SPECIALIST` | false | ORB specialist agent |
| `ENABLE_STRAT_SPECIALIST` | false | Strat specialist agent |
| `ENABLE_TTM_SPECIALIST` | false | TTM specialist agent |
| `ENABLE_SATYLAND_SUBAGENT` | false | Satyland sub-agent |
| `ENABLE_SHADOW_EXECUTION` | false | Shadow trade creation |
| `ENABLE_DUAL_PAPER_TRADING` | false | Both engines create real paper orders |

### MTF Bias System

| Variable | Default | Description |
|---|---|---|
| `ENABLE_MTF_BIAS_PIPELINE` | true | Process MTF bias webhooks |
| `REQUIRE_MTF_BIAS_FOR_ENTRY` | true (prod) | Block trades without bias state |
| `ENABLE_PORTFOLIO_GUARD` | true (prod) | Exposure-based trade blocking |
| `BIAS_CONTROL_DEBUG_MODE` | false | Verbose bias logging |

### Confluence

| Variable | Default | Description |
|---|---|---|
| `CONFLUENCE_MIN_THRESHOLD` | 50 | Min confluence score to trade |
| `ENABLE_CONFLUENCE_GATE` | true | Reject below threshold |
| `ENABLE_CONFLUENCE_SIZING` | true | Scale size by confluence |
| `BASE_POSITION_SIZE` | 1 | Base contracts before scaling |

### Dealer Strategy

| Variable | Default | Description |
|---|---|---|
| `ENABLE_DEALER_UW_GAMMA` | false | UW gamma API strategy |
| `ENABLE_DEALER_GEX` | true | GEX/flow dealer strategy |
| `DEALER_STRATEGY_WEIGHT` | 0.25 | Dealer confidence threshold |
| `DEALER_UW_NEUTRAL_THRESHOLD` | 100000000 | Neutral gamma threshold |

### Cron

| Variable | Default | Description |
|---|---|---|
| `CRON_SECRET` | '' | Authentication for cron endpoint |
| `CRON_BATCH_SIZE` | 20 | Signals per cron batch |
| `ENABLE_CRON_PROCESSING` | true | Enable cron pipeline |

### Monitoring

| Variable | Default | Description |
|---|---|---|
| `SENTRY_DSN` | '' | Sentry error tracking |
| `LOG_LEVEL` | info | Logging verbosity |
| `E2E_TEST_MODE` | false | Disable bias/guard requirements |
| `ALERTS_ENABLED` | false | Discord/Slack alerts |
| `DISCORD_WEBHOOK_URL` | '' | Discord webhook |
| `SLACK_WEBHOOK_URL` | '' | Slack webhook |

## Conflict States

| State | Effect |
|---|---|
| `REQUIRE_MTF_BIAS_FOR_ENTRY=true` + no bias source | All trades blocked (HOLD) |
| `ENABLE_ORCHESTRATOR=false` + `ENABLE_CRON_PROCESSING=true` | Cron tries to use orchestrator — may fail or use legacy path |
| `ENABLE_CONFLUENCE_GATE=true` + no UW/flow data | Confluence cannot compute — all signals either pass with null or fail |
| `ENABLE_VARIANT_B=true` + `AB_SPLIT_PERCENTAGE=0` | Engine B enabled but never receives signals |
| `APP_MODE=LIVE` | Untested — policy engine may still route to SHADOW_ONLY |
| `E2E_TEST_MODE=true` in production | Disables safety gates — dangerous |

---

# 17. END-TO-END TRACE EXAMPLE

## Scenario: SPY LONG signal at 10:30 AM ET

### Step 1: Webhook Ingestion

**Incoming HTTP Request**:
```
POST /webhook HTTP/1.1
Host: your-api.railway.app
Content-Type: application/json
X-Webhook-Signature: sha256=abc123...

{
  "symbol": "SPY",
  "direction": "long",
  "timeframe": "5m",
  "timestamp": 1739612400,
  "price": 595.42,
  "confidence": 75,
  "indicators": {
    "ema8": 595.10,
    "ema21": 594.80,
    "atr": 1.25
  }
}
```

**Processing**:
```
processWebhookPayload()
  → requestId = "req-001"
  → rawBody.length = 245 (< 128KB ✓)
  → HMAC verification → valid ✓
  → Zod parse → success ✓
  → symbol = "SPY"
  → normalizeDirection("long") → "long"
  → normalizeTimeframe("5m") → "5m"
  → normalizeTimestamp(1739612400) → 2026-02-15T10:30:00.000Z
  → isDuplicate("SPY", "long", "5m", 60, false) → false ✓
  → signalHash = SHA256("SPY:long:5m:2026-02-15T10:30:00.000Z")
  → INSERT INTO signals → signal_id = "sig-001"
  → INSERT INTO webhook_events → event_id = "evt-001"
```

**Response**:
```json
{
  "status": "ACCEPTED",
  "signal_id": "sig-001",
  "request_id": "req-001",
  "processing_time_ms": 42,
  "webhook_event_id": "evt-001",
  "is_test": false
}
```

### Step 2: Orchestrator Processing (~30s later)

```
OrchestratorWorker.run()
  → getUnprocessedSignals(20) → [{ signal_id: "sig-001", symbol: "SPY", direction: "long", timeframe: "5m" }]
  → processSignal(signal)
```

### Step 3: Signal Enrichment

```
buildSignalEnrichment(signal)
  → signalConfidence = 75
  → evaluateMarketSession(10:30 AM) → { isOpen: true, sessionType: "RTH" }
  → risk_limits → { max_position_size: 10, max_positions_per_symbol: 3 }
  → openPositions = 2 (< 5 ✓)
  → openSymbolPositions = 0 (< 3 ✓)
  → currentPrice = 595.42
  → candles = [...200 bars]
  → indicators = { ema8: [595.10], ema21: [594.80], atr: [1.25] }
  → gexData = { netGex: 250000000, dealerPosition: "long_gamma", zeroGammaLevel: 590 }
  → optionsFlow = { entries: [...50 entries], callPremium: 12500000, putPremium: 8000000 }
  → confluence = { score: 72, tradeGatePasses: true }
  → rejectionReason = null
```

**Enrichment Result**:
```json
{
  "enrichedData": {
    "symbol": "SPY",
    "currentPrice": 595.42,
    "indicators": { "ema8": [595.10], "ema21": [594.80] },
    "gex": { "netGex": 250000000, "dealerPosition": "long_gamma" },
    "optionsFlow": { "entries": [...] },
    "confluence": { "score": 72, "tradeGatePasses": true }
  },
  "riskResult": {
    "marketOpen": true,
    "openPositions": 2,
    "maxOpenPositions": 5,
    "signalPriority": { "confidence": 75, "total": 75 }
  },
  "rejectionReason": null,
  "decisionOnly": false
}
```

### Step 4: Experiment Assignment

```
createExperiment(signal, splitToA=1.0, 'v1.0')
  → hash = SHA256("SPY:5m:sig-001")
  → bucket = 0.34 (< 1.0 → variant A)
  → INSERT INTO experiments → experiment_id = "exp-001", variant = "A"
```

### Step 5: Policy Resolution

```
getExecutionPolicy("exp-001", "v1.0", "A")
  → APP_MODE = "PAPER" ✓
  → Engine A available ✓
  → execution_mode = "ENGINE_A_PRIMARY"
  → executed_engine = "A"
  → shadow_engine = null (Engine B not enabled)
```

### Step 6: Engine A Decision

```
buildRecommendation("A", signal, context)
  → getMTFBiasContext("SPY") → { tradeSuppressed: false, unifiedState: {...} }
  → evaluateExposure() → { result: "ALLOW" }
  → buildEntryDecisionInput() → evaluateEntryDecision() → { action: "ENTER" }
  → selectStrike("SPY", "long")
      → price = 595.42
      → strike = Math.ceil(595.42) = 596
      → expiration = 2026-02-20 (next Friday)
      → optionType = "call"
  → buildEntryExitPlan("SPY", 596, 2026-02-20, "call")
      → entryPrice = 3.45
  → baseSize = 10
  → gammaMultiplier = 1.25 (LONG_GAMMA regime)
  → adjustedSize = 12
  → riskMultiplier = 0.8 (from bias state)
  → finalQuantity = max(1, floor(12 * 0.8)) = 9
```

**Engine A Recommendation**:
```json
{
  "experiment_id": "exp-001",
  "engine": "A",
  "symbol": "SPY",
  "direction": "long",
  "strike": 596,
  "expiration": "2026-02-20T00:00:00.000Z",
  "quantity": 9,
  "entry_price": 3.45,
  "is_shadow": false
}
```

### Step 7: Order Creation

```
createPaperOrders()
  → signals.status = "approved" ✓
  → optionType = "call"
  → optionSymbol = "SPY-20260220-CALL-596.00"
  → No existing order for (sig-001, A, paper) ✓
  → INSERT INTO orders
      → order_id = "ord-001"
      → status = "pending_execution"
      → order_type = "paper"
```

### Step 8: Paper Execution (~10s later)

```
PaperExecutorWorker.run()
  → SELECT * FROM orders WHERE status = 'pending_execution' AND order_type = 'paper'
  → [{ order_id: "ord-001", symbol: "SPY", strike: 596, type: "call" }]
  → fetchOptionPrice("SPY", 596, 2026-02-20, "call") → 3.52
  → INSERT INTO trades
      → trade_id = "trd-001"
      → fill_price = 3.52
      → fill_quantity = 9
  → UPDATE orders SET status = 'filled'
  → No existing closing position → CREATE position
  → INSERT INTO refactored_positions
      → position_id = "pos-001"
      → entry_price = 3.52
      → status = "open"
  → publishPositionUpdate("pos-001")
  → publishRiskUpdate()
```

### Step 9: Position Monitoring (ongoing)

```
PositionRefresherWorker.run() (every 60s)
  → SELECT * FROM refactored_positions WHERE status = 'open'
  → position "pos-001": getOptionPrice("SPY", 596, ..., "call") → 3.78
  → unrealized_pnl = (3.78 - 3.52) * 9 * 100 = $234.00
  → UPDATE refactored_positions SET current_price = 3.78, unrealized_pnl = 234.00
```

### Step 10: Exit (profit target hit, ~2 hours later)

```
ExitMonitorWorker.run()
  → position "pos-001": current_price = 5.30, entry_price = 3.52
  → pnlPercent = ((5.30 - 3.52) / 3.52) * 100 = 50.57%
  → pnlPercent >= profit_target_percent (50%) → exitReason = "profit_target"
  → UPDATE refactored_positions SET status = 'closing', exit_reason = 'profit_target'
  → INSERT INTO orders (exit order)
      → order_id = "ord-002"
      → status = "pending_execution"
```

```
PaperExecutorWorker.run()
  → Fill exit order at current price → fill_price = 5.28
  → Detect closing position for option_symbol
  → realized_pnl = (5.28 - 3.52) * 9 * 100 = $1,584.00
  → pnl_percent = 50.0%
  → UPDATE refactored_positions SET status = 'closed', realized_pnl = 1584.00
```

### Step 11: Performance Capture

```
captureTradeOutcome({
  positionId: "pos-001",
  symbol: "SPY",
  direction: "long",
  entryBiasScore: 72,
  entryMacroClass: "RISK_ON",
  entryRegime: "TRENDING",
  entryIntent: "BREAKOUT",
  entryAcceleration: 0.15,
  pnlR: 50.0,
  pnlPercent: 50.0,
  durationMinutes: 125,
  exitReasonCodes: ["profit_target"],
  source: "live"
})
→ INSERT INTO bias_trade_performance
```

### Step 12: UI Reflection

- Dashboard portfolio P&L updates (real-time via WebSocket)
- Position disappears from "Active Positions" tab
- Appears in "Closed" tab with realized P&L = +$1,584
- Performance chart updates on next refresh (cached 10 min)
- Recent activity shows "SPY CALL 596 closed: +50% profit target"

---

# 18. GAP ANALYSIS

## Architectural Inconsistencies

1. **Dual strike selection systems**: Production uses simplified ATM (`strike-selection.service.ts`) while an advanced framework exists in `src/lib/strikeSelection/` with filters and scoring. These are disconnected.

2. **Legacy signal processor**: `SignalProcessorWorker` still exists alongside the `OrchestratorWorker`. When `ENABLE_ORCHESTRATOR=false`, the legacy path is used but may not apply all the enrichment/gating that the orchestrator does.

3. **Order creation split**: Orders are created in two places — inline in `OrchestratorService.createPaperOrders()` AND in `OrderCreatorWorker`. The orchestrator creates orders directly; the worker was the original path.

4. **MTF Bias V1 vs V3**: Two bias systems coexist — legacy `mtf-bias-webhook-handler.service.ts` (V1) and `bias-state-aggregator.service.ts` (V3). Routing logic in `/webhook` dispatches to V3 first, then V1, but the gating logic in engines only uses V3.

## Missing Data Contracts

1. **No formal OpenAPI/Swagger spec**: All API contracts are implicit in route handlers. No generated documentation.
2. **Market data provider interface**: No formal interface/type for market data providers — each client (`alpaca-client.ts`, `marketdata-client.ts`, `polygon-client.ts`) has its own method signatures.
3. **Agent output validation**: Agents extend `BaseAgent` but there's no runtime validation of output bounds beyond unit tests.
4. **WebSocket message format**: No documented schema for WebSocket messages. Frontend relies on implicit structure.

## Incomplete Flows

1. **LIVE mode untested**: `APP_MODE=LIVE` is accepted but the entire execution path is paper-only. No live order submission to Alpaca.
2. **SPLIT_CAPITAL mode**: Defined in types but no orchestrator logic implements it — always routes to single engine.
3. **Confluence sizing**: `ENABLE_CONFLUENCE_SIZING` exists in config but position sizing does not consume confluence score.
4. **Alert system**: `ALERTS_ENABLED` with Discord/Slack URLs but alert delivery is fire-and-forget with no retry.
5. **Position replacement**: Complex capacity management code exists but `POSITION_REPLACEMENT_ENABLED` defaults to false in production.

## Non-Deterministic Logic

1. **Market data timing**: Option prices fetched at different times for enrichment vs. fill. Price can change between orchestrator evaluation and paper executor fill.
2. **Worker timing**: The gap between signal approval and order execution depends on worker intervals (up to 30s + 10s).
3. **Agent activation**: Specialist agents activate based on data availability (e.g., GEX data present). Same signal may activate different agents depending on Redis cache state.

## Potential Race Conditions

1. **Multi-instance signal processing**: `SELECT FOR UPDATE SKIP LOCKED` prevents duplicate processing within one database, but two instances could process related signals that affect the same position count.
2. **Position closing overlap**: If ExitMonitorWorker and capacity management both try to close the same position simultaneously.
3. **Paper executor + exit monitor**: Exit monitor creates closing order → paper executor fills → paper executor also sees the "closing" position and tries to match again.
4. **Feature flag changes**: Feature flags loaded on startup and periodically refreshed. Mid-flight changes could cause inconsistent behavior within a signal processing batch.

## Observability Gaps

1. **No distributed tracing**: Sentry breadcrumbs provide per-signal tracing but no end-to-end trace IDs across webhook → orchestrator → executor.
2. **No metrics dashboard**: Performance monitor tracks stats but no Prometheus/Grafana integration.
3. **Worker health**: `trade-engine-health.service.ts` tracks worker status but no external health check endpoint for orchestration platforms.
4. **Shadow trade performance**: Shadow trade outcomes are tracked but no comparative dashboard (Engine A vs. Engine B performance side by side).
5. **Queue depth alerting**: `PROCESSING_QUEUE_DEPTH_ALERT` configured but alert mechanism not implemented.

---

# 19. REBUILD GUIDE

## What Components Would Remain

1. **Webhook ingestion**: Well-structured, handles multiple payload formats, proper validation and logging
2. **Database schema**: Comprehensive, well-indexed, proper lifecycle tracking
3. **Orchestrator pattern**: Signal → enrichment → experiment → policy → engine → execute flow is sound
4. **Multi-agent framework**: BaseAgent pattern, typed outputs, meta-decision aggregation
5. **Exit engine tiers**: Structured tier-based exit evaluation is production-quality
6. **Performance feedback loop**: Entry-state-to-outcome correlation is valuable and well-designed

## What Should Be Simplified

1. **Strike selection**: Consolidate the two systems. Either use the simple ATM approach (current production) or fully integrate the advanced framework. Not both.
2. **MTF Bias**: Eliminate V1 pipeline. Use only V3 BiasStateAggregator.
3. **Configuration**: 80+ environment variables is excessive. Group into configuration objects, use a configuration schema validator, provide sensible production defaults.
4. **Worker duplication**: Remove legacy `SignalProcessorWorker` if orchestrator is the standard path.
5. **Inline order creation**: Remove order creation from `OrchestratorService.createPaperOrders()` — let `OrderCreatorWorker` handle all orders.

## What Should Be Re-Architected

1. **Live execution path**: Current system is paper-only. Live execution needs:
   - Alpaca order submission (not just data)
   - Order status polling/WebSocket
   - Partial fill handling
   - Error recovery and manual intervention
   - Kill switch

2. **Market data abstraction**: Create a formal `IMarketDataProvider` interface with:
   - `getStockPrice(symbol): Promise<number>`
   - `getOptionPrice(symbol, strike, exp, type): Promise<number | null>`
   - `getCandles(symbol, tf, limit): Promise<Candle[]>`
   - Provider chain with health checks and automatic failover

3. **Position management**: Currently positions are tracked per-option-symbol. Need:
   - Portfolio-level position aggregation
   - Cross-symbol correlation awareness
   - Proper position sizing as % of portfolio (not fixed contract count)

## What Should Move to Message Queue

1. **Signal processing**: Replace polling with pub/sub (Redis Streams or AWS SQS):
   - Webhook → publish to queue
   - Orchestrator → consume from queue
   - Eliminates polling delay and `SELECT FOR UPDATE` overhead

2. **Exit monitoring**: Event-driven price updates instead of polling:
   - Market data WebSocket → price change events
   - Exit engine evaluates on price change, not on timer

3. **Performance feedback**: Async event:
   - Position close → publish outcome event
   - Analyzer consumes asynchronously

## What Should Become Event-Driven

1. **Order lifecycle**: `pending_execution` → `filled` should be an event, not a polling-based state machine
2. **Position updates**: Price changes should trigger position recalculation, not a 60-second timer
3. **Bias state changes**: Regime transitions should trigger portfolio-wide re-evaluation
4. **Alert delivery**: Confluence/risk alerts should be event-driven with guaranteed delivery
5. **Dashboard updates**: Server-sent events or WebSocket pushes on every state change, not polling

## Recommended Architecture for Rebuild

```
                    ┌─────────────┐
TradingView ───────►│  API Gateway │
                    │  (Express)   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Redis Stream │  ← Signal Queue
                    │ (or SQS)    │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Orchestrator │  ← Stateless consumer
                    │  (Lambda or  │
                    │   Worker)    │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Engine A │ │ Engine B │ │ Risk Gate│
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │             │            │
             └─────────────┼────────────┘
                           │
                    ┌──────▼──────┐
                    │ Order Queue  │  ← Execution Queue
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Executor    │  ← Alpaca SDK
                    │  (Paper/Live)│
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Event Bus    │  ← Position events
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │Exit Agent│ │ P&L Calc │ │Dashboard │
        └──────────┘ └──────────┘ └──────────┘
```

---

*End of Document*
