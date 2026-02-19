# Rollback Runbook — Engine B Routing

**Purpose:** Quickly disable Engine B and revert to single-engine (Engine A) mode if issues arise during canary rollout.

---

## Phase 4 Canary Steps (Before Rollback)

| Step | AB_SPLIT_PERCENTAGE | Duration | Verification |
|------|---------------------|----------|--------------|
| 1 | 1–5% | 24–72h | `npm run verify:canary` |
| 2 | 10% | 24–72h | Same |
| 3 | 25% | 24–72h | Same |
| 4 | 50% | Ongoing | Same |

**After enabling B at each step:** Run `npm run verify:canary` (or `--hours=24`) to confirm B experiments and orders > 0, no duplicates.

---

## When to Rollback (Triggers & Thresholds)

| Trigger | Threshold | Action |
|---------|------------|--------|
| Duplicate orders per signal | > 0 in 7 days | Immediate rollback; block Phase 4 |
| Duplicate trades | > 0 groups (audit:pnl) | Immediate rollback |
| B win-rate vs A | B < A by > 10% (e.g. A 18%, B < 8%) | Reduce split or rollback |
| B expectancy | Negative beyond $X (e.g. < -$500/trade) | Reduce split or rollback |
| B order failure rate | > 5% of B orders | Rollback |
| B null-recommendation rate | > 10% of B experiments | Rollback |
| Enrichment missing | > 1% of accepted webhooks | Investigate; block Phase 4 if persistent |

---

## Rollback Steps

### 1. Update Environment Variables

Set:

```
AB_SPLIT_PERCENTAGE=0
ENABLE_VARIANT_B=false
```

**Fly.io:**

```bash
fly secrets set AB_SPLIT_PERCENTAGE=0 ENABLE_VARIANT_B=false -a <your-app-name>
```

**Local / .env:**

```bash
AB_SPLIT_PERCENTAGE=0
ENABLE_VARIANT_B=false
```

### 2. Restart Services

**Fly.io:**

```bash
fly deploy -a <your-app-name>
# or
fly apps restart <your-app-name>
```

**Local:**

```bash
# Stop the server (Ctrl+C) and restart
npm run dev
```

### 3. Verify Rollback

Run:

```sql
SELECT variant, COUNT(*) 
FROM experiments 
WHERE created_at >= NOW() - INTERVAL '1 hour' 
GROUP BY variant;
```

**Expected:** Only `A` rows; `B` count = 0 for new experiments.

```sql
SELECT engine, COUNT(*) 
FROM orders 
WHERE created_at >= NOW() - INTERVAL '1 hour' 
GROUP BY engine;
```

**Expected:** Only `A` rows for new orders; `B` = 0.

---

## Post-Rollback

1. Notify team / on-call.
2. Create incident ticket.
3. Run `npm run verify:p0` to confirm no duplicate orders.
4. Review Sentry for B-related errors before re-enabling.

---

## Pre-Canary Verification (Copyable)

```bash
# 1. DB idempotency: migration 042 must be applied
npm run migrate:up

# 2. P0 gate: no duplicates, GEX health
npm run verify:p0

# 3. Duplicate trades
npm run audit:pnl

# 4. Enrichment coverage
npm run audit:enrichment

# 5. Baseline (for B comparison)
npm run baseline:engine-a
```

**SQL: Migration 042 index exists**
```sql
SELECT indexname FROM pg_indexes 
WHERE tablename = 'orders' AND indexname = 'idx_orders_signal_engine_order_type_unique';
```
Expected: 1 row.

**SQL: Duplicate orders (must be 0)**
```sql
SELECT signal_id, COUNT(*) AS order_count
FROM orders
WHERE created_at >= NOW() - INTERVAL '30 days' AND signal_id IS NOT NULL
GROUP BY signal_id
HAVING COUNT(*) > 1;
```
Expected: 0 rows.

---

## Post-Canary Verification (Copyable)

```bash
# After enabling B at 1–5%
npm run verify:canary
npm run compare:engine-ab
```

**SQL: B experiments and orders**
```sql
SELECT variant, COUNT(*) FROM experiments 
WHERE created_at >= NOW() - INTERVAL '24 hours' GROUP BY variant;

SELECT engine, COUNT(*) FROM orders 
WHERE created_at >= NOW() - INTERVAL '24 hours' GROUP BY engine;
```
Expected when B enabled: B > 0 in both.

**SQL: Shadow path exercised (decision_recommendations + shadow_trades)**
```sql
SELECT engine, is_shadow, COUNT(*) FROM decision_recommendations 
WHERE created_at >= NOW() - INTERVAL '24 hours' GROUP BY engine, is_shadow;

SELECT COUNT(*) FROM shadow_trades WHERE entry_timestamp >= NOW() - INTERVAL '24 hours';
```
Expected when B + shadow enabled: B rows with is_shadow=true; shadow_trades > 0.
