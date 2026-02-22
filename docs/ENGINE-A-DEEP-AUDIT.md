# Engine A Deep Audit — Decision Engine A (Rule-Based)

**Date:** 2026-02-20
**Auditor:** AI Systems Auditor
**Scope:** End-to-end code-level audit of Engine A
**Assumption:** Real capital is at risk. Skeptical posture throughout.

---

## 1) Engine A Surface Area & Call Flow

### Dependency Map

```
Signal Ingestion (webhook.ts)
  └─▶ Orchestrator Service (orchestrator-service.ts)
       ├─▶ Signal Processor (signal-processor.ts) — dedup, locking
       ├─▶ Signal Enrichment (signal-enrichment.service.ts) — market data, risk gates
       ├─▶ Policy Engine (policy-engine.ts) — route to Engine A/B
       └─▶ Engine Coordinator (engine-coordinator.ts)
            └─▶ Engine A Invoker (engine-invokers.ts :: buildRecommendation('A', ...))
                 │
                 ├─ [Pre-flight] MTF Bias Check (mtf-bias-state.service.ts)
                 ├─ [Pre-flight] Staleness Check (bias-config.service.ts)
                 ├─ [Pre-flight] Portfolio Guard (portfolio-guard-integration.service.ts)
                 │
                 ├─ [Gate] Entry Decision Engine (lib/entryEngine/evaluator.ts)
                 │    ├─ Tier 1: Hard Blocks (tier1HardBlocks.ts)
                 │    ├─ Tier 2: Delays (tier2Delays.ts)
                 │    └─ Tier 3: Entry Approval (tier3Entry.ts)
                 │
                 ├─ [Select] Advanced Strike Selection (advanced-strike-selection.service.ts)
                 │    └─ Fallback: Simple Strike Selection (strike-selection.service.ts)
                 │
                 └─ [Size] Position Sizing Pipeline:
                      ├─ Base: config.maxPositionSize
                      ├─ × Confluence multiplier (when enabled)
                      ├─ × Gamma sizing multiplier (regime-based)
                      └─ × Bias risk multiplier (risk-model-integration.service.ts)
                           └─ Final: Math.max(1, Math.floor(adjustedSize))
                 │
                 └──▶ TradeRecommendation
                       └─▶ Order Creator (order-creator.ts) — same-strike cooldown
                            └─▶ Paper Executor (paper-executor.ts) — fill, position create
                                 └─▶ Exit Engine (lib/exitEngine/) — monitor/close
```

### Key Files

| Layer | File | Purpose |
|-------|------|---------|
| Orchestrator | `src/orchestrator/engine-invokers.ts` | Engine A invoker, sizing pipeline |
| Orchestrator | `src/orchestrator/orchestrator-service.ts` | Signal distribution, enrichment |
| Orchestrator | `src/orchestrator/signal-processor.ts` | Locking, dedup, concurrent safety |
| Entry Engine | `src/lib/entryEngine/evaluator.ts` | Tier 1→2→3 cascade |
| Entry Engine | `src/lib/entryEngine/rules/tier1HardBlocks.ts` | 6 hard-block rules |
| Entry Engine | `src/lib/entryEngine/rules/tier2Delays.ts` | 3 delay rules |
| Entry Engine | `src/lib/entryEngine/rules/tier3Entry.ts` | Entry approval + instructions |
| Entry Engine | `src/lib/entryEngine/types.ts` | EntryDecisionInput/Output types |
| Exit Engine | `src/lib/exitEngine/evaluator.ts` | 4-tier exit cascade |
| Strike | `src/services/strike-selection.service.ts` | Simple ATM selection |
| Strike | `src/services/advanced-strike-selection.service.ts` | Delta-targeted, scored |
| Sizing | `src/services/bias-state-aggregator/risk-model-integration.service.ts` | Bias-modulated sizing |
| Risk | `src/services/drawdown-circuit-breaker.service.ts` | Portfolio drawdown freeze |
| Risk | `src/services/gamma-exposure.service.ts` | Greeks exposure limits |
| Risk | `src/services/dte-concentration.service.ts` | DTE bucket limits |
| Risk | `src/services/same-strike-cooldown.service.ts` | Duplicate trade prevention |
| Risk | `src/lib/shared/constants.ts` | Guardrails, thresholds, policies |
| Adapter | `src/services/entry-decision-adapter.service.ts` | Maps enrichment → EntryDecisionInput |
| Adapter | `src/services/signal-enrichment.service.ts` | Market data + risk gate enrichment |
| Workers | `src/workers/order-creator.ts` | Order creation from approved signals |
| Workers | `src/workers/paper-executor.ts` | Paper fill, position lifecycle |
| P&L | `src/lib/pnl/calculate-realized-pnl.ts` | Direction-aware P&L |

---

## 2) Entry Decision Audit (Tier System)

### Evaluator Flow

```
evaluateEntryDecision(input)
  ├─ evaluateTier1Rules() → if any triggered → BLOCK (return immediately)
  ├─ evaluateTier2Rules() → if any triggered → WAIT (return immediately)
  └─ evaluateTier3Rules() → always → ENTER with EntryInstructions
```

**Design correctness:** Tier 1 short-circuits before Tier 2, which short-circuits before Tier 3. This is correct fail-fast behavior.

### Tier 1: Hard Blocks

| Rule | Condition | Inputs | Output | Risks | Tests Needed |
|------|-----------|--------|--------|-------|--------------|
| `LOW_SIGNAL_CONFIDENCE` | confidence < min per setupType (SCALP:65, SWING:60, POSITION:55, LEAPS:50) | `signal.confidence`, `setupType` | BLOCK | **False-pass if confidence defaults to 70** when payload lacks confidence field (adapter defaults to 70, which passes SWING/POSITION/LEAPS minimum) | Unit: edge cases at boundary values |
| `REGIME_CONFLICT` | CALL + bearish regime OR PUT + bullish regime | `direction`, `marketContext.regime` | BLOCK | NEUTRAL/CHOPPY regimes never block — intentional but permits trading in chop | Unit: all direction × regime combos |
| `VOLATILITY_MISMATCH` | IV percentile outside setup-specific band | `ivPercentile`, `setupType` | BLOCK | **IV percentile proxy uses ATR when UW data unavailable** — proxy formula `((vol-0.4)/2.6)*100` is crude; could false-pass/block | Unit: proxy edge cases |
| `PORTFOLIO_MAX_TRADES` | openTrades >= maxOpenPositions (default 8 from guardrails OR config override) | `riskContext.openTradesCount` | BLOCK | **Dual source of truth**: `PORTFOLIO_GUARDRAILS.maxOpenTrades=8` vs `config.maxOpenPositions=5` — `entryEngineManagesRiskGating` controls which is used | Integration: verify which limit applies |
| `DAILY_LOSS_LIMIT` | dailyPnL <= maxDailyLoss (default -750 from guardrails) | `riskContext.dailyPnL` | BLOCK | **Sign convention risk**: guardrails store `-750`, adapter stores positive `config.maxDailyLoss=1000` and negates. Works but fragile. | Unit: sign edge cases |
| `MAX_POSITIONS_PER_SYMBOL` | openPerSymbol >= maxPerSymbol | `riskContext.openSymbolPositions` | BLOCK | Only active when `entryEngineManagesRiskGating=true` | Unit: enabled/disabled paths |
| `PORTFOLIO_DELTA_LIMIT` | abs(portfolioDelta) >= 400 | `riskContext.portfolioDelta` | BLOCK | **CRITICAL: adapter hardcodes `portfolioDelta: 0` and `portfolioTheta: 0`** — these rules NEVER fire | Integration: must fix adapter |
| `PORTFOLIO_THETA_LIMIT` | abs(portfolioTheta) >= 250 | `riskContext.portfolioTheta` | BLOCK | Same as above — **dead rule** | Integration: must fix adapter |
| `UNSAFE_LIQUIDITY` | liquidityState not in allowed list for setup | `timingContext.liquidityState` | BLOCK | **Adapter hardcodes `liquidityState: 'NORMAL'`** — this rule NEVER fires | Integration: must derive from market data |
| `BIAS_SETUP_VALIDATOR` | setup validator rejects entry | `marketState` | BLOCK | Only fires when `marketState` is provided (MTF bias available) | Unit: with/without market state |

### Tier 2: Delays

| Rule | Condition | Inputs | Output | Risks | Tests Needed |
|------|-----------|--------|--------|-------|--------------|
| `CONFIRMATION_PENDING` | `signal.confirmationPending === true` | Signal flag | WAIT | Rarely used; adapter does not set this field (defaults undefined/falsy) — effectively dead | Unit: explicit true/false |
| `UNFAVORABLE_TIMING` | Opening (first 15min), Closing (after min 15), Lunch scalps | `session`, `minutesFromOpen`, `setupType` | WAIT | **Timing logic inverted possibility**: `session === 'CLOSE' && minutesFromOpen >= 15` — `minutesFromOpen` is minutes since 9:30, so 15 min from open is 9:45am, not close. This seems wrong — should likely be `minutesUntilClose` | Scenario: verify timing boundaries |
| `GEX_RESISTANCE` | GEX state delays calls (POSITIVE_HIGH) or puts (NEGATIVE_HIGH) | `gexState`, `direction` | WAIT | Depends on `gexState` derivation — only POSITIVE_HIGH blocks calls, only NEGATIVE_HIGH blocks puts. LOW/NEUTRAL pass through. | Unit: all GEX×direction combos |

**WAIT handling in engine-invokers.ts**: Returns a recommendation with `strike: 0, quantity: 0, entryWait: true`. The downstream handling of this `entryWait` signal needs verification — **if the order creator processes `entryWait` recommendations, it would create 0-quantity orders**.

### Tier 3: Entry Approval

| Rule | Output | Risks |
|------|--------|-------|
| `ENTRY_APPROVED` | EntryInstructions with entryType, confirmationRequired, maxWaitMinutes | Always succeeds if Tier 1/2 pass — no additional validation |

**Observation**: Tier 3 always approves. There is no "soft reject" at Tier 3. This means if Tier 1 and 2 both pass, the trade proceeds unconditionally.

---

## 3) Options Correctness Audit

### Direction Mapping

| Stage | Long Signal | Short Signal | Correct? |
|-------|-------------|-------------|----------|
| Webhook ingestion | `direction: 'long'` | `direction: 'short'` | N/A |
| Entry adapter (`buildEntryDecisionInput`) | `'CALL'` | `'PUT'` | ✅ |
| Strike selection (simple) | `Math.ceil(price)` → ATM call | `Math.floor(price)` → ATM put | ✅ |
| Strike selection (simple): optionType | `'call'` | `'put'` | ✅ |
| Advanced strike selection | `optionType = direction === 'long' ? 'call' : 'put'` | Same | ✅ |
| Order creator | `optionType = direction === 'long' ? 'call' : 'put'` | Same | ✅ |
| Paper executor: position_side | Hardcoded `'LONG'` | N/A (short not supported) | ✅ for current scope |
| P&L calculation | `(exit - entry) * qty * 100` for LONG | `(entry - exit) * qty * 100` for SHORT | ✅ |
| Performance capture: direction | `type === 'call' ? 'long' : 'short'` | Same | ✅ |

**Direction inversion root-cause checklist:**

1. ✅ `signal.direction` → `'CALL'/'PUT'` mapping correct in adapter
2. ✅ `optionType` = `call/put` consistent with direction
3. ✅ P&L formula direction-aware and documented
4. ⚠️ **Platform currently hardcodes `position_side: 'LONG'`** — if short selling is added later, this must be parameterized
5. ⚠️ Paper executor slippage always adds to cost (adverse for buys), but comments say it doesn't know order side — **exit fills are also penalized upward** when they should be penalized downward

### DTE Selection

- Simple path: Uses `DTE_POLICY.SWING` always (min:21, max:90, preferred:[30,60]) regardless of actual setupType
- Advanced path: Uses proper `deriveSetupType(timeframe)` → correct DTE range per setup
- **BUG**: Simple strike selection ignores setupType — a SCALP_GUARDED signal (should be 3-14 DTE) gets SWING DTE (30-60 DTE)

### Strike Selection Correctness

- Simple: `Math.ceil(price)` for long (slightly OTM call), `Math.floor(price)` for short (slightly OTM put) — reasonable ATM approximation
- Advanced: Delta-targeted with Greeks scoring, liquidity filters, GEX suitability — comprehensive
- **Fallback**: Advanced failure falls through to simple — safe degradation

### Contract Symbol Format

```
buildOptionSymbol: `${symbol}-${YYYYMMDD}-${CALL/PUT}-${strike.toFixed(2)}`
Example: SPY-20260320-CALL-590.00
```

This is NOT OCC symbology (which would be `SPY   260320C00590000`). The format is internal and consistent within the system, so this is acceptable for paper trading but would need mapping for live execution.

---

## 4) Risk Controls Audit

### Risk Coverage Matrix

| Risk Category | Implemented? | Where | Gaps |
|---------------|-------------|-------|------|
| **Daily loss cap** | ✅ Dual enforcement | `signal-enrichment.service.ts` (pre-engine) + `tier1HardBlocks.ts` (in-engine) | Config flag `entryEngineManagesRiskGating` controls which fires — **both should always fire** for defense-in-depth |
| **Max open positions** | ✅ Dual enforcement | Same as above | Same gap — when entry engine manages, enrichment skips the check |
| **Max per symbol** | ✅ Dual enforcement | Same | Same |
| **Drawdown circuit breaker** | ✅ | `drawdown-circuit-breaker.service.ts` | **Only checked in Engine B path, NOT in Engine A path** (see engine-invokers.ts) |
| **Gamma/Greeks exposure** | ✅ | `gamma-exposure.service.ts` | **Only checked in Engine B path, NOT in Engine A path** |
| **DTE concentration** | ✅ | `dte-concentration.service.ts` | **Only checked in Engine B path, NOT in Engine A path** |
| **Same-strike cooldown** | ✅ | `same-strike-cooldown.service.ts` | Checked in order-creator, not in engine invoker. **Fail-open**: DB error → allow order |
| **Market hours** | ✅ | `signal-enrichment.service.ts` | Test signals bypass — acceptable |
| **Signal staleness** | ✅ | `signal-enrichment.service.ts` | 30-minute max age — reasonable |
| **Correlation risk** | ⚠️ Partial | `correlation-risk-agent.ts` (Engine B only) | **Not integrated into Engine A path** |
| **Portfolio delta/theta limits** | ❌ Dead code | `tier1HardBlocks.ts` rules exist but adapter feeds 0 | **Must fix adapter to query real portfolio Greeks** |
| **Liquidity state gate** | ❌ Dead code | `tier1HardBlocks.ts` rule exists but adapter feeds 'NORMAL' | **Must derive from actual liquidity data** |
| **Kill switch** | ✅ | `kill-switch-validator.ts` | Validation layer, not in hot path — need to verify it's actually checked |
| **Bias staleness** | ✅ | Engine invoker pre-flight | Block or reduce risk based on config |
| **Portfolio guard** | ✅ | Engine invoker pre-flight | BLOCK/DOWNGRADE/ALLOW — but DOWNGRADE is not handled (only BLOCK) |
| **Position replacement** | ✅ | `signal-enrichment.service.ts` | Auto-closes aged/near-target positions for capacity |
| **Max daily trades** | ✅ | `paper-executor.ts` | `config.maxDailyTrades` — enforced at execution |
| **Order expiration** | ✅ | `paper-executor.ts` | `config.orderExpirationMinutes` — marks stale orders failed |
| **Confluence gate** | ✅ | `signal-enrichment.service.ts` | Feature-flagged, rejects when score below threshold |

### CRITICAL FINDING: Engine A Missing Risk Checks

The most severe finding of this audit:

**Engine A's `buildRecommendation('A', ...)` does NOT call:**
- `checkDrawdownCircuitBreaker()` — present in Engine B at line 615-623
- `checkGammaExposure()` — present in Engine B at line 626-634
- `checkDTEConcentration(expiration)` — present in Engine B at line 830-838

Engine A relies solely on:
1. Pre-flight MTF bias checks (shared with B)
2. Tier 1-3 entry decision rules (but portfolio delta/theta rules are dead)
3. Signal enrichment risk gates (but some are skipped when `entryEngineManagesRiskGating=true`)

**This means Engine A can trade through a drawdown freeze, exceed gamma exposure limits, and over-concentrate on one DTE bucket.**

---

## 5) Sizing Audit

### Sizing Formula

```
baseSize = Math.max(1, Math.floor(config.maxPositionSize))     // default: 10
  × confluenceMultiplier   (when enableConfluenceSizing=true)   // from confluence.positionSizeMultiplier
  × gammaSizingMultiplier  (from gamma regime)                  // LONG_GAMMA: 1.25, SHORT_GAMMA: 0.6
  × biasRiskMultiplier     (from risk-model-integration)        // range: [0.25, 1.5]
quantity = Math.max(1, Math.floor(adjustedSize))
```

### Example Calculations

**Scenario 1: High conviction, bullish, LONG_GAMMA**
- Base: 10
- Confluence: 1.2 → 12
- Gamma (LONG_GAMMA): × 1.25 → 15
- Bias (MACRO_TREND_UP + high alignment): × 1.15 × 1.1 = 1.265 → capped at 1.5 → 15 × 1.5 = 22
- Final: 22 contracts

**Scenario 2: Low conviction, bearish, SHORT_GAMMA, stale data**
- Base: 10
- Confluence: 0.8 → 8
- Gamma (SHORT_GAMMA): × 0.6 → 4.8 → 4
- Bias (stale + breakdown): × 0.5 × 0.7 = 0.35 → floored at 0.25 → 4 × 0.25 = 1
- Final: 1 contract

### Sizing Risks

| Risk | Status | Details |
|------|--------|---------|
| **No max contract cap in Engine A sizing** | ❌ CRITICAL | `risk-model-integration.service.ts` has `MAX_CONTRACTS = 10` but Engine A invoker applies multipliers AFTER this cap, not before. The only cap is `Math.max(1, Math.floor(...))` — no upper bound. |
| **No max premium cap** | ❌ CRITICAL | No check that `quantity × entryPrice × 100` doesn't exceed a dollar threshold. With quantity=22 at $5 premium = $11,000 exposure from a single trade. |
| **No max notional cap** | ❌ CRITICAL | No check on strike × quantity × 100 notional. |
| **Confluence multiplier unbounded** | ⚠️ | `confluence.positionSizeMultiplier` has no explicit cap in the invoker — depends on upstream computation. |
| **Gamma custom multiplier unbounded** | ⚠️ | `gammaContext.position_size_multiplier` from gamma decision has no cap — only `Math.max(1, ...)` floor. A bug in gamma could produce 10× multiplier. |
| **DTE not considered** | ⚠️ | 0DTE and 90DTE positions get the same base sizing. 0DTE has much higher gamma/theta risk. |
| **Symbol differences ignored** | ⚠️ | SPY ($590 × 100 = $59K notional) and a $20 stock use the same base sizing logic. No notional scaling. |
| **Order creator has separate sizing** | ⚠️ | `order-creator.ts` independently calculates `baseQty = maxPositionSize * capacityRatio * confluenceMultiplier` — **duplicates Engine A sizing but with DIFFERENT logic** (includes capacityRatio, lacks gamma/bias multipliers). Which one wins depends on the path taken. |

### Sizing Path Inconsistency

There are TWO sizing paths that can produce different results:

1. **Engine A invoker path** (via orchestrator): `maxPositionSize × confluence × gamma × bias`
2. **Order creator path** (legacy worker): `maxPositionSize × capacityRatio × confluence`

When `entryEngineManagesRiskGating=true` and signals go through the orchestrator, the Engine A invoker calculates quantity and stores it in the recommendation. But the order creator independently re-calculates quantity. **The order creator's quantity may override the Engine A quantity.**

---

## 6) Execution & State Integrity Audit

### Idempotency Analysis

| Stage | Mechanism | Safe? | Notes |
|-------|-----------|-------|-------|
| **Webhook dedup** | SHA-256 hash + 60s window check | ✅ | `isDuplicate()` in webhook.ts |
| **Signal processing** | `SELECT FOR UPDATE SKIP LOCKED` + `processing_lock` flag | ✅ | Good concurrent safety |
| **Order creation** | `LEFT JOIN orders ... WHERE o.order_id IS NULL` | ✅ | Prevents duplicate orders per signal |
| **Order idempotency** | Unique index on `(signal_id, engine, order_type)` for entries | ✅ | DB-level constraint |
| **Trade creation** | Check `existing trade WHERE order_id = $1` before insert | ✅ | In-transaction check |
| **Position close** | `UPDATE ... WHERE status = 'closing' RETURNING position_id` | ✅ | Atomic guard prevents double-close |

### Concurrency Risks

| Risk | Severity | Details | Suggested Fix |
|------|----------|---------|---------------|
| **Paper executor `isRunning` flag is not atomic** | LOW | `this.isRunning` is a JS boolean — safe in single-process Node.js but would break with clustering. | Use DB advisory lock or Redis lock for multi-instance. |
| **Order creator `isRunning` same pattern** | LOW | Same as above. | Same fix. |
| **Batch processing in paper executor** | MEDIUM | `Promise.all(batch.map(processOrder))` processes orders concurrently. Two orders for the same option_symbol could race on position lookup. | The `FOR UPDATE SKIP LOCKED` partially mitigates, but `SKIP LOCKED` means one order would simply skip the position, not wait for it. |
| **Bias state fetch outside transaction** | LOW | `getCurrentState()` fetched before the DB transaction in paper-executor. Stale bias data at fill time. | Acceptable — bias data is informational at fill. |
| **Exit orders without matching position** | ✅ HANDLED | `isExitOrder` with no position → order marked 'failed'. Good. | N/A |

### Order Lifecycle

```
pending_execution → filled (via paper executor)
                  → failed (price unavailable, expired, orphan exit)
```

**Missing states**: No `submitted`, `partially_filled`, `canceled`, `expired` (expired is mapped to 'failed'). Adequate for paper trading but needs expansion for live.

### Position Lifecycle

```
open → closing (exit triggered) → closed (paper executor fills exit)
```

**Missing**: No `archived` state. Closed positions remain in the same table forever. Consider archival for query performance.

---

## 7) Observability / Explainability Audit

### What IS Logged

| Decision Point | Logged? | Where | Structured? |
|----------------|---------|-------|-------------|
| Entry decision (BLOCK/WAIT/ENTER) | ✅ | `logAuditEvent()` + logger.info | ✅ Structured with rationale, rules |
| Exit decision | ✅ | `logAuditEvent()` + metrics | ✅ Full tier breakdown |
| Agent decisions (Engine B) | ✅ | `eventLogger.logDecision()` → `agent_decisions` table | ✅ Per-agent + meta |
| Bias decision audit | ✅ | `logger.info('Bias decision audit', { decisionAudit })` | ✅ Modifier breakdown |
| Strike selection | ✅ | Logger with score, rationale | ✅ |
| Same-strike cooldown | ✅ | Logger with optionSymbol, engine, source | ✅ |
| Drawdown circuit breaker | ✅ | Logger with drawdown%, freeze time | ✅ |
| Gamma exposure block | ✅ | Logger with Greeks, reasons | ✅ |

### What IS NOT Logged

| Gap | Severity | Impact |
|-----|----------|--------|
| **Engine A does not call `eventLogger.logDecision()`** | HIGH | Engine A agent outputs are not persisted to `agent_decisions` table. Only Engine B persists them (line 768-774 in engine-invokers.ts). Engine A entry decisions are logged via `logAuditEvent()` but agent-level outputs are not stored. |
| **No unified `decision_trace` per signal** | MEDIUM | Decision data is scattered across logs (structured but not in one queryable record). |
| **Entry decision adapter data loss** | HIGH | `portfolioDelta: 0, portfolioTheta: 0, liquidityState: 'NORMAL'` are hardcoded — audit trail shows misleading "correct" values. |
| **`entryWait` handling opaque** | MEDIUM | When WAIT is returned, the recommendation has `strike: 0, quantity: 0` — what happens downstream is not explicitly logged. |
| **Sizing multiplier cascade not in one log** | MEDIUM | Confluence, gamma, and bias multipliers are logged separately. No single log line shows `baseSize → confluenceAdj → gammaAdj → biasAdj → final`. |

### Recommended `decision_trace` Schema

```typescript
interface DecisionTrace {
  signal_id: string;
  experiment_id: string;
  engine: 'A' | 'B';
  timestamp: number;
  symbol: string;
  direction: 'long' | 'short';

  // Pre-flight
  preflight: {
    mtfBiasAvailable: boolean;
    tradeSuppressed: boolean;
    biasStale: boolean;
    portfolioGuardResult: 'ALLOW' | 'BLOCK' | 'DOWNGRADE';
    drawdownFrozen: boolean;
    gammaExposureAllowed: boolean;
    dteConcentrationAllowed: boolean;
  };

  // Tier results
  tierResults: {
    tier1: { fired: boolean; rules: RuleResult[] };
    tier2: { fired: boolean; rules: RuleResult[] };
    tier3: { fired: boolean; instructions?: EntryInstructions };
  };

  // Sizing
  sizing: {
    base: number;
    confluenceMultiplier: number;
    gammaMultiplier: number;
    biasMultiplier: number;
    final: number;
  };

  // Strike selection
  strike: {
    method: 'simple' | 'advanced';
    strike: number;
    expiration: string;
    optionType: 'call' | 'put';
    entryPrice: number;
    score?: number;
    rationale?: string[];
  };

  // Data timestamps
  dataTimestamps: {
    signalTimestamp: number;
    enrichmentTimestamp: number;
    priceTimestamp: number;
    gexTimestamp: number | null;
    biasTimestamp: number | null;
  };

  // Final outcome
  outcome: 'TRADE' | 'BLOCK' | 'WAIT' | 'ERROR';
  blockReason?: string;
}
```

---

## 8) Test Plan & Audit Harness

### P0: Minimum Required Tests (Must-Have)

| # | Test | Type | File(s) Under Test |
|---|------|------|-------------------|
| 1 | Tier 1: confidence boundary (64/65/66 for SCALP) | Unit | `tier1HardBlocks.ts` |
| 2 | Tier 1: all regime × direction combinations | Unit | `tier1HardBlocks.ts` |
| 3 | Tier 1: daily loss at boundary (-749/-750/-751 vs guardrail -750) | Unit | `tier1HardBlocks.ts` |
| 4 | Tier 1: portfolio delta/theta MUST NOT be hardcoded 0 (regression) | Integration | `entry-decision-adapter.service.ts` |
| 5 | Direction mapping: long→CALL→call, short→PUT→put end-to-end | Integration | `buildEntryDecisionInput`, `selectStrike`, `buildOptionSymbol` |
| 6 | Sizing cap: verify quantity cannot exceed MAX_CONTRACTS under any multiplier combination | Unit | `engine-invokers.ts` |
| 7 | Drawdown circuit breaker checked for Engine A | Integration | `engine-invokers.ts` |
| 8 | Gamma exposure checked for Engine A | Integration | `engine-invokers.ts` |
| 9 | DTE concentration checked for Engine A | Integration | `engine-invokers.ts` |
| 10 | Paper executor idempotency: double-process same order | Integration | `paper-executor.ts` |
| 11 | Position double-close prevention | Integration | `paper-executor.ts` |
| 12 | P&L calculation: LONG positive, LONG negative, SHORT positive, SHORT negative | Unit | `calculate-realized-pnl.ts` |
| 13 | Signal deduplication within 60s window | Integration | `webhook.ts` |
| 14 | Same-strike cooldown: same engine+source blocks, different engine allows | Unit | `same-strike-cooldown.service.ts` |
| 15 | Entry adapter: IV percentile proxy vs real data | Unit | `entry-decision-adapter.service.ts` |

### P1: Expanded Suite

| # | Test | Type |
|---|------|------|
| 16 | Tier 2 timing: verify `minutesFromOpen` logic matches intended session windows | Scenario |
| 17 | Tier 2 GEX: all GEXState × direction combinations | Unit |
| 18 | Tier 3: SCALP LIMIT order, SWING MARKET at confidence>=80 | Unit |
| 19 | Advanced strike selection fallback to simple on failure | Integration |
| 20 | Bias risk multiplier: all macro classes × directions × strategy types | Unit |
| 21 | Bias staleness: block vs reduce_risk behavior | Unit |
| 22 | Portfolio guard: BLOCK/DOWNGRADE/ALLOW paths | Integration |
| 23 | Order expiration: stale orders marked failed | Integration |
| 24 | Max daily trades cap at execution level | Integration |
| 25 | Exit engine Tier 1-4 cascade correctness | Unit |

### P2: Golden Tests & Replay

| # | Test | Scenario |
|---|------|----------|
| 26 | Market open spike: high-vol first-15-min signal | Scenario |
| 27 | Flat chop: NEUTRAL regime, low confidence, should not trade | Scenario |
| 28 | Reversal day: morning BULL → afternoon BEAR | Scenario |
| 29 | Gamma flip: LONG_GAMMA → SHORT_GAMMA mid-day | Scenario |
| 30 | 0DTE danger: SCALP_GUARDED with 0 DTE should have proper sizing | Scenario |
| 31 | Drawdown freeze: cascading losses should halt all engines | Scenario |
| 32 | Historical webhook replay: deterministic decisions from recorded payloads | Replay |
| 33 | Stress: 100 signals in 1 minute, verify no duplicates | Load |

### Audit Harness Plan

```bash
# Run all Engine A audit tests
npm run test:engine-a-audit

# Individual suites
npm run test:unit -- --grep "tier1"
npm run test:unit -- --grep "tier2"
npm run test:unit -- --grep "sizing"
npm run test:unit -- --grep "direction"
npm run test:integration -- --grep "engine-a"
npm run test:scenario -- --grep "golden"
```

---

## 9) Final Findings & Recommendations

### Top 10 Issues by Severity

| # | Severity | Issue | File(s) | Fix Effort |
|---|----------|-------|---------|------------|
| **1** | 🔴 CRITICAL | **Engine A does NOT check drawdown circuit breaker** — can trade through a portfolio freeze | `engine-invokers.ts` lines 61-205 | LOW — add 3 checks from Engine B |
| **2** | 🔴 CRITICAL | **Engine A does NOT check gamma exposure limits** — can exceed portfolio Greeks limits | Same | LOW |
| **3** | 🔴 CRITICAL | **Engine A does NOT check DTE concentration** — can over-concentrate on one expiry | Same | LOW |
| **4** | 🔴 CRITICAL | **Portfolio delta/theta Tier 1 rules are dead code** — adapter hardcodes `portfolioDelta: 0, portfolioTheta: 0` | `entry-decision-adapter.service.ts` lines 95-97 | MEDIUM — query `getPortfolioGreeks()` |
| **5** | 🔴 CRITICAL | **No upper bound on sizing** — multiplier cascade can produce unbounded contract counts. No max-premium or max-notional cap. | `engine-invokers.ts` lines 300-343 | LOW — add `Math.min(quantity, MAX_CONTRACTS)` |
| **6** | 🟡 HIGH | **Liquidity state Tier 1 rule is dead code** — adapter hardcodes `liquidityState: 'NORMAL'` | `entry-decision-adapter.service.ts` line 129 | MEDIUM — derive from enrichment |
| **7** | 🟡 HIGH | **Tier 2 timing rule may have inverted logic** — `minutesFromOpen >= 15` for CLOSE session checks minutes since 9:30am, not minutes until close | `tier2Delays.ts` line 19-20 | LOW — use `minutesUntilClose` |
| **8** | 🟡 HIGH | **Simple strike selection ignores setupType for DTE** — SCALP_GUARDED gets SWING DTE (30-60 days instead of 3-14) | `strike-selection.service.ts` line 28 | LOW — pass setupType |
| **9** | 🟡 HIGH | **Paper executor slippage direction wrong for exits** — always adds to price, but sells should subtract | `paper-executor.ts` line 53 | LOW — make direction-aware |
| **10** | 🟡 MEDIUM | **Engine A does not persist agent decisions** — only Engine B calls `eventLogger.logDecision()` | `engine-invokers.ts` | MEDIUM — add persistence |

### Quick Wins (Low Effort / High Impact)

1. **Add 3 risk checks to Engine A** (drawdown, gamma, DTE concentration) — copy Engine B pattern, ~20 lines of code
2. **Cap sizing**: Add `const quantity = Math.max(1, Math.min(Math.floor(adjustedSize), config.maxPositionSize))` or a dedicated `MAX_CONTRACTS` constant
3. **Fix adapter**: Replace `portfolioDelta: 0, portfolioTheta: 0` with actual `getPortfolioGreeks()` call
4. **Fix adapter**: Replace `liquidityState: 'NORMAL'` with derived liquidity from enrichment

### Medium-Term Refactors

1. **Unify sizing paths**: Order creator and Engine A invoker should use ONE sizing function
2. **Add `decision_trace` table**: Persist the full decision trace per signal for audit
3. **Consolidate risk limits**: `PORTFOLIO_GUARDRAILS` constants vs `config.*` vs `risk_limits` table — THREE sources of truth for the same limits
4. **Add max premium/notional caps**: `quantity × entryPrice × 100 <= maxPremiumPerTrade`
5. **DTE-aware sizing**: 0DTE positions should have reduced base sizing

### Rule Conflicts / Redundant Rules

| Conflict | Details |
|----------|---------|
| **Dual risk gating** | `entryEngineManagesRiskGating` flag creates two mutually exclusive paths. Both enrichment AND entry engine should enforce, not one-or-the-other. |
| **Max positions: 5 vs 8** | `config.maxOpenPositions=5` and `PORTFOLIO_GUARDRAILS.maxOpenTrades=8`. When entry engine manages risk, it uses 8. When enrichment manages, it uses 5. This is confusing and could allow more trades than intended. |
| **Daily loss: -750 vs -1000** | `PORTFOLIO_GUARDRAILS.maxDailyLoss=-750` vs `config.maxDailyLoss=1000`. Different values used depending on which path is active. |

### Hidden Coupling to Engine B

1. **Engine B also calls `evaluateEntryDecision()`** (line 450-497 in engine-invokers.ts) — Engine A's tier rules gate Engine B too
2. **Engine B uses same signal enrichment** service
3. **Engine B uses same bias pre-flight** checks
4. **Engine B has MORE risk checks** than Engine A (drawdown, gamma, DTE) — Engine B is safer than Engine A
5. **Order creator does not distinguish Engine A vs B** for sizing — both paths merge at order creation

---

## Production Readiness Rating

**Rating: 5/10**

### Strengths
- Well-structured tier system with clear separation
- Good idempotency and concurrent safety in workers
- Comprehensive observability (structured logging, Sentry breadcrumbs)
- Direction-aware P&L with explicit position_side
- Fail-closed behavior on DB errors (drawdown, gamma, DTE checks)
- Audit logger for entry/exit decisions

### Weaknesses
- 3 critical risk checks missing from Engine A
- Dead code in Tier 1 rules (delta, theta, liquidity)
- No upper bound on position sizing
- Inconsistent risk limit sources
- No max premium/notional cap

### Capital Readiness Tier

| Tier | Status | Prerequisites |
|------|--------|---------------|
| **Paper only** | ✅ Current state | — |
| **Shadow only** | ⚠️ After fixes 1-5 | Fix missing risk checks, cap sizing, fix dead rules |
| **Tiny allocation** | ⚠️ After fixes 1-8 + tests P0 | All critical fixes + minimum test suite passing |
| **Limited allocation** | ❌ Not yet | Unified sizing, decision trace, consolidated limits |
| **Scalable** | ❌ Not yet | Full test suite, live execution adapter, monitoring dashboard |

---

## Appendix: Files Audited

```
src/orchestrator/engine-invokers.ts
src/orchestrator/orchestrator-service.ts
src/orchestrator/signal-processor.ts
src/orchestrator/engine-coordinator.ts
src/orchestrator/policy-engine.ts
src/lib/entryEngine/evaluator.ts
src/lib/entryEngine/rules/tier1HardBlocks.ts
src/lib/entryEngine/rules/tier2Delays.ts
src/lib/entryEngine/rules/tier3Entry.ts
src/lib/entryEngine/types.ts
src/lib/exitEngine/evaluator.ts
src/lib/shared/constants.ts
src/lib/shared/types.ts
src/lib/shared/setup-type.ts
src/lib/pnl/calculate-realized-pnl.ts
src/services/entry-decision-adapter.service.ts
src/services/signal-enrichment.service.ts
src/services/strike-selection.service.ts
src/services/advanced-strike-selection.service.ts
src/services/drawdown-circuit-breaker.service.ts
src/services/gamma-exposure.service.ts
src/services/dte-concentration.service.ts
src/services/same-strike-cooldown.service.ts
src/services/bias-state-aggregator/risk-model-integration.service.ts
src/services/event-logger.service.ts
src/workers/paper-executor.ts
src/workers/order-creator.ts
src/routes/webhook.ts
```
