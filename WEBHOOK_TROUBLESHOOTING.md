# Webhook Troubleshooting Guide

## Problem: No signals showing on dashboard

### Quick Diagnostic

Run the diagnostic script to check webhook status:

```bash
npm run check:webhooks
```

This will show:
- How many signals were received today
- Signal status breakdown (pending/approved/rejected)
- Engine routing stats (A vs B)
- Shadow trades executed
- Recent errors

### Test Webhook Endpoint

Test if your webhook endpoint is responding:

```bash
npm run test:webhook
```

Or test a specific URL:

```bash
WEBHOOK_URL=https://your-domain.com/webhook npm run test:webhook
```

### Common Issues & Solutions

#### 1. Server Not Running
**Symptom:** No signals received, test webhook fails with connection error

**Solution:**
```bash
# Check if server is running
curl http://localhost:3000/webhook/test

# Start server if not running
npm start
```

#### 2. TradingView Webhook Not Configured
**Symptom:** Server running but no signals received

**Check:**
- Go to TradingView alert settings
- Verify webhook URL is correct: `https://your-domain.com/webhook`
- Ensure alert is active and firing
- Check alert message format matches expected payload

**Expected payload format:**
```json
{
  "symbol": "SPY",
  "direction": "long",
  "timeframe": "5m",
  "timestamp": "2024-01-15T14:30:00Z",
  "secret": "your-shared-secret"
}
```

#### 3. HMAC Signature Validation Failing
**Symptom:** Signals received but all rejected with "Invalid signature"

**Solution:**
```bash
# Check your .env file
cat .env | grep HMAC_SECRET

# If HMAC is enabled and you send a signature, it must match the secret
# Or disable HMAC validation entirely by leaving HMAC_SECRET unset
```

#### 4. Signals Stuck in Pending
**Symptom:** Signals received but status stays "pending"

**Solution:**
- Signal processor worker may not be running
- Check worker status in server logs
- Workers should start automatically with server

#### 5. Database Connection Issues
**Symptom:** Server starts but crashes on webhook

**Solution:**
```bash
# Check database connection
cat .env | grep DATABASE_URL

# Test database connection
npm run migrate:up
```

#### 6. Port/Firewall Issues
**Symptom:** Server running locally but webhooks not reaching it

**Solution:**
- If using ngrok or similar: verify tunnel is active
- If deployed: check firewall rules allow incoming traffic on port 3000
- Verify webhook URL in TradingView matches your actual endpoint

### Detailed Diagnostics

#### Check Server Logs
```bash
# If using PM2
pm2 logs

# If running directly
# Check console output where you ran npm start
```

#### Check Database Directly
```bash
# Connect to database
psql $DATABASE_URL

# Check recent signals
SELECT signal_id, symbol, direction, status, created_at 
FROM signals 
ORDER BY created_at DESC 
LIMIT 10;

# Check signal counts by status
SELECT status, COUNT(*) 
FROM signals 
WHERE created_at >= CURRENT_DATE 
GROUP BY status;
```

#### Check Event Logs
```bash
# In psql
SELECT event_type, COUNT(*) 
FROM event_logs 
WHERE created_at >= CURRENT_DATE 
GROUP BY event_type 
ORDER BY COUNT(*) DESC;
```

### Production Deployment Checklist

- [ ] Server is running and accessible
- [ ] Database migrations are up to date
- [ ] Environment variables are set correctly
- [ ] Webhook URL in TradingView matches deployment URL
- [ ] HMAC secret matches between .env and TradingView
- [ ] Firewall allows incoming traffic
- [ ] SSL certificate is valid (if using HTTPS)
- [ ] Workers are running (signal processor, exit monitor, etc.)

### Testing Workflow

1. **Test locally first:**
   ```bash
   npm run test:webhook
   ```

2. **Check database for signal:**
   ```bash
   npm run check:webhooks
   ```

3. **Send test from TradingView:**
   - Create a simple alert
   - Set webhook URL
   - Trigger alert manually
   - Check server logs immediately

4. **Verify signal processing:**
   - Signal should appear in database within seconds
   - Status should change from "pending" to "approved" or "rejected"
   - Check dashboard for signal

### Getting Help

If issues persist:

1. Run full diagnostic:
   ```bash
   npm run diagnose
   ```

2. Check server logs for errors

3. Verify all environment variables are set

4. Test with curl to isolate TradingView vs server issues:
   ```bash
   curl -X POST http://localhost:3000/webhook \
     -H "Content-Type: application/json" \
     -d '{"symbol":"SPY","direction":"long","timeframe":"5m","timestamp":"2024-01-15T14:30:00Z"}'
   ```
