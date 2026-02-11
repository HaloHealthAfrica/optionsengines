# Prompt: Fix MarketData Endpoints

## Context

The market data endpoints (`/positioning/gex`, `/positioning/options-flow`, `/positioning/max-pain`) are returning 502 Bad Gateway errors with timeouts of 6-12 seconds. These endpoints require authentication and fetch data from external market data providers (Alpaca, Polygon, MarketData.app, TwelveData).

## Current Status

**Working:**
- Authentication system (JWT tokens)
- Webhook processing
- Database connectivity
- User management

**Failing:**
- `/positioning/gex?symbol=SPY` - 502 error, 6955ms timeout
- `/positioning/options-flow?symbol=SPY&limit=10` - 502 error, 12484ms timeout
- `/positioning/max-pain?symbol=SPY` - 502 error, 9137ms timeout
- `/positioning/signal-correlation?symbol=SPY` - 502 error, 8537ms timeout

## Problem

The endpoints are timing out when trying to fetch data from external market data providers. This could be due to:
1. Missing or invalid API keys
2. Circuit breakers in open state
3. Network connectivity issues
4. Provider rate limits exceeded
5. Slow API responses from providers

## Files to Investigate

1. `src/services/market-data.ts` - Main market data service with circuit breakers
2. `src/services/providers/alpaca-client.ts` - Alpaca API client
3. `src/services/providers/marketdata-client.ts` - MarketData.app client
4. `src/services/providers/polygon-client.ts` - Polygon API client
5. `src/services/providers/twelvedata-client.ts` - TwelveData API client
6. `src/services/positioning.service.ts` - Positioning service that uses market data
7. `src/routes/positioning.ts` - API routes for positioning endpoints
8. `src/config/index.ts` - Configuration and environment variables

## Tasks

### 1. Diagnose the Issue

- [ ] Check if API keys are properly loaded from environment variables
- [ ] Add detailed logging to identify which provider is failing
- [ ] Check circuit breaker status for each provider
- [ ] Verify timeout configurations
- [ ] Test each provider client individually
- [ ] Check if the issue is specific to certain symbols or all symbols

### 2. Add Better Error Handling

- [ ] Add timeout handling with configurable limits
- [ ] Improve error messages to show which provider failed
- [ ] Add fallback responses when all providers fail
- [ ] Log detailed error information for debugging
- [ ] Return partial data if some providers succeed

### 3. Implement Quick Fixes

- [ ] Add request timeouts (e.g., 5 seconds per provider)
- [ ] Implement graceful degradation (return cached/mock data on failure)
- [ ] Add health check endpoint for data providers
- [ ] Reset circuit breakers if stuck in open state
- [ ] Add retry logic with exponential backoff

### 4. Test the Fixes

- [ ] Test with valid API keys
- [ ] Test with invalid/missing API keys
- [ ] Test during market hours and after hours
- [ ] Test with different symbols (SPY, QQQ, AAPL, etc.)
- [ ] Verify circuit breakers work correctly
- [ ] Check response times are acceptable (<2 seconds)

## Expected Behavior

After fixes, the endpoints should:
1. Respond within 2-5 seconds maximum
2. Return proper error messages if providers fail
3. Use fallback providers automatically
4. Cache results to reduce API calls
5. Return 503 (Service Unavailable) instead of 502 if all providers fail
6. Log detailed information for debugging

## Test Commands

### Test Authentication
```bash
curl -X POST https://optionsengines.fly.dev/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@optionagents.ai","password":"TestPassword123!"}'
```

### Test GEX Endpoint (with token)
```bash
TOKEN="your-jwt-token"
curl -H "Authorization: Bearer $TOKEN" \
  "https://optionsengines.fly.dev/positioning/gex?symbol=SPY"
```

### Test Options Flow
```bash
TOKEN="your-jwt-token"
curl -H "Authorization: Bearer $TOKEN" \
  "https://optionsengines.fly.dev/positioning/options-flow?symbol=SPY&limit=10"
```

### Test Max Pain
```bash
TOKEN="your-jwt-token"
curl -H "Authorization: Bearer $TOKEN" \
  "https://optionsengines.fly.dev/positioning/max-pain?symbol=SPY"
```

### Run Automated Tests
```bash
TEST_EMAIL="test@optionagents.ai" TEST_PASSWORD="TestPassword123!" node test-data-sources-auth.js
```

## Environment Variables to Check

```bash
# Check if these are set in Fly.io
fly ssh console -a optionsengines -C "printenv | grep -E '(ALPACA|POLYGON|MARKET_DATA|TWELVE)'"
```

Required variables:
- `ALPACA_API_KEY`
- `ALPACA_SECRET_KEY`
- `MARKET_DATA_API_KEY` (for MarketData.app)
- `TWELVE_DATA_API_KEY` (optional backup)
- `POLYGON_API_KEY` (optional backup)

## Success Criteria

- [ ] All positioning endpoints respond within 5 seconds
- [ ] Endpoints return valid data or clear error messages
- [ ] Circuit breakers work correctly
- [ ] Fallback providers are used when primary fails
- [ ] Proper HTTP status codes (200, 503, etc.)
- [ ] Detailed logs for debugging
- [ ] Tests pass consistently

## Additional Context

- The system uses a circuit breaker pattern with 5 max failures and 60-second reset
- Provider priority: Alpaca → Polygon → MarketData.app → TwelveData
- The application is deployed on Fly.io in the IAD region
- Database and authentication are working correctly
- Webhook processing is fully functional

## Debugging Steps

1. Check Fly.io logs:
```bash
fly logs -a optionsengines | grep -i "market data\|circuit\|timeout\|error"
```

2. Check circuit breaker status (add endpoint if needed):
```bash
curl https://optionsengines.fly.dev/api/health/circuit-breakers
```

3. Test individual provider clients:
```bash
fly ssh console -a optionsengines
node -e "require('./dist/services/providers/alpaca-client.js').AlpacaClient.test()"
```

4. Check rate limiter status:
```bash
curl https://optionsengines.fly.dev/metrics
```

## Notes

- Market data may be limited outside trading hours (9:30 AM - 4:00 PM ET)
- Free tier APIs have rate limits (check provider documentation)
- Circuit breakers may be stuck open from previous failures
- Consider adding mock data for development/testing

## Priority

**HIGH** - These endpoints are critical for:
- Gamma exposure analysis
- Options flow tracking
- Max pain calculations
- Trading signal correlation

Without these working, the multi-agent decision system cannot access positioning data.
