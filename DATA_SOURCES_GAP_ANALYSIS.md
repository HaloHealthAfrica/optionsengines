# Data Sources Gap Analysis

**Analysis Date:** February 6, 2026  
**Purpose:** Identify missing functionality and subscription limitations across all data providers

## Provider Comparison Matrix

| Feature | Alpaca | Polygon/Massive | MarketData.app | TwelveData | Status |
|---------|--------|-----------------|----------------|------------|--------|
| **Stock Candles (Historical)** | ✅ | ✅ | ✅ | ✅ | Working |
| **Stock Candles (Intraday)** | ⚠️ SIP Tier | ⚠️ Paid Tier | ✅ | ✅ | Limited |
| **Stock Quotes (Real-time)** | ✅ | ✅ | ✅ | ✅ | Working |
| **Options Quotes** | ✅ | ⚠️ Paid Tier | ❌ | ❌ | Limited |
| **Options Chain** | ❌ | ⚠️ Paid Tier | ✅ | ❌ | Partial |
| **Options Flow** | ❌ | ❌ | ✅ | ❌ | Partial |
| **Options Greeks** | ❌ | ⚠️ Paid Tier | ✅ | ❌ | Partial |
| **Market Hours/Clock** | ⚠️ Wrong URL | ✅ | ✅ Local | ✅ Local | Broken |
| **WebSocket (Stocks)** | ❌ | ✅ | ❌ | ❌ | Missing |
| **WebSocket (Options)** | ❌ | ✅ | ❌ | ❌ | Missing |
| **Rate Limiting** | ✅ | ❌ | ✅ (shared) | ✅ | Partial |

**Legend:**
- ✅ = Fully implemented and working
- ⚠️ = Implemented but has issues/limitations
- ❌ = Not implemented or not supported

---

## 1. Alpaca Client

### ✅ What's Working
- Stock candles (historical)
- Stock quotes (bid/ask/mid)
- Options quotes (bid/ask/mid)
- Authentication

### ❌ Critical Issues

#### 1.1 Clock Endpoint (404 Error)
**Current Code:**
```typescript
const endpoint = '/v2/clock';
```

**Error:**
```
Alpaca API error: 404 Not Found - {"message": "endpoint not found."}
```

**Root Cause:** Using wrong base URL for clock endpoint

**Fix Required:**
```typescript
// Clock endpoint should use trading API, not data API
private readonly tradingUrl: string;

constructor() {
  this.dataUrl = 'https://data.alpaca.markets';
  this.tradingUrl = config.alpacaPaper
    ? 'https://paper-api.alpaca.markets'
    : 'https://api.alpaca.markets';
}

async isMarketOpen(): Promise<boolean> {
  // Use trading URL for clock
  const url = `${this.tradingUrl}/v2/clock`;
  // ... rest of implementation
}
```

#### 1.2 SIP Data Access (403 Error)
**Error:**
```
subscription does not permit querying recent SIP data
```

**Impact:** Cannot fetch recent intraday candles  
**Cause:** Free/Paper tier limitation  
**Workaround:** System falls back to MarketData.app successfully

### ❌ Missing Features

1. **Options Chain Data**
   - No endpoint to get full options chain
   - Can only get individual option quotes
   - Impact: Cannot calculate max pain, GEX levels

2. **Options Greeks**
   - No gamma, delta, theta, vega data
   - Impact: Cannot do advanced options analysis

3. **WebSocket Support**
   - No real-time streaming implemented
   - Alpaca has WebSocket API but not integrated
   - Impact: Polling only, higher latency

4. **Options Flow**
   - No unusual options activity data
   - Impact: Missing sentiment indicator

---

## 2. Polygon/Massive.com Client

### ✅ What's Working
- Stock candles (historical)
- Stock quotes
- Market status check
- Option symbol formatting

### ❌ Critical Issues

#### 2.1 Subscription Limitations (403 Errors)

**Options Data:**
```
NOT_AUTHORIZED - You are not entitled to this data
Endpoint: /v2/snapshot/locale/us/markets/stocks/tickers/O:QQQ260212P00420000
```

**Intraday Timeframes:**
```
Your plan doesn't include this data timeframe
Endpoint: /v2/aggs/ticker/SPY/range/5/minute/...
```

**Impact:** Free tier doesn't support:
- Options data
- Minute-level candles
- Real-time data

#### 2.2 Rate Limiter Not Initialized
**Error:**
```
[ERROR] Rate limiter not found for provider: polygon
```

**Fix Required:**
```typescript
// In rate-limiter.service.ts
this.limiters.set('polygon', new RateLimiter({
  tokensPerInterval: 5,  // Free tier: 5 requests/minute
  interval: 60000,
}));
```

### ✅ What's Working Well
- API structure is correct
- Endpoints are valid
- Error handling is good
- Circuit breaker working

### ❌ Missing Features

1. **WebSocket Integration**
   - Client exists (`polygon-websocket-client.ts`) but not used
   - Not integrated with market-data service
   - Impact: No real-time streaming

2. **Options Chain**
   - No endpoint for full chain
   - Can only get individual option snapshots

3. **Options Flow**
   - Not available in Polygon/Massive API

---

## 3. MarketData.app Client

### ✅ What's Working
- Stock candles (all timeframes) ✅
- Stock quotes ✅
- Options chain data ✅
- Options flow data ✅
- Options Greeks (gamma) ✅
- GEX calculations ✅

### ⚠️ Limitations

#### 3.1 Options Pricing
**Current Code:**
```typescript
async getOptionPrice(...): Promise<number> {
  throw new Error('Option pricing not supported by MarketData.app free tier');
}
```

**Impact:** Cannot get individual option quotes  
**Workaround:** Use Alpaca for option pricing

#### 3.2 Market Hours (Local Calculation)
```typescript
async isMarketOpen(): Promise<boolean> {
  // Uses local timezone calculation
  // Not as reliable as API-based check
}
```

**Impact:** May be inaccurate during DST transitions or holidays

### ✅ Strengths
- **Best for options data** (chain, flow, Greeks)
- **Working reliably** in production
- **Good fallback provider**
- **Comprehensive options coverage**

### ❌ Missing Features

1. **WebSocket Support**
   - No real-time streaming
   - Polling only

2. **Individual Option Quotes**
   - Can get chain but not single option price
   - Must use Alpaca/Polygon for this

---

## 4. TwelveData Client

### ✅ What's Working
- Stock candles (historical)
- Stock quotes
- Basic market hours check

### ❌ Limitations

#### 4.1 Options Not Supported
```typescript
async getOptionPrice(...): Promise<number> {
  throw new Error('Option pricing not supported by TwelveData free tier');
}
```

**Impact:** Cannot use for options trading

#### 4.2 Limited Use Case
- Primarily used as last-resort fallback
- Good for stock data only
- Not suitable for options strategies

### ✅ Strengths
- Reliable for stock data
- Good API rate limits (800/day)
- Simple to use

---

## 5. WebSocket Clients

### ✅ Implemented
- `polygon-websocket-client.ts` exists
- Supports stocks and options
- Has authentication, subscriptions, reconnection logic

### ❌ Not Integrated
```typescript
// WebSocket client exists but is NOT used by market-data service
// No real-time streaming in production
```

**Impact:**
- All data fetched via polling
- Higher latency
- More API calls
- Cannot react to real-time events

**Integration Needed:**
1. Connect WebSocket client on startup
2. Subscribe to active symbols
3. Update cache with real-time data
4. Emit events for price changes
5. Use for exit monitoring

---

## Critical Gaps Summary

### 🔴 Priority 1: Blocking Issues

1. **Alpaca Clock Endpoint (404)**
   - **Impact:** Cannot check market hours
   - **Fix:** Use trading API URL instead of data API URL
   - **Effort:** 5 minutes

2. **Polygon Rate Limiter Missing**
   - **Impact:** No rate limiting, potential API bans
   - **Fix:** Initialize rate limiter in service
   - **Effort:** 5 minutes

### 🟡 Priority 2: Subscription Limitations

3. **Alpaca SIP Data (403)**
   - **Impact:** Cannot get recent intraday data
   - **Options:**
     - Upgrade to paid tier ($99/mo for unlimited)
     - Continue using MarketData.app fallback (working)
   - **Decision:** Keep fallback for now

4. **Polygon Options/Intraday (403)**
   - **Impact:** Cannot use Polygon for options or minute data
   - **Options:**
     - Upgrade to Starter plan ($199/mo)
     - Continue using MarketData.app (working)
   - **Decision:** Keep fallback for now

### 🟢 Priority 3: Missing Features

5. **WebSocket Integration**
   - **Impact:** No real-time data, higher latency
   - **Benefit:** Lower API usage, faster reactions
   - **Effort:** 2-4 hours
   - **Value:** High for production trading

6. **Options Chain from Alpaca**
   - **Impact:** Cannot get full chain from Alpaca
   - **Workaround:** Using MarketData.app (working)
   - **Effort:** Not worth it, MarketData.app is better

7. **Options Greeks from Alpaca/Polygon**
   - **Impact:** Cannot get Greeks from primary providers
   - **Workaround:** Using MarketData.app (working)
   - **Effort:** Not worth it, MarketData.app is better

---

## Recommended Actions

### Immediate (Today)

1. ✅ **Fix Alpaca Clock Endpoint**
   ```typescript
   // Use trading API for clock, not data API
   private readonly tradingUrl = config.alpacaPaper
     ? 'https://paper-api.alpaca.markets'
     : 'https://api.alpaca.markets';
   ```

2. ✅ **Initialize Polygon Rate Limiter**
   ```typescript
   this.limiters.set('polygon', new RateLimiter({
     tokensPerInterval: 5,
     interval: 60000,
   }));
   ```

### Short-term (This Week)

3. **Integrate WebSocket for Real-time Data**
   - Connect Polygon WebSocket on startup
   - Subscribe to active positions
   - Update cache with real-time prices
   - Use for exit monitoring

4. **Document Provider Strategy**
   - Primary: Alpaca (stock quotes, option quotes)
   - Secondary: MarketData.app (options chain, GEX, flow)
   - Tertiary: Polygon (if upgraded)
   - Fallback: TwelveData (stock data only)

### Long-term (Future)

5. **Evaluate Subscription Upgrades**
   - **Alpaca Unlimited:** $99/mo for SIP data
   - **Polygon Starter:** $199/mo for options + intraday
   - **Decision:** Wait until revenue justifies cost

6. **Build Options Chain Cache**
   - Cache full options chains
   - Refresh every 5-10 minutes
   - Reduce API calls for GEX calculations

---

## Current Provider Strategy (Working)

```
Stock Candles:
  1. Try Alpaca (fails on recent data)
  2. Try Polygon (fails on free tier)
  3. Use MarketData.app ✅ (working)
  4. Fallback to TwelveData

Stock Quotes:
  1. Use Alpaca ✅ (working)
  2. Fallback to others

Option Quotes:
  1. Use Alpaca ✅ (working)
  2. Try Polygon (fails on free tier)
  3. No other options

Options Chain/GEX:
  1. Use MarketData.app ✅ (working)
  2. No alternatives

Market Hours:
  1. Try Alpaca (currently broken - 404)
  2. Use TwelveData local calc ✅ (working)
```

---

## Testing Checklist

- [ ] Fix Alpaca clock endpoint
- [ ] Initialize Polygon rate limiter
- [ ] Test market hours check
- [ ] Verify all providers in fallback chain
- [ ] Test options pricing from Alpaca
- [ ] Test options chain from MarketData.app
- [ ] Test GEX calculations
- [ ] Monitor circuit breakers
- [ ] Check rate limiter stats
- [ ] Verify cache hit rates

---

## Conclusion

**Overall Status:** 🟢 System is functional with workarounds

**Key Findings:**
1. MarketData.app is the MVP - provides options data that others don't
2. Alpaca clock endpoint needs immediate fix
3. Polygon rate limiter needs initialization
4. WebSocket integration would significantly improve performance
5. Current fallback strategy is working well

**No Blockers:** All critical functionality has working fallbacks
