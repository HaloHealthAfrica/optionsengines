# End-to-End Flow: TradingView Webhook → Trade Execution

This document details the complete flow from webhook ingestion through to position closure and P&L capture.

---

## Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  TradingView    │────▶│  POST /webhook    │────▶│  Orchestrator   │────▶│  Order Creator  │────▶│  Paper Executor │
│  (or MTF Bias)  │     │  (Schema + Dup)  │     │  (Engines A/B)  │     │  (Strike/Size)   │     │  (Fill + Pos)   │
└─────────────────┘     └──────────────────┘     └────────┬────────┘     └─────────────────┘     └────────┬────────┘
                                                          │                                               │
                                                          ▼                                               ▼
                                                 ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
                                                 │  Bias State     │     │  Position       │     │  Exit Monitor    │
                                                 │  (Redis + DB)   │     │  Refresher      │     │  (Rules + Intel)│
                                                 └─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                                                                               │
                                                                                                               ▼
                                                                                                        ┌─────────────────┐
                                                                                                        │  P&L Capture    │
                                                                                                        │  Adaptive Tuner  │
                                                                                                        └─────────────────┘
```

---

## Phase 1: Webhook Ingestion

**Entry:** `POST /webhook` (`src/routes/webhook.ts`)

### 1.1 Payload Routing

- **MTF Bias V3** (`event_id_raw` present): → BiasStateAggregator (Redis + `bias_state_current`, `bias_state_history`)
- **Legacy BIAS_SNAPSHOT**: → `handleMTFBiasWebhook` (V1 pipeline)
- **TradingView signal**: → `processWebhookPayload`

### 1.2 TradingView Signal Processing

1. **HMAC validation** (if `HMAC_SECRET` configured)
2. **Schema validation** (`webhookSchema` – symbol, direction, timeframe, etc.)
3. **Symbol extraction** (`symbol` or `ticker` or `meta.ticker`)
4. **Timeframe normalization** (`timeframe`, `tf`, `interval`, `triggerTimeframe`)
5. **Direction normalization** (`long`/`short` from direction, side, trend, bias, signal)
6. **Duplicate check** (same symbol + direction + timeframe within 60s)
7. **Signal hash** (SHA-256 for deduplication)
8. **Insert** into `signals` (status: `pending`, `raw_payload`, `signal_hash`)
9. **Log** to `webhook_events` (event_id, status, signal_id, processing_time_ms)

**Output:** `signal_id`, status `ACCEPTED` or `REJECTED`/`DUPLICATE`

---

## Phase 2: Bias State (Parallel to Signal Flow)

**Workers:** `MTFBiasPipelineWorker`, `BiasStateAggregator`

- Bias webhooks update Redis + `bias_state_current` / `bias_state_history`
- Conflict resolver merges gamma, detects transitions
- Out-of-order events ignored; duplicates dropped by `event_id_raw`
- **Required for entry** when `requireMTFBiasForEntry=true` (non-test)

---

## Phase 3: Orchestrator (Signal → Decision)

**Worker:** `OrchestratorWorker` (every `orchestratorIntervalMs`, default 30s)

**Entry:** `OrchestratorService.processSignals()` → `SignalProcessor.getUnprocessedSignals()`

### 3.1 Signal Selection

- `processed = FALSE`
- `processing_lock = FALSE`
- `status = 'pending'` (or null)
- `queued_until <= NOW()` (if set)
- `next_retry_at <= NOW()` (if set)
- `FOR UPDATE SKIP LOCKED` (DB locking)

### 3.2 Per-Signal Flow

1. **Enrichment** (`buildSignalEnrichment`)
   - Market context (price, GEX, flow)
   - Risk checks (max positions, daily loss, exposure)
   - Queue/defer if market closed or risk exceeded

2. **Experiment creation** (A/B routing via `abSplitPercentage`)

3. **Market context** (`SignalProcessor.buildMarketContext`)
   - GEX snapshot, flow, price
   - `context_hash` (SHA-256) for audit

4. **Bias state check** (`getMTFBiasContext`)
   - If `requireMTFBiasForEntry` and no bias → **HOLD**
   - If bias stale (configurable staleness) → **HOLD**

5. **Portfolio guard** (`evaluateExposure`)
   - Max open positions, exposure %, symbol overlap
   - Block if exceeded

6. **Setup validator** (`validateEntry`)
   - Breakout space, trigger, liquidity, range suppression
   - Block if setup invalid

7. **Engine invocation** (`EngineCoordinator.invokeBoth` or single engine)
   - **Engine A**: Entry rules (tier1–4), strike selection
   - **Engine B**: Multi-agent swarm, meta_decision
   - Both receive: signal, market context, bias state

8. **Risk model** (`calculatePositionSize`)
   - `riskMultiplier` from regime, macro, acceleration
   - Quantity = base × riskMultiplier (capped)

9. **Policy engine** (execution mode, shadow vs real)

10. **Persistence**
    - `experiments` (variant, signal_id)
    - `decision_recommendations` (strike, expiration, quantity, rationale)
    - `agent_decisions` (per-agent outputs)
    - `signals.status` → `approved` or `rejected`
    - `refactored_signals` (enriched_data, rejection_reason)

**Output:** Signal status `approved` or `rejected`; experiment + recommendations stored

---

## Phase 4: Order Creator

**Worker:** `OrderCreatorWorker` (every `orderCreatorInterval`, default 30s)

### 4.1 Input

- `signals` where `status = 'approved'`
- No existing `orders` for that signal

### 4.2 Process

1. **Fetch stock price** (Alpaca → TwelveData → MarketData.app)
2. **Strike selection** (ceil for long, floor for short; or from `decision_recommendations`)
3. **Expiration** (next Friday + DTE)
4. **Option symbol** (e.g. `SPY-20260221-C-600`)
5. **Insert** into `orders` (status: `pending_execution`, order_type: `paper`)

**Output:** Order row with `order_id`, `strike`, `expiration`, `quantity`

---

## Phase 5: Paper Executor

**Worker:** `PaperExecutorWorker` (every `paperExecutorInterval`, default 10s)

### 5.1 Input

- `orders` where `status = 'pending_execution'` AND `order_type = 'paper'`

### 5.2 Process

1. **Daily trade cap** check (`maxDailyTrades`)
2. **Fetch option price** (market data)
3. **Insert** into `trades` (fill_price, fill_quantity, fill_timestamp)
4. **Update** `orders.status` → `filled`
5. **Insert** into `refactored_positions` (status: `open`, entry_price, cost_basis)
6. **P&L capture** (`captureTradeOutcome` → `bias_trade_performance`)
7. **Realtime** publish (position update, risk update)

**Output:** Trade filled; position open

---

## Phase 6: Position Refresher

**Worker:** `PositionRefresherWorker` (every `positionRefresherInterval`, default 60s)

- Fetches current option price
- Updates `refactored_positions` (unrealized_pnl, position_pnl_percent)
- Publishes to realtime stream

---

## Phase 7: Exit Monitor

**Worker:** `ExitMonitorWorker` (every `exitMonitorInterval`, default 60s)

### 7.1 Input

- `refactored_positions` where `status = 'open'`
- `exit_rules` (profit_target_percent, stop_loss_percent, max_hold_time_hours, min_dte_exit)

### 7.2 Process

1. **Exit intelligence** (`evaluateExitAdjustments`)
   - Macro modifier, acceleration modifier, regime modifier
   - Partial exit, tighten/widen stop, convert trailing

2. **Exit decision engine** (`evaluateExitDecision`)
   - Tier rules (hard fail, protection, profit, degradation)

3. **Rule evaluation**
   - Profit target hit → close
   - Stop loss hit → close
   - Time stop (DTE) → close
   - Max hold → close

4. **Close position**
   - Update `refactored_positions` (status: `closed`, realized_pnl, exit_reason, exit_timestamp)
   - Insert/update `trades` if needed
   - **P&L capture** (`captureTradeOutcome`)

**Output:** Position closed; P&L recorded

---

## Phase 8: Adaptive Feedback

**Service:** `AdaptiveTuner` (manual or scheduled)

- Reads `bias_trade_performance` (rolling stats)
- Adjusts risk config (macro drift threshold, acceleration boost, etc.)
- Writes to `bias_config`, `bias_adaptive_config_history`
- When `E2E_TEST_MODE=true`: dry run only, no DB updates

---

## Data Flow Summary

| Stage            | Table(s)                          | Status Values                    |
|------------------|-----------------------------------|----------------------------------|
| Webhook          | `webhook_events`, `signals`       | accepted, duplicate, rejected   |
| Orchestrator     | `experiments`, `refactored_signals`, `agent_decisions`, `decision_recommendations` | pending → approved/rejected |
| Order Creator    | `orders`                          | pending_execution → filled       |
| Paper Executor   | `trades`, `refactored_positions`  | open                             |
| Exit Monitor     | `refactored_positions`            | open → closed                    |
| Adaptive         | `bias_config`, `bias_adaptive_config_history` | —                          |

---

## Worker Intervals (Default)

| Worker             | Interval | Config Key                |
|--------------------|----------|---------------------------|
| Orchestrator       | 30s      | `orchestratorIntervalMs`  |
| Order Creator      | 30s      | `orderCreatorInterval`    |
| Paper Executor     | 10s      | `paperExecutorInterval`   |
| Position Refresher | 60s      | `positionRefresherInterval`|
| Exit Monitor       | 60s      | `exitMonitorInterval`     |

---

## Gating Points (Signals Can Be Blocked)

1. **Webhook:** Invalid schema, duplicate, missing symbol/direction/timeframe
2. **Bias:** No MTF bias state when `requireMTFBiasForEntry=true`
3. **Bias staleness:** State older than configured threshold
4. **Portfolio guard:** Max positions, exposure %, overlap
5. **Setup validator:** Breakout space, trigger, liquidity, range
6. **Risk model:** Zero size after modifiers
7. **Market data:** No price → order creation fails
8. **Daily cap:** `maxDailyTrades` reached

---

## Cron Alternative (Serverless)

When workers don't run (e.g. Vercel):

- `POST /api/cron/process-queue` (with `CRON_SECRET`)
- Runs: Orchestrator → Order Creator → Paper Executor → Position Refresher → Exit Monitor
- Call every 2–3 minutes
- Set `ENABLE_CRON_PROCESSING=false` when workers run (e.g. Fly.io)

---

## Scripts

| Script                    | Purpose                                                         |
|---------------------------|-----------------------------------------------------------------|
| `run-e2e-replay.ts`       | Replay webhook payloads to `/webhook`                           |
| `run-e2e-full-pipeline.ts`| Track signals → orders → trades (needs auth)                     |
| `run-pipeline-once.ts`    | Run full pipeline once (DB direct, no HTTP)                     |

### Validate E2E Webhook Through Trading

To validate the full flow from webhook to trade:

```bash
# 1. Set auth (required for monitoring/orders)
$env:BACKEND_TOKEN="your-jwt"   # or BACKEND_EMAIL + BACKEND_PASSWORD

# 2. Optional: trigger process-queue immediately (otherwise wait for workers)
$env:CRON_SECRET="your-cron-secret"

# 3. Run full validation (sends unique webhooks, polls until filled/rejected)
npm run e2e:validate

# Or with options:
npx tsx scripts/run-e2e-full-pipeline.ts --send --url=https://optionsengines.fly.dev --poll=10 --max=8 --cron-secret=xxx
```

**Flow:** Webhook (AAPL/MSFT/XLK) → Orchestrator → Order Creator → Paper Executor → Trade filled. Uses unique symbol+timeframe combos to avoid 60s duplicate window.

---

## Where the System Breaks (Diagnosis)

Based on observed failures and code analysis:

### 1. **Market Data (Primary Blocker)**

**Symptom:** Order Creator fails with "All market data providers failed"; Paper Executor cannot fill.

**Cause:**
- **Alpaca 401 Unauthorized:** Invalid or expired `ALPACA_API_KEY` / `ALPACA_SECRET_KEY`
- **TwelveData null:** Returns `null` or invalid price → rejected by `isValidPrice()` (must be finite, > 0, within symbol bounds)
- **Circuit breaker:** After 5 failures, Alpaca is skipped; if all providers fail, price fetch throws

**Impact:** No orders created, no trades filled. Pipeline stops at Order Creator.

**Fix:** Configure valid Alpaca credentials (`ALPACA_API_KEY`, `ALPACA_SECRET_KEY`) or ensure TwelveData returns valid prices. Check market hours (outside RTH some providers return null).

---

### 2. **Bias State Missing (Orchestrator Block)**

**Symptom:** Engines return HOLD; signals stay pending or get rejected.

**Cause:**
- `requireMTFBiasForEntry=true` (default in non-test) but no MTF bias webhooks received
- Bias state not in Redis or `bias_state_current` / `bias_state_history`
- Bias state stale (older than staleness threshold) → behavior `block` → HOLD

**Impact:** Orchestrator never approves signals; Order Creator never sees approved signals.

**Fix:** Ensure MTF bias webhooks flow to `/webhook` or `/api/webhooks/mtf-bias`. Set `REQUIRE_MTF_BIAS_FOR_ENTRY=false` for testing without bias. Or seed bias state.

---

### 3. **Redis Unavailable**

**Symptom:** "Stream isn't writeable and enableOfflineQueue options is false"; Webhook ingestion / MTF bias stream / market webhook pipeline fail to connect.

**Cause:**
- `REDIS_URL` not set or invalid
- Redis server down or unreachable
- `enableOfflineQueue: false` → no queuing when disconnected

**Impact:**
- Bias state: Falls back to DB (`bias_state_current`, `bias_state_history`) if Redis fails; may still work
- Market webhook pipeline: Cannot subscribe to streams → flow/price webhooks may not trigger
- Webhook ingestion: Cache/stream features degraded

**Fix:** Set valid `REDIS_URL` (e.g. Upstash, Redis Cloud). Or run without Redis (bias uses DB fallback; some features may be limited).

---

### 4. **Portfolio Guard / Setup Validator**

**Symptom:** "Engine A/B HOLD: portfolio guard block" or setup block.

**Cause:**
- Max open positions reached
- Exposure % exceeded
- Symbol overlap
- Setup validator: breakout space, trigger, liquidity, range suppression

**Impact:** Signals approved by engines but blocked before order creation. Check `exposureResult.reasons` and setup validator logs.

**Fix:** Adjust `maxOpenPositions`, `maxExposurePercent`; or fix setup conditions (e.g. ensure sufficient breakout space).

---

### 5. **Signal Processor vs Orchestrator**

**Note:** When `enableOrchestrator=true`, the **Signal Processor Worker is not started**. The Orchestrator handles enrichment and risk checks internally. If `enableOrchestrator=false`, the old Signal Processor runs first (enrichment, risk checks) and then Order Creator runs; Orchestrator is skipped.

**Potential confusion:** "0 unprocessed signals" from Orchestrator can mean:
- Production workers already processed them
- Signals are `queued_until` future
- Signals are `rejected` or `approved` already
- Query filters (e.g. `next_retry_at`) exclude them

---

### 6. **E2E Replay Default URL**

**Symptom:** Replay sends to wrong port.

**Cause:** `run-e2e-replay.ts` defaults to `http://localhost:8080/webhook`; dev server runs on 3000.

**Fix:** `--url=http://localhost:3000/webhook` or `WEBHOOK_REPLAY_URL=http://localhost:3000/webhook`

---

### Quick Debug Checklist

| Check | Command / Location |
|-------|--------------------|
| Alpaca auth | `ALPACA_API_KEY` set; test with curl to Alpaca API |
| Webhook ingestion | `POST /webhook` returns 201 with `signal_id` |
| Pending signals | `SELECT * FROM signals WHERE status='pending' AND processed=false` |
| Approved signals | `SELECT * FROM signals WHERE status='approved'` |
| Bias state | `GET /api/bias/state?symbol=SPY` or `bias_state_current` table |
| Orders | `SELECT * FROM orders WHERE status='pending_execution'` |
| Redis | `REDIS_URL` set; connection logs on startup |
