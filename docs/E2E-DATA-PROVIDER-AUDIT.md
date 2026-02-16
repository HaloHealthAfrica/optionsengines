# E2E Data Provider Incorporation Audit

**Date**: 2026-02-15  
**Scope**: Code-level audit of market data provider integration across the end-to-end trading pipeline  
**Providers**: Alpaca, Polygon, MarketData.app, TwelveData, UnusualWhales (gamma/flow)

---

## SECTION 1 — Provider Usage Mapping Table

| Pipeline Stage | File | Function | Provider | Data Requested | Blocking? | Fallback? | Notes |
| -------------- | ---- | -------- | -------- | -------------- | --------- | --------- | ----- |
| Webhook Ingestion | `src/routes/webhook.ts` | `processWebhookPayload` | **None** | — | No | — | Receives from TradingView only |
| Signal Normalization | `src/routes/webhook.ts` | `normalizeDirection`, `normalizeTimeframe`, `normalizeTimestamp` | **None** | — | No | — | Inline transforms |
| Signal Enrichment | `src/services/signal-enrichment.service.ts` | `buildSignalEnrichment` | TwelveData, MarketData, Polygon | Stock price, candles, indicators | Yes (8s timeout) | Yes (provider rotation) | Rejects on `market_data_unavailable` if non-test |
| Signal Enrichment | `src/services/signal-enrichment.service.ts` | `buildSignalEnrichment` | Alpaca | Market hours (queueUntil) | No | Yes (TwelveData) | Only when market closed |
| Signal Enrichment | `src/services/signal-enrichment.service.ts` | `buildSignalEnrichment` | MarketData, UnusualWhales | GEX via positioningService | No (8s timeout) | Yes (neutral fallback) | GEX/flow optional; confluence gate can reject |
| Signal Enrichment | `src/services/signal-enrichment.service.ts` | `buildSignalEnrichment` | UnusualWhales, MarketData | Options flow via positioningService | No | Yes (empty summary) | Flow optional; confluence gate uses it |
| Orchestrator | `src/orchestrator/orchestrator-service.ts` | `processSignal` | — | — | No | — | Delegates to buildSignalEnrichment, engines |
| Engine A / Engine B | `src/orchestrator/engine-invokers.ts` | `buildRecommendation`, `buildEngineBRecommendation` | TwelveData, MarketData, Polygon | Candles, stock price, indicators | Yes | Yes (provider rotation) | Engine B fetches candles/indicators again |
| Engine A / Engine B | `src/orchestrator/engine-invokers.ts` | `buildRecommendation`, `buildEngineBRecommendation` | Alpaca | Market hours | Yes | Yes (TwelveData) | `getMarketHours()` — Alpaca primary |
| Strike Selection (simple) | `src/services/strike-selection.service.ts` | `selectStrike` | TwelveData, MarketData, Polygon | Stock price | Yes | Yes (provider rotation) | Throws on failure |
| Strike Selection (advanced) | `src/services/advanced-strike-selection.service.ts` | `advancedStrikeSelect` | TwelveData, MarketData, Polygon | Stock price | Yes | Yes | Returns null on failure → simple fallback |
| Strike Selection (advanced) | `src/services/advanced-strike-selection.service.ts` | `advancedStrikeSelect` | UnusualWhales, MarketData | Option chain | Yes | Yes (MarketData fallback) | UW primary when options enabled |
| Entry Plan | `src/services/entry-exit-agent.service.ts` | `buildEntryExitPlan` | UnusualWhales, Alpaca, Polygon | Option price | Yes | No | Throws on null |
| Order Creation | `src/workers/order-creator.ts` | `run` | TwelveData, MarketData, Polygon | Stock price | Yes | No | Throws → order creation fails |
| Paper Execution | `src/workers/paper-executor.ts` | `fetchOptionPrice` | UnusualWhales, Alpaca, Polygon | Option price | Yes | Test-only (entry_price) | Returns null → order marked failed |
| Position Creation | — | — | — | — | — | — | Uses fill price from paper executor |
| Position Refresher | `src/workers/position-refresher.ts` | `run` | UnusualWhales, Alpaca, Polygon | Option price | No | No | Skips position if null; no throw |
| Exit Monitor | `src/workers/exit-monitor.ts` | `run` | UnusualWhales, Alpaca, Polygon | Option price, stock price | No | No | Skips position if option price null |
| Performance Capture | `src/services/performance-feedback/index.js` | — | **None** | — | No | — | Uses DB data only |
| Dashboard / Flow | `src/routes/flow.ts`, `src/routes/positioning.ts` | Various | MarketData, UnusualWhales | GEX, options flow, stock price | No | Yes (neutral/empty) | Non-blocking for trading |
| Realtime Price (optional) | `src/services/market-data.ts` | `getStockPrice` | Polygon WebSocket | Live quote | No | Yes (REST fallback) | When `POLYGON_WS_ENABLED=true` |

---

## SECTION 2 — Per-Provider Deep Dive

### Alpaca

| Question | Answer |
| -------- | ------ |
| **File(s) where called** | `src/services/market-data.ts`, `src/services/providers/alpaca-client.ts` |
| **Function(s)** | `getCandles`, `getLatestQuote`, `getOptionPrice`, `isMarketOpen`, `getMarketHours` |
| **Underlying last price** | Disabled for stock price: `throw new Error('Alpaca disabled - use twelvedata, marketdata, or unusualwhales')` in `getStockPrice` switch |
| **Option chain** | No — Alpaca does not provide chain; used for option price only |
| **Paper fill price** | Yes — `getOptionPrice` (UW → Alpaca → Polygon order) |
| **Order placement (future live)** | Not implemented; paper only |
| **Synchronous?** | Yes — all calls are `await` |
| **On timeout** | Retry (max 2) if TRANSIENT; then circuit breaker; then next provider |
| **On 404** | Not retried (providerAware); circuit breaker records failure |
| **On 500** | Retried; then circuit breaker; then next provider |
| **Fallback exists?** | Yes — for candles/price: TwelveData, MarketData. For option price: Polygon. For market hours: TwelveData (returns `false` on error) |
| **Failure blocks order creation?** | Option price: Yes (paper executor marks order failed). Stock price in order-creator: Yes (throws). Market hours: No (returns false) |

### Polygon

| Question | Answer |
| -------- | ------ |
| **Used for** | Candles, stock quote, option price; WebSocket for real-time quote when enabled |
| **Intraday candles** | Yes — `getCandles` |
| **Historical bars** | Yes — same endpoint |
| **Option chain** | No — Polygon client has `getOptionPrice` only, not chain |
| **Greeks** | No — option price is bid/ask mid |
| **Required for strike selection?** | No — strike selection uses `marketData.getStockPrice` (TwelveData/MarketData priority) and `marketData.getOptionsChain` (MarketData/UW). Polygon is in fallback chain for both |
| **If it fails** | Circuit breaker opens; next provider tried; if all fail: candles/price throw, option price returns null |

### MarketData.app

| Question | Answer |
| -------- | ------ |
| **Used for** | Candles, stock quote, option chain, options flow, GEX (via chain + price) |
| **Option chain** | Yes — `getOptionsChain`; fallback when UnusualWhales options enabled (UW primary) |
| **Options flow** | Yes — `getOptionsFlow`; fallback when UnusualWhales fails |
| **On 404 `{"s":"no_data"}`** | Handled in `marketdata-client.ts` lines 68–76: returns `{ s: 'no_data', data: [], options: [] }`; callers treat as empty array |
| **Retry?** | Yes — `retry()` with max 2 retries, providerAware (no retry on 404) |
| **Fallback to Polygon?** | No — option chain fallback is UnusualWhales. Candles/price fallback is TwelveData, Polygon (provider priority) |

### TwelveData

| Question | Answer |
| -------- | ------ |
| **Used for** | Candles, stock quote, market hours (fallback) |
| **Real-time bars** | No — REST `time_series` and `quote` only |
| **WebSocket streaming** | No — TwelveData has no WebSocket in this codebase. Real-time uses Polygon WebSocket |
| **Exit price updates** | No — exit monitor uses `marketData.getOptionPrice` and `marketData.getStockPrice`; option price comes from UW/Alpaca/Polygon; stock price from provider priority (TwelveData, MarketData) |
| **Exit monitoring break if disconnect?** | N/A — TwelveData is REST; no persistent connection. Each call is independent |
| **Polling fallback?** | N/A — no WebSocket for TwelveData. Polling is the only mode |

### UnusualWhales

| Question | Answer |
| -------- | ------ |
| **Used for** | Gamma exposure (via `unusualWhalesGammaProvider`), options flow, option chain (fallback), option price |
| **Gamma exposure** | Yes — `positioningService.getGexSnapshot` → `fetchGexFromExternalAPI` → `tryUnusualWhalesGex` when `ENABLE_DEALER_UW_GAMMA=true` or when MarketData GEX is all zeros |
| **Dealer positioning** | Yes — derived from gamma (long_gamma/short_gamma/neutral) |
| **Flow** | Yes — primary for `getOptionsFlow`; fallback is MarketData |
| **Required for trade approval?** | No — GEX/flow are additive. Confluence gate can reject if `enableConfluenceGate` and score below threshold, but flow can be empty (returns empty summary) |
| **Additive scoring only?** | Yes — confluence uses GEX + flow; if both missing, confluence is null and gate may not apply (or rejects if `tradeGatePasses` false) |
| **If unavailable** | GEX: neutral fallback or stale cache. Flow: empty summary. Option chain: throws if MarketData also fails. Option price: returns null, next provider tried |

---

## SECTION 3 — Fallback & Circuit Logic

### Per-Provider Call Summary

| Call Site | Try/Catch | Provider Rotation | Circuit Breaker | Error Logged | Re-thrown | Fallback Deterministic |
| --------- | --------- | ----------------- | --------------- | ------------ | --------- | ----------------------- |
| `getCandles` | Yes (loop) | Yes (priority order) | Yes | Yes | Yes (after all fail) | Yes |
| `getStockPrice` | Yes (loop) | Yes | Yes | Yes | Yes | Yes |
| `getOptionPrice` | Yes (loop) | Yes (UW→Alpaca→Polygon) | Yes | Yes | No (returns null) | Yes |
| `getOptionsChain` | Yes | MarketData → UnusualWhales | Yes | Yes | Yes | Yes |
| `getGex` | Yes | MarketData only (UW via positioning) | Yes | Yes | Yes | No (throws) |
| `getOptionsFlow` | Yes | UW → MarketData | Yes | Yes | No (empty summary) | Yes |
| `isMarketOpen` | Yes | Alpaca → TwelveData | Yes | Yes | No (returns false) | Yes |
| `getMarketHours` | Yes | Alpaca only | No rotation | Yes | No (returns `{ isMarketOpen: false }`) | No |

### Explicit Fallback Chains

```
Stock price / Candles:
  TwelveData → MarketData → (Polygon, Alpaca in priority; Alpaca disabled for price)
  Primary: twelvedata, marketdata (config.marketDataProviderPriority)

Option price:
  UnusualWhales (if enabled) → Alpaca → Polygon
  No fallback to MarketData or TwelveData (they don't support options)

Option chain:
  UnusualWhales (primary when options enabled) → MarketData
  No fallback to Polygon or Alpaca (no chain endpoint)

GEX:
  MarketData (compute from chain) OR UnusualWhales (ENABLE_DEALER_UW_GAMMA)
  positioningService: MarketData → UW when zeros; or UW primary when config

Options flow:
  UnusualWhales → MarketData
  If both fail: empty summary (not thrown)

Market hours:
  Alpaca → TwelveData (isMarketOpen only)
  getMarketHours: Alpaca only, no fallback
```

### Circuit Breaker

- **Location**: `src/services/circuit-breaker.service.ts` (referenced in market-data.ts)
- **Config**: maxFailures=5, resetTimeout=60s
- **Behavior**: Opens after 5 failures; blocks requests until reset
- **Per-provider**: Yes — each provider has its own breaker

---

## SECTION 4 — Latency & Blocking Analysis

| Stage | Sync in Orchestrator? | Blocks Strike Selection? | Blocks Paper Execution? | Blocks Exit Monitor? | Worst-Case Latency | Can Slowness Delay Fills? | Event vs Polling |
| ----- | --------------------- | ------------------------ | ----------------------- | -------------------- | ------------------ | ------------------------- | ---------------- |
| Enrichment | Yes | — | — | — | 8s × 6 calls (price, candles, indicators, GEX, flow, market hours) | No (enrichment before engines) | Polling (worker) |
| Strike selection | Yes | Yes (await getStockPrice, getOptionsChain) | — | — | ~2–4s (2 parallel + chain) | Yes (blocks recommendation) | Sync |
| Order creation | Yes | — | — | — | ~1–2s (getStockPrice) | Yes (blocks order insert) | Polling |
| Paper execution | Yes | — | Yes (await getOptionPrice) | — | ~2–6s (3 providers × retries) | Yes (blocks fill) | Polling |
| Position refresh | Yes | — | — | — | ~1–3s per position | No (skip if null) | Polling |
| Exit monitor | Yes | — | — | Yes (await both prices) | ~2–6s per position | Yes (delays exit decision) | Polling |

- **Enrichment timeout**: 8s per call (`ENRICHMENT_CALL_TIMEOUT_MS`)
- **Orchestrator timeout**: 30s default for full signal processing
- **Provider retries**: 2 with exponential backoff
- **Stock price**: Polygon WebSocket can avoid REST latency when enabled and subscribed

---

## SECTION 5 — Data Integrity Risk Analysis

| Risk | Scenario | Impact | Evidence |
| ---- | -------- | ------ | -------- |
| Null underlying price | `getStockPrice` throws after all providers fail | **High** | Order creator throws → no order. Enrichment rejects with `market_data_unavailable` |
| Stale candle data for exit | Exit monitor uses `getOptionPrice`/`getStockPrice`; cache TTL 30s | **Medium** | Position refresher/exit use live fetch; cache can serve stale within TTL |
| Greeks unavailable but trade proceeds | Option chain from UW has no gamma; `adaptOptionChain` uses BS approximation | **Low** | Advanced strike uses approximated Greeks; trade proceeds |
| Entry from Provider A, exit from Provider B | Option price: UW→Alpaca→Polygon; each call independent | **Medium** | Different providers can return different prices; no consistency guarantee |
| Fallback mid-session causing pricing inconsistency | Provider A fails, B used for next call | **Medium** | Same symbol/contract could be priced by different providers across entry/exit |
| Gamma exposure missing but trade approved | GEX fails → neutral fallback; confluence gate needs both GEX and flow | **Low** | If `confluence` is null (gex or flow missing), `enableConfluenceGate` may not apply; trade can proceed |
| Empty option chain | MarketData 404 no_data + UW fail → throw | **High** | Advanced strike returns null → simple fallback; simple strike uses price only (no chain) |
| Order creator price fetch fails | `getStockPrice` throws | **High** | Order not created; signal stays approved |

---

## SECTION 6 — Provider Dependency Flow Map

```
Webhook Ingestion          [Provider-independent]
    ↓
Signal Normalization       [Provider-independent]
    ↓
Signal Enrichment          [Provider-critical: price, candles]
    │                      [Provider-additive: GEX, flow]
    │                      Providers: TwelveData, MarketData, Polygon, Alpaca (hours), UW (GEX/flow)
    ↓
Orchestrator               [Provider-independent]
    ↓
Engine A / B               [Provider-critical: strike selection, entry plan]
    │                      Providers: TwelveData, MarketData, Polygon (price, candles, chain)
    │                      Alpaca (market hours), UW (option price, chain fallback)
    ↓
Strike Selection           [Provider-critical]
    │                      MarketData → UW (chain); TwelveData/MarketData/Polygon (price)
    ↓
Order Creation             [Provider-critical]
    │                      TwelveData, MarketData, Polygon (stock price)
    ↓
Paper Execution            [Provider-critical]
    │                      UW, Alpaca, Polygon (option price)
    ↓
Position Creation          [Provider-independent]
    ↓
Position Refresher         [Provider-additive]
    │                      UW, Alpaca, Polygon (option price) — skips if null
    ↓
Exit Monitor               [Provider-critical for exit decision]
    │                      UW, Alpaca, Polygon (option + stock price)
    ↓
Performance Capture        [Provider-independent]
    ↓
Dashboard Rendering        [Provider-additive]
                           GEX, flow, price — neutral/empty on failure
```

---

## SECTION 7 — Criticality Classification

| Provider | Critical | Important | Additive | Failure Impact |
| -------- | -------- | --------- | -------- | -------------- |
| **Alpaca** | Option price (paper fill), market hours | — | — | Option price: order fails. Market hours: defaults to closed |
| **Polygon** | Option price (fallback), stock price (fallback) | Candles | WebSocket price (optional) | In fallback chain; all-provider failure blocks |
| **MarketData.app** | Option chain (GEX, advanced strike), stock price | Candles, options flow | — | Chain failure blocks advanced strike; GEX throws |
| **TwelveData** | Stock price, candles | Market hours fallback | — | Primary for price/candles; failure cascades to next |
| **UnusualWhales** | Option price (when Alpaca/Polygon fail) | Options flow, GEX, option chain fallback | Gamma strategy | Additive for flow/GEX; critical for option price in UW-first config |

---

## SECTION 8 — Failure Simulations

### 1. Alpaca Timeout

| Question | Result |
| -------- | ------ |
| Trade proceeds? | Yes — option price falls back to Polygon. Stock price does not use Alpaca. Market hours fall back to TwelveData |
| Trade rejects? | No |
| System crash? | No |
| Error logged? | Yes — `logger.warn`, Sentry |
| Fallback triggered? | Yes — for option price (Polygon), market hours (TwelveData) |

### 2. MarketData 404

| Question | Result |
| -------- | ------ |
| Trade proceeds? | Option chain: 404 `no_data` returns `[]`; `getOptionsChain` normalizes to empty. If UW fallback has data, yes. If both fail, advanced strike returns null → simple strike used |
| Trade rejects? | If chain required and both fail: advanced strike null, simple strike may succeed with price only |
| System crash? | No |
| Error logged? | Yes |
| Fallback triggered? | Yes — UnusualWhales for chain. For candles/price: next provider in priority |

### 3. Polygon Null Chain

| Question | Result |
| -------- | ------ |
| Trade proceeds? | Polygon does not provide option chain. Chain comes from MarketData/UW. N/A |
| If Polygon returns null for option price? | Yes — `getOptionPrice` tries next provider (Alpaca). If all null, order fails |

### 4. TwelveData WebSocket Disconnect

| Question | Result |
| -------- | ------ |
| Trade proceeds? | TwelveData has no WebSocket in this codebase. Real-time uses Polygon WebSocket. N/A |
| If TwelveData REST fails? | Yes — MarketData, then Polygon tried. Trade proceeds if one succeeds |

### 5. UnusualWhales API Down

| Question | Result |
| -------- | ------ |
| Trade proceeds? | Option price: Alpaca, Polygon tried. Flow: MarketData fallback. GEX: MarketData or neutral. Chain fallback: MarketData primary |
| Trade rejects? | Only if option price from all (UW, Alpaca, Polygon) fails |
| System crash? | No |
| Error logged? | Yes |
| Fallback triggered? | Yes — for flow (MarketData), option price (Alpaca, Polygon), chain (MarketData primary) |

---

## FINAL VERDICT

### Summary

1. **Provider usage is well-structured** with circuit breakers, retries, and fallback chains for stock price, candles, option price, and option chain.
2. **Critical path dependencies**: Stock price and option price are blocking; failures cause order creation or paper execution to fail.
3. **GEX and flow are additive**; the system can proceed with neutral/empty data, though confluence gate may reject when enabled.
4. **Entry vs exit pricing**: Both use the same `marketData` service; provider selection is per-request, so entry and exit can come from different providers.
5. **No provider-specific timeouts** at the client level; enrichment has 8s per-call timeout; orchestrator has 30s overall.
6. **Alpaca is disabled for stock price**; option price and market hours still use it.
7. **TwelveData has no WebSocket**; real-time streaming uses Polygon WebSocket when enabled.
8. **MarketData 404 `no_data`** is handled as empty; no retry.
9. **Stale data can propagate** via cache (30s price, 60s chain, 300s GEX); position refresher and exit monitor fetch on each run.

### Recommendations (for future work, not implemented)

- Add explicit timeout to provider HTTP calls.
- Consider storing which provider supplied entry price for exit consistency.
- Document provider priority in runbooks for ops.

---

*Audit completed via code trace. All file and function references verified.*
