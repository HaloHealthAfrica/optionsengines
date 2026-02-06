# API Keys Setup Guide
**For Options Trading Platform**

This guide explains what API keys you need and how to obtain them for your options trading platform.

---

## 📋 Required API Keys

Your system needs the following API keys:

| Provider | Keys Needed | Purpose | Priority |
|----------|-------------|---------|----------|
| **Alpaca** | `ALPACA_API_KEY`<br>`ALPACA_SECRET_KEY` | Primary market data & trading | 🔴 High |
| **Polygon** | `POLYGON_API_KEY` | Secondary market data | 🟡 Medium |
| **TwelveData** | `TWELVE_DATA_API_KEY` | Fallback market data | 🟢 Low (working without) |
| **MarketData.app** | `MARKET_DATA_API_KEY` | Options data, GEX, flow | 🟢 Low (working without) |

---

## 🔴 1. Alpaca API Keys (HIGH PRIORITY)

### What You Get:
- Real-time stock quotes (bid/ask/mid)
- Historical candles (OHLCV data)
- Option prices for exit monitoring
- Official market hours API
- Paper trading capabilities
- Fast, reliable data

### How to Get Keys:

#### Step 1: Create Account
1. Go to [https://alpaca.markets](https://alpaca.markets)
2. Click "Sign Up" (top right)
3. Choose "Paper Trading" (free, no real money needed)
4. Fill out registration form
5. Verify your email

#### Step 2: Get API Keys
1. Log in to [https://app.alpaca.markets](https://app.alpaca.markets)
2. Click on your profile (top right)
3. Select "API Keys" from dropdown
4. You'll see two keys:
   - **API Key ID** → This is your `ALPACA_API_KEY`
   - **Secret Key** → This is your `ALPACA_SECRET_KEY`
5. Copy both keys (Secret Key is only shown once!)

#### Step 3: Configure in Fly.io
```bash
fly secrets set ALPACA_API_KEY="your-api-key-id-here" -a optionsengines
fly secrets set ALPACA_SECRET_KEY="your-secret-key-here" -a optionsengines
fly secrets set ALPACA_PAPER="true" -a optionsengines
fly secrets set ALPACA_BASE_URL="https://paper-api.alpaca.markets" -a optionsengines
```

#### Step 4: Restart App
```bash
fly apps restart optionsengines
```

### Pricing:
- **Paper Trading**: FREE ✅
- **Live Trading**: FREE for market data, commission-free trades
- **Rate Limits**: 200 requests/minute (free tier)

### Important Notes:
- Paper trading uses fake money (perfect for testing)
- Paper API URL: `https://paper-api.alpaca.markets`
- Live API URL: `https://api.alpaca.markets` (when ready for real trading)
- Keep your Secret Key secure - treat it like a password!

---

## 🟡 2. Polygon API Key (MEDIUM PRIORITY)

### What You Get:
- High-quality historical data
- Real-time stock quotes
- Options data
- Market status API
- Good fallback for Alpaca

### How to Get Key:

#### Step 1: Create Account
1. Go to [https://polygon.io](https://polygon.io)
2. Click "Get Started" or "Sign Up"
3. Fill out registration form
4. Verify your email

#### Step 2: Choose Plan
- **Starter Plan**: $29/month (recommended)
  - 5 API calls/minute
  - Real-time data
  - Historical data
  - Options data
- **Developer Plan**: $99/month
  - 100 API calls/minute
  - More features

#### Step 3: Get API Key
1. Log in to [https://polygon.io/dashboard](https://polygon.io/dashboard)
2. Go to "API Keys" section
3. Copy your API key

#### Step 4: Configure in Fly.io
```bash
fly secrets set POLYGON_API_KEY="your-polygon-api-key-here" -a optionsengines
fly apps restart optionsengines
```

### Pricing:
- **Free Tier**: Limited (2 years delayed data)
- **Starter**: $29/month (real-time data)
- **Developer**: $99/month (higher limits)

### Important Notes:
- Provides redundancy if Alpaca fails
- Higher quality historical data than free providers
- Good for backtesting and analysis

---

## 🟢 3. TwelveData API Key (LOW PRIORITY - Optional)

### What You Get:
- Basic stock quotes
- Historical candles
- Simple, reliable fallback
- Already working without key (limited)

### How to Get Key:

#### Step 1: Create Account
1. Go to [https://twelvedata.com](https://twelvedata.com)
2. Click "Get Free API Key"
3. Fill out registration form
4. Verify your email

#### Step 2: Get API Key
1. Log in to [https://twelvedata.com/account](https://twelvedata.com/account)
2. Go to "API Keys" section
3. Copy your API key

#### Step 3: Configure in Fly.io
```bash
fly secrets set TWELVE_DATA_API_KEY="your-twelvedata-api-key-here" -a optionsengines
fly apps restart optionsengines
```

### Pricing:
- **Free Tier**: 800 requests/day ✅
- **Basic**: $8/month (8,000 requests/day)
- **Pro**: $29/month (unlimited requests)

### Important Notes:
- System already works with free tier
- Upgrading gives higher rate limits
- Good for basic stock data

---

## 🟢 4. MarketData.app API Key (LOW PRIORITY - Optional)

### What You Get:
- Options chain data
- Gamma Exposure (GEX) calculations
- Options flow tracking
- Already working without key (limited)

### How to Get Key:

#### Step 1: Create Account
1. Go to [https://www.marketdata.app](https://www.marketdata.app)
2. Click "Sign Up"
3. Fill out registration form
4. Verify your email

#### Step 2: Get API Key
1. Log in to [https://dashboard.marketdata.app](https://dashboard.marketdata.app)
2. Go to "API Keys" section
3. Copy your API key

#### Step 3: Configure in Fly.io
```bash
fly secrets set MARKET_DATA_API_KEY="your-marketdata-api-key-here" -a optionsengines
fly apps restart optionsengines
```

### Pricing:
- **Free Tier**: Limited requests ✅
- **Starter**: $29/month
- **Professional**: $99/month

### Important Notes:
- System already works with free tier
- Upgrading gives option pricing capability
- Excellent for options-focused trading

---

## 🚀 Quick Setup (Recommended Order)

### 1. Start with Alpaca (FREE)
```bash
# Get Alpaca keys from https://app.alpaca.markets
fly secrets set ALPACA_API_KEY="your-key" -a optionsengines
fly secrets set ALPACA_SECRET_KEY="your-secret" -a optionsengines
fly secrets set ALPACA_PAPER="true" -a optionsengines
fly apps restart optionsengines
```

### 2. Add Polygon for Redundancy ($29/month)
```bash
# Get Polygon key from https://polygon.io/dashboard
fly secrets set POLYGON_API_KEY="your-key" -a optionsengines
fly apps restart optionsengines
```

### 3. (Optional) Upgrade TwelveData
```bash
# Get TwelveData key from https://twelvedata.com/account
fly secrets set TWELVE_DATA_API_KEY="your-key" -a optionsengines
fly apps restart optionsengines
```

### 4. (Optional) Upgrade MarketData.app
```bash
# Get MarketData key from https://dashboard.marketdata.app
fly secrets set MARKET_DATA_API_KEY="your-key" -a optionsengines
fly apps restart optionsengines
```

---

## 🔒 Security Best Practices

### DO:
✅ Keep API keys secret (never commit to git)
✅ Use environment variables
✅ Rotate keys periodically
✅ Use paper trading keys for testing
✅ Monitor API usage
✅ Set up IP whitelisting when available

### DON'T:
❌ Share keys publicly
❌ Commit keys to version control
❌ Use live trading keys in development
❌ Hardcode keys in source code
❌ Use same keys across multiple apps

---

## 📊 Cost Summary

| Provider | Free Tier | Paid Tier | Recommended |
|----------|-----------|-----------|-------------|
| **Alpaca** | ✅ Paper trading | Free live trading | Start here (FREE) |
| **Polygon** | ❌ Limited | $29/month | Add for redundancy |
| **TwelveData** | ✅ 800 req/day | $8-29/month | Optional upgrade |
| **MarketData.app** | ✅ Limited | $29-99/month | Optional upgrade |

**Minimum Cost**: $0/month (Alpaca paper trading only)  
**Recommended**: $29/month (Alpaca + Polygon)  
**Full Setup**: $58-158/month (all providers upgraded)

---

## 🧪 Testing Your Setup

After configuring keys, test the connection:

```bash
# Check if keys are set
fly ssh console -a optionsengines -C "env | grep -E '(ALPACA|POLYGON|TWELVE|MARKET)'"

# View logs to see if providers are working
fly logs -a optionsengines -n 100

# Look for successful data fetches
fly logs -a optionsengines | grep "fetched from"
```

You should see logs like:
```
[INFO] Candles fetched from alpaca {"symbol":"SPY","count":50}
[INFO] Price fetched from alpaca {"symbol":"SPY","price":450.25}
```

---

## 🎯 What Each Key Enables

### With Alpaca Keys:
✅ Fast, reliable stock data
✅ Option prices for exit monitoring
✅ Official market hours
✅ Paper trading capabilities
✅ Primary data source

### With Polygon Key:
✅ Redundancy if Alpaca fails
✅ High-quality historical data
✅ Options data backup
✅ Market status API

### With TwelveData Key (Upgraded):
✅ Higher rate limits (8,000/day vs 800/day)
✅ More reliable fallback
✅ Better performance

### With MarketData.app Key (Upgraded):
✅ Option pricing capability
✅ Better GEX data
✅ Enhanced options flow
✅ More requests per day

---

## 🆘 Troubleshooting

### "401 Unauthorized" Errors
- Check if keys are set correctly
- Verify keys haven't expired
- Ensure no extra spaces in keys
- Try regenerating keys

### "Rate Limit Exceeded" Errors
- Upgrade to paid tier
- Implement request throttling
- Use caching more aggressively
- Add more providers for load balancing

### "Circuit Breaker Open" Messages
- Normal behavior when provider fails
- System automatically tries next provider
- Check if API keys are valid
- Verify provider service status

---

## 📞 Support Resources

### Alpaca
- Docs: [https://alpaca.markets/docs](https://alpaca.markets/docs)
- Support: [https://alpaca.markets/support](https://alpaca.markets/support)
- Community: [https://forum.alpaca.markets](https://forum.alpaca.markets)

### Polygon
- Docs: [https://polygon.io/docs](https://polygon.io/docs)
- Support: support@polygon.io
- Status: [https://status.polygon.io](https://status.polygon.io)

### TwelveData
- Docs: [https://twelvedata.com/docs](https://twelvedata.com/docs)
- Support: support@twelvedata.com

### MarketData.app
- Docs: [https://www.marketdata.app/docs](https://www.marketdata.app/docs)
- Support: support@marketdata.app

---

## ✅ Verification Checklist

After setup, verify:

- [ ] Alpaca keys configured in Fly.io
- [ ] Polygon key configured (if using)
- [ ] App restarted after setting keys
- [ ] Logs show successful data fetches
- [ ] No "401 Unauthorized" errors
- [ ] Circuit breakers are closed
- [ ] Stock prices are updating
- [ ] Candles are being fetched
- [ ] Options data is available (if using)

---

**Last Updated**: February 6, 2026  
**Next Review**: After API key configuration
