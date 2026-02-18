# E2E Audit — SQL Queries Reference

This document provides SQL queries for evidence gathering during the End-of-Day Trading + Platform Audit. Replace `{{AUDIT_DATE}}` with the trading date (e.g. `2026-02-17`).

---

## Environment

```sql
-- Set audit date (America/New_York)
SET timezone = 'America/New_York';
-- Use: WHERE created_at::date = '{{AUDIT_DATE}}'::date
```

---

## 1. EXECUTIVE SUMMARY METRICS

```sql
-- Total P&L
SELECT
  COALESCE(SUM(realized_pnl), 0) AS total_pnl
FROM refactored_positions
WHERE exit_timestamp::date = '{{AUDIT_DATE}}'::date
  AND status = 'closed'
  AND COALESCE(is_test, false) = false;

-- Total R, Win rate, Avg win R, Avg loss R
SELECT
  COUNT(*) AS closed_trades,
  SUM(CASE WHEN pnl_r > 0 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) AS win_rate,
  AVG(CASE WHEN pnl_r > 0 THEN pnl_r END) AS avg_win_r,
  AVG(CASE WHEN pnl_r < 0 THEN pnl_r END) AS avg_loss_r
FROM bias_trade_performance
WHERE created_at::date = '{{AUDIT_DATE}}'::date
  AND COALESCE(source, 'live') = 'live';

-- Trades opened
SELECT COUNT(*) FROM refactored_positions
WHERE entry_timestamp::date = '{{AUDIT_DATE}}'::date
  AND COALESCE(is_test, false) = false;

-- Trades closed
SELECT COUNT(*) FROM refactored_positions
WHERE exit_timestamp::date = '{{AUDIT_DATE}}'::date
  AND status = 'closed'
  AND COALESCE(is_test, false) = false;

-- Trades rejected (signals)
SELECT COUNT(*) FROM signals
WHERE created_at::date = '{{AUDIT_DATE}}'::date
  AND status = 'rejected'
  AND COALESCE(is_test, false) = false;
```

---

## 2. PIPELINE FUNNEL

```sql
-- 1. Webhooks received
SELECT COUNT(*) AS webhooks_received
FROM webhook_events
WHERE created_at::date = '{{AUDIT_DATE}}'::date
  AND COALESCE(is_test, false) = false;

-- 2. Valid webhooks (accepted)
SELECT COUNT(*) AS valid_webhooks
FROM webhook_events
WHERE created_at::date = '{{AUDIT_DATE}}'::date
  AND status = 'accepted'
  AND COALESCE(is_test, false) = false;

-- 3. Invalid webhooks by source
SELECT status, COUNT(*) AS count
FROM webhook_events
WHERE created_at::date = '{{AUDIT_DATE}}'::date
  AND COALESCE(is_test, false) = false
  AND status IN ('invalid_signature', 'invalid_payload', 'error', 'duplicate')
GROUP BY status
ORDER BY count DESC;

-- 4. Signals created
SELECT COUNT(*) AS signals_created
FROM signals
WHERE created_at::date = '{{AUDIT_DATE}}'::date
  AND COALESCE(is_test, false) = false;

-- 5–6. Signals evaluated by Engine A / B (via experiments)
SELECT e.variant, COUNT(*) AS count
FROM experiments e
JOIN signals s ON s.signal_id = e.signal_id
WHERE s.created_at::date = '{{AUDIT_DATE}}'::date
  AND COALESCE(s.is_test, false) = false
GROUP BY e.variant;

-- 7–9. ENTER / HOLD / REJECT (via decision_recommendations + rationale)
SELECT
  dr.engine,
  CASE
    WHEN dr.rationale->>'rejection_reason' IS NOT NULL THEN 'REJECT'
    WHEN dr.strike IS NOT NULL AND dr.quantity > 0 THEN 'ENTER'
    ELSE 'HOLD'
  END AS decision_type,
  COUNT(*) AS count
FROM decision_recommendations dr
JOIN signals s ON s.signal_id = dr.signal_id
WHERE s.created_at::date = '{{AUDIT_DATE}}'::date
  AND COALESCE(s.is_test, false) = false
GROUP BY dr.engine, decision_type;

-- Rejection reasons
SELECT COALESCE(s.rejection_reason, 'unknown') AS reason, COUNT(*) AS count
FROM signals s
WHERE s.created_at::date = '{{AUDIT_DATE}}'::date
  AND s.status = 'rejected'
  AND COALESCE(s.is_test, false) = false
GROUP BY s.rejection_reason
ORDER BY count DESC;

-- 10. Orders created
SELECT COUNT(*) FROM orders o
JOIN signals s ON s.signal_id = o.signal_id
WHERE s.created_at::date = '{{AUDIT_DATE}}'::date
  AND COALESCE(s.is_test, false) = false;

-- 11. Orders filled
SELECT COUNT(*) FROM trades t
JOIN orders o ON o.order_id = t.order_id
JOIN signals s ON s.signal_id = o.signal_id
WHERE s.created_at::date = '{{AUDIT_DATE}}'::date
  AND COALESCE(s.is_test, false) = false;

-- 12–13. Positions opened / closed
SELECT
  COUNT(*) FILTER (WHERE entry_timestamp::date = '{{AUDIT_DATE}}'::date) AS opened,
  COUNT(*) FILTER (WHERE exit_timestamp::date = '{{AUDIT_DATE}}'::date AND status = 'closed') AS closed
FROM refactored_positions
WHERE COALESCE(is_test, false) = false
  AND (entry_timestamp::date = '{{AUDIT_DATE}}'::date OR exit_timestamp::date = '{{AUDIT_DATE}}'::date);

-- 14. Trades in bias_trade_performance
SELECT COUNT(*) FROM bias_trade_performance
WHERE created_at::date = '{{AUDIT_DATE}}'::date
  AND COALESCE(source, 'live') = 'live';
```

---

## 3. TRADING QUALITY REVIEW (ALL CLOSED TRADES)

```sql
SELECT
  rp.position_id AS trade_id,
  rp.symbol,
  CASE WHEN rp.type = 'call' THEN 'long' ELSE 'short' END AS direction,
  rp.entry_timestamp AS entry_time,
  rp.exit_timestamp AS exit_time,
  EXTRACT(EPOCH FROM (rp.exit_timestamp - rp.entry_timestamp)) / 60 AS duration_minutes,
  rp.entry_regime_type AS strategy_tag,
  rp.engine,
  rp.entry_confidence_score AS confidence_score,
  rp.strike,
  rp.expiration,
  rp.entry_price AS entry_premium,
  rp.current_price AS exit_premium,
  rp.exit_reason,
  rp.realized_pnl AS pnl_dollar,
  rp.r_multiple AS pnl_r
FROM refactored_positions rp
WHERE rp.exit_timestamp::date = '{{AUDIT_DATE}}'::date
  AND rp.status = 'closed'
  AND COALESCE(rp.is_test, false) = false
ORDER BY rp.exit_timestamp;
```

---

## 4. SERVICE AUDIT — WEBHOOK INGESTION

```sql
-- Invalid payloads
SELECT event_id, status, error_message, symbol, direction, timeframe, created_at
FROM webhook_events
WHERE created_at::date = '{{AUDIT_DATE}}'::date
  AND status IN ('invalid_payload', 'invalid_signature', 'error')
  AND COALESCE(is_test, false) = false
ORDER BY created_at DESC;

-- Duplicates
SELECT COUNT(*) FROM webhook_events
WHERE created_at::date = '{{AUDIT_DATE}}'::date
  AND status = 'duplicate'
  AND COALESCE(is_test, false) = false;
```

---

## 5. SERVICE AUDIT — DECISION ENGINE B (meta_decision)

```sql
-- meta_decision rows
SELECT ad.*, s.symbol, s.direction, s.timeframe
FROM agent_decisions ad
JOIN signals s ON s.signal_id = ad.signal_id
WHERE ad.agent_name = 'meta_decision'
  AND s.created_at::date = '{{AUDIT_DATE}}'::date
  AND COALESCE(s.is_test, false) = false
ORDER BY ad.created_at DESC;

-- Decision factors (all agents)
SELECT ad.agent_name, ad.bias, ad.confidence, ad.reasons, ad.block
FROM agent_decisions ad
JOIN signals s ON s.signal_id = ad.signal_id
WHERE s.created_at::date = '{{AUDIT_DATE}}'::date
  AND COALESCE(s.is_test, false) = false
ORDER BY ad.created_at, ad.agent_name;
```

---

## 6. TRADE AUDIT (existing service)

Use `trade-audit.service.ts`:

```ts
import { runTradeAudit } from './services/trade-audit.service.js';
const result = await runTradeAudit('2026-02-17');
// result.auditTrail, result.violations, result.recommendations
```

**Note**: `trade-audit.service.ts` filters by `we.status = 'processed'`. The `webhook_events` schema only allows `accepted`, `duplicate`, `invalid_signature`, `invalid_payload`, `error`. Use `status = 'accepted'` for successful webhooks if the audit returns no rows.

---

## 7. TESTS TO RUN TONIGHT — Synthetic Payloads

### Valid (expected: ACCEPTED, signal created)

```json
{
  "symbol": "SPY",
  "direction": "long",
  "timeframe": "5m",
  "timestamp": "2026-02-17T14:30:00Z",
  "price": 595.42, "confidence": 75
}
```

### Invalid (expected: REJECTED, invalid_payload)

```json
{
  "price": 595.42
}
```

### Edge case (missing direction, inferred from nested)

```json
{
  "symbol": "QQQ",
  "timeframe": "1h",
  "signal": { "direction": "short" }
}
```

### Verification SQL

```sql
SELECT event_id, status, signal_id, error_message, created_at
FROM webhook_events
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 10;
```

---

## 8. EXISTING REPORTING

* **Webhook processing report**: `tests/e2e/reporting/webhook-live-processing-report.test.ts`  
  Run with `WEBHOOK_REPORT_DATE=2026-02-17` to generate `tmp/webhook-processing-report-{{date}}.md` and `.json`.

* **Monitoring API**: `GET /api/monitoring/status?windowHours=24&testFilter=production`
