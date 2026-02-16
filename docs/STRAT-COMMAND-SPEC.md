# Strat Command Center — Build Specification

## Overview

Strat Command Center is the **human decision layer** between scanner intelligence and the execution pipeline:

```
Scanner Intelligence → Strat Command Center → Signal → Decision Engine → Order Creator → Position Monitor
```

## Implemented (Phase 1–3)

### Database (Migration 033)
- **strat_alerts** — Unified alert feed (scanner, webhook, UW, manual)
- **strat_plans** — Enhanced with entry/target/stop, execution_mode, trigger_condition, plan_status
- Plan state machine: draft → armed → triggered → executing → filled | expired | cancelled | rejected

### Backend APIs
- `GET /api/strat/alerts` — List strat alerts (from strat_alerts table)
- `GET /api/strat/plans?tab=active|triggered|history` — List plans by state
- `GET /api/strat/watchlist` — Watchlist status
- Existing `/api/strat-plan/*` — Plan CRUD, watchlist, dashboard

### UI (StratCommandCenter)
- Stats bar: Alerts, Triggered, Pending, Active Plans
- Plan capacity counter (0/10) in header
- Strat Alerts panel with expandable cards, filters
- Plans panel with tabs: **Active**, **Triggered**, **History**
- Create Plan from Alert modal
- Create Plan Manual modal

### PlanTriggerWorker
- Stub worker that polls ARMED plans
- TODO: Implement trigger evaluation + signal creation

## Remaining (Phase 4–5)

### Alert Intelligence Sources
- **Source A** — Strat Specialist Agent (strat-specialist.ts)
- **Source B** — Unusual Whales enrichment (flow, GEX, dark pool)
- **Source C** — TradingView webhook signals (STRAT_SETUP, etc.)
- **Source D** — Watchlist-based scanner (candles → strat classification)

### Full Trigger Logic
- Fetch live price for ARMED plans
- Evaluate trigger_condition (e.g. price >= reversal_level)
- Create signal on trigger
- Link plan → signal → Decision Engine

### WebSocket Events
- strat:alert:new, strat:alert:triggered
- strat:plan:triggered, strat:plan:executing, strat:plan:filled
- strat:position:update, strat:position:closed

### Feedback Loop
- Realized PnL → strat performance model update
- Feedback Tuner integration

## Data Models

### StratAlert
- symbol, direction, timeframe, setup
- entry, target, stop, reversalLevel
- score, c1Type, c2Type, c1Shape, atr, rvol
- flowSentiment, unusualActivity, gexLevel
- status: watching | pending | triggered | expired | invalidated
- source: scanner | webhook | manual | unusual_whales

### StratPlan
- executionMode: manual | auto_on_trigger
- triggerCondition: string
- plan_status: draft | armed | triggered | executing | filled | expired | cancelled | rejected
- Links: source_alert_id, signal_id, position_id
