# Remediation Deployment Checklist

**Purpose:** Pre-deploy verification and rollout sequence for the Remediation Plan V2.

---

## Pre-Deploy (Before Any Phase 4 Canary)

| Step | Command / Action | Pass Criteria |
|------|-------------------|---------------|
| 1 | `npm run migrate:up` | Migrations apply cleanly |
| 2 | Verify migration 042 index exists (see SQL below) | 1 row returned |
| 3 | `npm run verify:p0` | 0 duplicate orders, GEX health OK |
| 4 | `npm run audit:pnl` | 0 duplicate trade groups |
| 5 | `npm run baseline:engine-a` | Writes `tmp/ENGINE_A_BASELINE.json` |
| 6 | `npm run audit:enrichment` | missing < 1% |
| 7 | Verify `docs/ROLLBACK_RUNBOOK.md` exists | Rollback steps documented |

---

## Copyable Verification Commands

```bash
npm run migrate:up
npm run verify:p0
npm run audit:pnl
npm run audit:enrichment
npm run baseline:engine-a
```

**Exercise B + shadow path (E2E)**
```bash
npm run test:e2e:engine-b
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

## Post-Canary Verification (B + Shadow)

```bash
npm run verify:canary
npm run compare:engine-ab
```

**SQL: B decision + shadow path exercised**
```sql
SELECT engine, is_shadow, COUNT(*) FROM decision_recommendations 
WHERE created_at >= NOW() - INTERVAL '24 hours' GROUP BY engine, is_shadow;

SELECT COUNT(*) FROM shadow_trades WHERE entry_timestamp >= NOW() - INTERVAL '24 hours';
```
Expected when B + shadow enabled: B rows with is_shadow=true; shadow_trades > 0.

---

## Scripts Reference (Remediation)

| Script | Command | Purpose |
|--------|---------|---------|
| P0 verification | `npm run verify:p0` | Duplicate orders + GEX health (before Phase 4) |
| Engine A baseline | `npm run baseline:engine-a` | Record 30d metrics to `tmp/ENGINE_A_BASELINE.json` |
| Enrichment audit | `npm run audit:enrichment` | Coverage: webhooks → refactored_signals |
| Trace webhooks | `npm run trace:webhooks <signal_id>` | Debug pipeline drop-off |
| GEX diagnostic | `npm run diagnose:gex [SPY]` | Provider/ingestion check |
| GEX health | `npm run gex:health` | Non-zero rate check |
| DTE simulation | `npm run simulate:dte` | DTE bucket analysis (30d) |
| Engine A vs B | `npm run compare:engine-ab` | Shadow comparison (A vs B) |
| Canary verification | `npm run verify:canary` | Post-enable B: experiments, orders, duplicates |

**Args:** `audit:enrichment` → `--hours=24 --threshold-pct=1`; `compare:engine-ab` → `--days=30`; `verify:canary` → `--hours=24`

---

## Cron Endpoints (Require CRON_SECRET)

| Endpoint | Schedule | Purpose |
|----------|----------|---------|
| `POST /api/cron/process-queue` | Every 2–3 min | Orchestrator, orders, paper executor, exit monitor, shadow monitor |
| `POST /api/cron/enrichment-audit` | Daily | Phase 5 enrichment coverage; 503 on fail + alert |
| `POST /api/cron/tier1-price-check` | Every 5 min (market hours) | Strat plan price re-eval |
| `POST /api/cron/tier2-scan-*` | Per schedule | Strat scans (premarket, 4H, daily, weekly) |
| `POST /api/cron/strat-feedback` | Weekly | Outcome tracker + scoring tuner |

**Auth:** `Authorization: Bearer <CRON_SECRET>` or `X-Cron-Secret: <CRON_SECRET>`

---

## Phase 4 Canary Steps

| Step | AB_SPLIT_PERCENTAGE | Duration | Verification |
|------|---------------------|----------|--------------|
| 1 | 1–5% | 24–72h | `npm run verify:canary` |
| 2 | 10% | 24–72h | Same |
| 3 | 25% | 24–72h | Same |
| 4 | 50% | Ongoing | Same |

**Enable:** `ENABLE_VARIANT_B=true`, `AB_SPLIT_PERCENTAGE=5` (or 1 for step 1).  
**Shadow:** `ENABLE_SHADOW_EXECUTION=true` for B shadow trades.

---

## Rollback (Quick)

1. `AB_SPLIT_PERCENTAGE=0` and `ENABLE_VARIANT_B=false`
2. Restart services
3. `npm run verify:canary` → B = 0 in experiments and orders

See `docs/ROLLBACK_RUNBOOK.md` for full steps.

---

## Key Paths

| Item | Path |
|------|------|
| Remediation plan | `tmp/REMEDIATION_PLAN_V2.md` |
| Engine A baseline | `tmp/ENGINE_A_BASELINE.json` |
| Rollback runbook | `docs/ROLLBACK_RUNBOOK.md` |
