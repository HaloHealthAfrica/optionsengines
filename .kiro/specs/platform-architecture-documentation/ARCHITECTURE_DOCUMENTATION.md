# Trading Platform Architecture Documentation

## Executive Summary

This document provides a comprehensive analysis of the as-implemented architecture for the dual-engine options trading platform. The platform ingests webhook signals from TradingView, processes them through two parallel decision engines (Engine A and Engine B), executes trades via paper trading, manages positions, and displays real-time data through a web dashboard.

**Key Architectural Characteristics**:
- **Dual-Engine Design**: Engine A (traditional rule-based) and Engine B (multi-agent AI) run in parallel for A/B comparison
- **Webhook-Driven**: All trading signals originate from TradingView webhooks
- **Worker-Based Processing**: Five background workers handle signal processing, order creation, trade execution, position updates, and exit monitoring
- **Paper Trading Only**: Currently operates in paper trading mode with shadow execution for Engine B
- **PostgreSQL-Centric**: Database serves as the primary state store and coordination mechanism
- **Multi-Provider Market Data**: Fallback chain across Alpaca, Polygon, MarketData.app, and TwelveData with circuit breakers
- **Next.js Dashboard**: Real-time UI with Redis caching and aggregated API endpoints

**Critical Dependencies**:
- PostgreSQL database (single point of failure)
- At least one market data provider (Alpaca, Polygon, MarketData.app, or TwelveData)
- TradingView for signal generation
- Redis (optional, for dashboard performance)

**Deployment Model**: Single-instance Node.js application with no horizontal scaling support

---

## 1. System Component Inventory

### 1.1 Ingestion Layer

**Components**:
1. **Webhook Receiver** (`src/routes/webhook.ts`)
   - **Purpose**: Receives POST requests from TradingView with trading signals
   - **Technology**: Express.js route handler
   - **Deployment**: Part of main Node.js server process
   - **Dependencies**: Express, database service, HMAC validation

2. **HMAC Validator** (inline in webhook route)
   - **Purpose**: Verifies webhook authenticity using HMAC-SHA256 signature
   - **Technology**: Node.js crypto module
   - **Configuration**: `TRADINGVIEW_WEBHOOK_SECRET` environment variable
   - **Behavior**: Optional - if secret not configured, validation is skipped

3. **Signal Deduplication** (inline in webhook route)
   - **Purpose**: Prevents duplicate signal processing using SHA-256 hash
   - **Technology**: PostgreSQL unique constraint on `signal_hash` column
   - **Behavior**: Rejects signals with duplicate hash, returns 200 OK to TradingView


**Communication Patterns**:
- Inbound: HTTP POST from TradingView
- Outbound: Database INSERT to `signals` table, INSERT to `webhook_events` table

### 1.2 Processing Layer

**Components**:
1. **Signal Processor Worker** (`src/workers/signal-processor.ts`)
   - **Purpose**: Enriches pending signals with market data and performs risk checks
   - **Technology**: Interval-based worker (30-second intervals)
   - **Deployment**: Background worker in main process
   - **Dependencies**: Database, market data service, risk agent

2. **Strategy Router Service** (`src/services/strategy-router.service.ts`)
   - **Purpose**: Routes signals to Engine A or Engine B based on A/B split percentage
   - **Technology**: Deterministic hash-based routing
   - **Configuration**: `AB_SPLIT_PERCENTAGE` environment variable (0-100)
   - **Behavior**: Uses signal hash to ensure consistent routing

3. **Market Data Service** (`src/services/market-data.ts`)
   - **Purpose**: Unified interface for fetching market data with fallback and caching
   - **Technology**: Provider abstraction with circuit breakers
   - **Providers**: Alpaca, Polygon, MarketData.app, TwelveData (priority order)
   - **Dependencies**: Provider API keys, rate limiter, cache service

4. **Indicators Service** (`src/services/indicators.ts`)
   - **Purpose**: Derives technical indicators from candle data
   - **Technology**: Pure computation (no API calls)
   - **Indicators**: RSI, MACD, Bollinger Bands, ATR, volume analysis

5. **Cache Service** (`src/services/cache.service.ts`)
   - **Purpose**: In-memory caching with TTL
   - **Technology**: node-cache library
   - **Behavior**: Falls back when Redis unavailable

6. **Redis Cache Service** (`src/services/redis-cache.service.ts`)
   - **Purpose**: Distributed caching for dashboard data
   - **Technology**: Redis with ioredis client
   - **Behavior**: Optional - gracefully degrades to node-cache if unavailable

**Communication Patterns**:
- Inbound: Polls `signals` table for `status='pending'`
- Outbound: INSERT to `refactored_signals`, UPDATE `signals.status`

### 1.3 Decision Layer

**Engine A Components** (Traditional Rule-Based):
1. **Signal Processor Worker** (handles Engine A signals)
   - **Purpose**: Applies entry rules and risk checks
   - **Logic**: Hardcoded entry conditions (no agent system)
   - **Output**: Approved or rejected signals

**Engine B Components** (Multi-Agent AI):
1. **Meta Decision Agent** (`src/agents/core/meta-decision-agent.ts`)
   - **Purpose**: Orchestrates specialist agents and aggregates recommendations
   - **Technology**: Weighted voting system
   - **Dependencies**: Context agent, technical agent, risk agent, specialist agents

2. **Context Agent** (`src/agents/core/context-agent.ts`)
   - **Purpose**: Provides market context (GEX, options flow, market regime)
   - **Technology**: Data aggregation and analysis
   - **Dependencies**: Market data service, positioning service

3. **Technical Agent** (`src/agents/core/technical-agent.ts`)
   - **Purpose**: Analyzes technical indicators and price action
   - **Technology**: Indicator interpretation
   - **Dependencies**: Indicators service

4. **Risk Agent** (`src/agents/core/risk-agent.ts`)
   - **Purpose**: Evaluates risk and can veto trades
   - **Technology**: Risk scoring with veto power
   - **Dependencies**: Database (position limits, exposure limits)

5. **Specialist Agents**:
   - **ORB Specialist** (`src/agents/specialists/orb-specialist.ts`): Opening Range Breakout strategy
   - **Strat Specialist** (`src/agents/specialists/strat-specialist.ts`): Strat pattern recognition
   - **TTM Specialist** (`src/agents/specialists/ttm-specialist.ts`): TTM Squeeze indicator
   - **Gamma Flow Specialist** (`src/agents/specialists/gamma-flow-specialist.ts`): GEX analysis

6. **Sub-Agents**:
   - **Satyland Sub-Agent** (`src/agents/subagents/satyland-sub-agent.ts`): Additional analysis layer

**Communication Patterns**:
- Inbound: Webhook handler invokes Engine B synchronously
- Outbound: INSERT to `shadow_decisions`, `shadow_trades`, `shadow_positions`


### 1.4 Execution Layer

**Components**:
1. **Order Creator Worker** (`src/workers/order-creator.ts`)
   - **Purpose**: Creates order records for approved signals (Engine A only)
   - **Technology**: Interval-based worker (30-second intervals)
   - **Deployment**: Background worker in main process
   - **Dependencies**: Database, strike selection logic

2. **Paper Executor Worker** (`src/workers/paper-executor.ts`)
   - **Purpose**: Simulates trade execution for paper trading
   - **Technology**: Interval-based worker (30-second intervals)
   - **Deployment**: Background worker in main process
   - **Dependencies**: Database, market data service

3. **Shadow Executor Service** (`src/services/shadow-executor.service.ts`)
   - **Purpose**: Executes Engine B trades in shadow mode
   - **Technology**: Synchronous execution during webhook processing
   - **Deployment**: Invoked inline by webhook handler
   - **Dependencies**: Database, market data service

4. **Strike Selection Module** (`src/lib/strikeSelection/`)
   - **Purpose**: Selects optimal option strike price
   - **Technology**: Multi-factor scoring (delta, liquidity, DTE, Greeks)
   - **Status**: Implemented but not actively used (Order Creator uses simpler logic)
   - **Components**: Filters (DTE, Greeks, liquidity), Scorer, Selector

**Communication Patterns**:
- Inbound: Polls `orders` table for `status='pending_execution'`
- Outbound: INSERT to `trades`, `refactored_positions`, UPDATE `orders.status`

### 1.5 Trade Management Layer

**Components**:
1. **Position Refresher Worker** (`src/workers/position-refresher.ts`)
   - **Purpose**: Updates open positions with current prices and P&L
   - **Technology**: Interval-based worker (60-second intervals)
   - **Deployment**: Background worker in main process
   - **Dependencies**: Database, market data service

2. **Exit Monitor Worker** (`src/workers/exit-monitor.ts`)
   - **Purpose**: Monitors positions for exit conditions and closes them
   - **Technology**: Interval-based worker (60-second intervals)
   - **Deployment**: Background worker in main process
   - **Dependencies**: Database, exit rules, market data service

3. **Exit Engine** (`src/lib/exitEngine/`)
   - **Purpose**: Evaluates exit conditions using tiered rule system
   - **Technology**: Four-tier rule evaluation (hard fail, protection, profit, degradation)
   - **Components**: Evaluator, Greeks Analyzer, Tier 1-4 Rules
   - **Rules**: Profit target, stop loss, time stop, DTE exit, Greeks degradation

4. **Positioning Service** (`src/services/positioning.service.ts`)
   - **Purpose**: Provides GEX snapshots and positioning analysis
   - **Technology**: Options chain analysis with caching
   - **Dependencies**: Market data service, database

**Communication Patterns**:
- Inbound: Polls `refactored_positions` table for `status='open'`
- Outbound: UPDATE `refactored_positions` (current_price, unrealized_pnl, status)

### 1.6 UI Layer

**Components**:
1. **Next.js Frontend** (`frontend/`)
   - **Purpose**: Web dashboard for monitoring trades and positions
   - **Technology**: Next.js 14 with App Router, React, TailwindCSS
   - **Deployment**: Separate process (development) or static build (production)
   - **Pages**: Dashboard, Orders, Positions, History, Monitoring, Settings

2. **Dashboard Component** (`frontend/components/Dashboard.js`)
   - **Purpose**: Main dashboard view with metrics and charts
   - **Technology**: React with client-side data fetching
   - **Data Sources**: `/api/dashboard/metrics` endpoint

3. **Backend API Routes** (`frontend/app/api/`)
   - **Purpose**: Proxy layer between frontend and backend database
   - **Technology**: Next.js API routes
   - **Endpoints**: 
     - `/api/dashboard/metrics`: Aggregated dashboard data
     - `/api/orders`: Order history
     - `/api/positioning/[symbol]`: GEX data for symbol
     - `/api/history/stats`: Historical statistics
     - `/api/monitoring/status`: System health
     - `/api/settings/status`: Configuration status

4. **Authentication System** (`frontend/lib/auth.js`, `src/services/auth.service.ts`)
   - **Purpose**: JWT-based authentication for dashboard access
   - **Technology**: JWT tokens with bcrypt password hashing
   - **Storage**: `users` table in PostgreSQL
   - **Roles**: admin, researcher, user

**Communication Patterns**:
- Inbound: HTTP requests from browser
- Outbound: Database queries, backend API calls

### 1.7 Infrastructure Layer

**Components**:
1. **PostgreSQL Database**
   - **Purpose**: Primary data store for all system state
   - **Technology**: PostgreSQL 14+
   - **Schema**: 15+ tables (signals, orders, trades, positions, shadow tables, etc.)
   - **Deployment**: Managed service (Fly.io Postgres, Supabase, or self-hosted)
   - **Extensions**: pgcrypto for UUID generation

2. **Redis Cache** (Optional)
   - **Purpose**: Distributed caching for dashboard performance
   - **Technology**: Redis 6+
   - **Deployment**: Managed service or self-hosted
   - **Behavior**: System operates without Redis (degrades to node-cache)

3. **Express.js Server** (`src/server.ts`, `src/app.ts`)
   - **Purpose**: HTTP server for webhooks and API endpoints
   - **Technology**: Express.js with TypeScript
   - **Port**: Configured via `PORT` environment variable
   - **Middleware**: CORS, JSON body parser, authentication

4. **Worker Orchestrator** (`src/workers/index.ts`)
   - **Purpose**: Manages lifecycle of all background workers
   - **Technology**: Interval-based scheduling
   - **Workers**: Signal Processor (30s), Order Creator (30s), Paper Executor (30s), Position Refresher (60s), Exit Monitor (60s)
   - **Shutdown**: Graceful shutdown with drain timeout

5. **Logger** (`src/utils/logger.ts`)
   - **Purpose**: Structured logging for all system events
   - **Technology**: Winston logger
   - **Outputs**: Console (development), JSON (production)
   - **Levels**: error, warn, info, debug

6. **Error Tracker** (`src/services/error-tracker.service.ts`)
   - **Purpose**: Tracks error counts by category
   - **Technology**: In-memory counters
   - **Categories**: webhook, signal_processor, order_creator, paper_executor, position_refresher, exit_monitor

7. **Circuit Breaker** (`src/services/circuit-breaker.service.ts`)
   - **Purpose**: Prevents cascading failures from external API calls
   - **Technology**: State machine (closed, open, half-open)
   - **Configuration**: Max failures (5), reset timeout (60s)
   - **Applied To**: All market data providers

8. **Rate Limiter** (`src/services/rate-limiter.service.ts`)
   - **Purpose**: Enforces API rate limits for external providers
   - **Technology**: Token bucket algorithm
   - **Limits**: Alpaca (200/min), Polygon (5/min), TwelveData (8/min), MarketData.app (100/min)

**Communication Patterns**:
- Database: All components connect directly to PostgreSQL
- Redis: Optional connection for caching
- External APIs: Market data providers, broker APIs (future)

---

## 2. Agent & Business Rule Catalog

### 2.1 Engine A (Traditional Rule-Based)

**Architecture**: Engine A does not use an agent system. It applies hardcoded entry and exit rules directly in the Signal Processor Worker and Exit Monitor Worker.

**Entry Logic** (Signal Processor Worker):
- **Location**: `src/workers/signal-processor.ts`
- **Trigger**: Signals with `status='pending'` and routed to Engine A
- **Rules**:
  1. **Market Hours Check**: Signal must arrive during market hours (9:30 AM - 4:00 PM ET)
  2. **Symbol Validation**: Symbol must be in allowed list (SPY, QQQ, IWM, etc.)
  3. **Direction Validation**: Direction must be 'long' or 'short'
  4. **Risk Check**: Position limits not exceeded (max 10 positions, max $10,000 exposure)
  5. **Duplicate Check**: No existing open position for same symbol
- **Output**: Signal status updated to 'approved' or 'rejected'

**Exit Logic** (Exit Monitor Worker):
- **Location**: `src/workers/exit-monitor.ts`, `src/lib/exitEngine/`
- **Trigger**: Positions with `status='open'`
- **Rules** (Four-Tier System):
  
  **Tier 1: Hard Fail Rules** (Immediate Exit):
  - Broker rejection or fill failure
  - Position data corruption
  - Critical system errors
  
  **Tier 2: Protection Rules** (Risk Management):
  - Stop loss: P&L <= -50% (configurable)
  - Max hold time: Position open > 120 hours (configurable)
  - Min DTE: Days to expiration <= 1 (configurable)
  
  **Tier 3: Profit Rules** (Take Profit):
  - Profit target: P&L >= 50% (configurable)
  
  **Tier 4: Degradation Rules** (Greeks-Based):
  - Delta degradation: Delta drops below threshold
  - Gamma degradation: Gamma drops below threshold
  - Theta decay: Theta exceeds threshold
  - Vega collapse: Vega drops below threshold

- **Output**: Position status updated to 'closing' or 'closed', exit reason recorded

**Configuration**:
- Exit rules stored in `exit_rules` table
- Risk limits stored in `risk_limits` table
- Defaults: profit_target=50%, stop_loss=50%, max_hold=120h, min_dte=1

### 2.2 Engine B (Multi-Agent AI)

**Architecture**: Engine B uses a hierarchical multi-agent system with a meta-decision agent orchestrating specialist agents and core agents.

#### 2.2.1 Meta Decision Agent

**Location**: `src/agents/core/meta-decision-agent.ts`

**Purpose**: Orchestrates all agents and aggregates their recommendations into a final decision

**Inputs**:
- Normalized signal (symbol, direction, timeframe, timestamp)
- Market context from Context Agent
- Technical analysis from Technical Agent
- Risk assessment from Risk Agent
- Specialist recommendations (ORB, Strat, TTM, Gamma Flow)
- Sub-agent recommendations (Satyland)

**Decision Logic**:
1. Collect recommendations from all active agents
2. Apply agent-specific weights to each recommendation
3. Calculate weighted confidence score (0-100)
4. Apply Risk Agent veto if risk score too high
5. Determine final action: ENTER, SKIP, or REJECT

**Weighting System**:
- Context Agent: 20%
- Technical Agent: 25%
- Risk Agent: 30% (with veto power)
- ORB Specialist: 10%
- Strat Specialist: 5%
- TTM Specialist: 5%
- Gamma Flow Specialist: 5%
- Satyland Sub-Agent: Variable (if enabled)

**Outputs**:
- Final decision: ENTER, SKIP, REJECT
- Confidence score: 0-100
- Contributing agents: List of agents that participated
- Rejection reason: If rejected

**Triggering Conditions**:
- Webhook signal routed to Engine B
- Feature flag `enable_variant_b=true`
- Signal passes initial validation


#### 2.2.2 Context Agent

**Location**: `src/agents/core/context-agent.ts`

**Purpose**: Provides market context including GEX regime, options flow, and market conditions

**Inputs**:
- Symbol
- Current market data
- GEX data from Positioning Service
- Options flow data from Market Data Service

**Analysis**:
1. **GEX Regime Detection**:
   - Long Gamma: Dealers hedging suppresses volatility
   - Short Gamma: Dealers hedging amplifies volatility
   - Neutral: Balanced positioning
2. **Options Flow Analysis**:
   - Bullish flow: High call volume
   - Bearish flow: High put volume
   - Neutral flow: Balanced
3. **Market Hours Context**:
   - Pre-market, market hours, after-hours
   - Minutes until market close

**Outputs**:
- Market regime: trending, ranging, volatile
- GEX regime: long_gamma, short_gamma, neutral
- Options flow sentiment: bullish, bearish, neutral
- Confidence score: 0-100

**Triggering Conditions**:
- Meta Decision Agent requests context
- Feature flag `enable_variant_b=true`

#### 2.2.3 Technical Agent

**Location**: `src/agents/core/technical-agent.ts`

**Purpose**: Analyzes technical indicators and price action

**Inputs**:
- Symbol
- Timeframe
- Candle data (200 bars)
- Derived indicators (RSI, MACD, Bollinger Bands, ATR)

**Analysis**:
1. **Trend Detection**:
   - Uptrend: Price above moving averages, MACD positive
   - Downtrend: Price below moving averages, MACD negative
   - Sideways: Price oscillating around moving averages
2. **Momentum Analysis**:
   - RSI overbought (>70), oversold (<30), neutral
   - MACD crossovers (bullish, bearish)
3. **Volatility Analysis**:
   - Bollinger Band width
   - ATR levels
4. **Support/Resistance**:
   - Recent highs/lows
   - Bollinger Band levels

**Outputs**:
- Trend direction: up, down, sideways
- Momentum: strong, weak, neutral
- Volatility: high, low, normal
- Confidence score: 0-100

**Triggering Conditions**:
- Meta Decision Agent requests technical analysis
- Feature flag `enable_variant_b=true`

#### 2.2.4 Risk Agent

**Location**: `src/agents/core/risk-agent.ts`

**Purpose**: Evaluates risk and has veto power over trades

**Inputs**:
- Signal details
- Current open positions
- Risk limits from database
- Market volatility

**Risk Checks**:
1. **Position Limits**:
   - Max positions: 10 (configurable)
   - Max positions per symbol: 3 (configurable)
2. **Exposure Limits**:
   - Max total exposure: $10,000 (configurable)
   - Max exposure per position: $1,000 (configurable)
3. **Volatility Checks**:
   - ATR threshold
   - Bollinger Band width threshold
4. **Correlation Checks**:
   - Avoid over-concentration in correlated symbols

**Outputs**:
- Risk score: 0-100 (higher = riskier)
- Veto decision: true/false
- Risk factors: List of identified risks
- Confidence score: 0-100

**Veto Conditions**:
- Risk score > 80
- Position limits exceeded
- Exposure limits exceeded
- Critical risk factors present

**Triggering Conditions**:
- Meta Decision Agent requests risk assessment
- Feature flag `enable_variant_b=true`

#### 2.2.5 Specialist Agents

**ORB Specialist** (`src/agents/specialists/orb-specialist.ts`):
- **Purpose**: Opening Range Breakout strategy
- **Logic**: Detects breakouts from first 30-minute range
- **Inputs**: Candle data, opening range high/low
- **Outputs**: Recommendation (ENTER/SKIP), confidence score
- **Triggering**: Feature flag `enable_orb_specialist=true`

**Strat Specialist** (`src/agents/specialists/strat-specialist.ts`):
- **Purpose**: Strat pattern recognition
- **Logic**: Identifies Strat patterns (2U, 2D, 3, etc.)
- **Inputs**: Candle data, pattern definitions
- **Outputs**: Recommendation (ENTER/SKIP), confidence score
- **Triggering**: Feature flag `enable_strat_specialist=true`

**TTM Specialist** (`src/agents/specialists/ttm-specialist.ts`):
- **Purpose**: TTM Squeeze indicator
- **Logic**: Detects squeeze conditions and breakouts
- **Inputs**: Bollinger Bands, Keltner Channels
- **Outputs**: Recommendation (ENTER/SKIP), confidence score
- **Triggering**: Feature flag `enable_ttm_specialist=true`

**Gamma Flow Specialist** (`src/agents/specialists/gamma-flow-specialist.ts`):
- **Purpose**: GEX-based positioning analysis
- **Logic**: Analyzes dealer positioning and gamma exposure
- **Inputs**: GEX data, zero gamma level, dealer position
- **Outputs**: Recommendation (ENTER/SKIP), confidence score
- **Triggering**: Feature flag `enable_variant_b=true` (always active in Engine B)

#### 2.2.6 Sub-Agents

**Satyland Sub-Agent** (`src/agents/subagents/satyland-sub-agent.ts`):
- **Purpose**: Additional analysis layer (experimental)
- **Logic**: Custom analysis logic
- **Inputs**: Signal, market data, context
- **Outputs**: Recommendation (ENTER/SKIP), confidence score
- **Triggering**: Feature flag `enable_satyland_subagent=true`

### 2.3 Agent Activation Flow

**Engine B Decision Flow**:
1. Webhook received and validated
2. Strategy Router determines Engine B routing
3. Meta Decision Agent invoked
4. Meta Decision Agent activates:
   - Context Agent (always)
   - Technical Agent (always)
   - Risk Agent (always)
   - ORB Specialist (if flag enabled)
   - Strat Specialist (if flag enabled)
   - TTM Specialist (if flag enabled)
   - Gamma Flow Specialist (always)
   - Satyland Sub-Agent (if flag enabled)
5. Each agent returns recommendation + confidence
6. Meta Decision Agent aggregates using weighted voting
7. Risk Agent veto applied if necessary
8. Final decision recorded in `shadow_decisions` table
9. If ENTER, Shadow Executor creates shadow trade

**Timing**: Entire flow executes synchronously during webhook request (typically 500-800ms)

---

## 3. End-to-End Flow Mapping

### 3.1 Complete Webhook-to-UI Flow

```mermaid
sequenceDiagram
    participant TV as TradingView
    participant WH as Webhook Handler
    participant DB as PostgreSQL
    participant SR as Strategy Router
    participant EA as Engine A (Signal Processor)
    participant EB as Engine B (Meta Agent)
    participant OC as Order Creator
    participant PE as Paper Executor
    participant PR as Position Refresher
    participant EM as Exit Monitor
    participant UI as Dashboard UI

    TV->>WH: POST /webhook (signal)
    WH->>WH: Validate HMAC signature
    WH->>WH: Calculate signal hash
    WH->>DB: INSERT signals (with hash)
    DB-->>WH: Duplicate check (unique constraint)
    WH->>DB: INSERT webhook_events (audit log)
    
    alt Engine B Routing
        WH->>SR: Route signal
        SR->>EB: Invoke Meta Decision Agent
        EB->>EB: Activate all agents
        EB->>DB: INSERT shadow_decisions
        alt Decision = ENTER
            EB->>DB: INSERT shadow_trades
            EB->>DB: INSERT shadow_positions
        end
        EB-->>WH: Return decision
    end
    
    WH-->>TV: 200 OK
    
    Note over EA: Every 30 seconds
    EA->>DB: SELECT signals WHERE status='pending'
    EA->>EA: Enrich with market data
    EA->>EA: Apply entry rules
    EA->>DB: INSERT refactored_signals
    EA->>DB: UPDATE signals SET status='approved'
    
    Note over OC: Every 30 seconds
    OC->>DB: SELECT signals WHERE status='approved'
    OC->>OC: Calculate strike price
    OC->>OC: Format option symbol
    OC->>DB: INSERT orders
    
    Note over PE: Every 30 seconds
    PE->>DB: SELECT orders WHERE status='pending_execution'
    PE->>PE: Fetch current option price
    PE->>DB: INSERT trades (simulated fill)
    PE->>DB: INSERT refactored_positions
    PE->>DB: UPDATE orders SET status='filled'
    
    Note over PR: Every 60 seconds
    PR->>DB: SELECT refactored_positions WHERE status='open'
    PR->>PR: Fetch current prices
    PR->>PR: Calculate P&L
    PR->>DB: UPDATE refactored_positions (price, pnl)
    
    Note over EM: Every 60 seconds
    EM->>DB: SELECT refactored_positions WHERE status='open'
    EM->>EM: Evaluate exit rules
    alt Exit Condition Met
        EM->>EM: Fetch current price
        EM->>DB: UPDATE refactored_positions SET status='closed'
    end
    
    Note over UI: User loads dashboard
    UI->>UI: GET /api/dashboard/metrics
    UI->>DB: SELECT positions, orders, signals
    UI->>DB: SELECT shadow_positions, shadow_trades
    UI->>DB: Aggregate P&L, metrics
    UI-->>UI: Render dashboard
```


### 3.2 Step-by-Step Flow Description

**Phase 1: Webhook Ingestion** (0-100ms)
1. TradingView sends POST request to `/webhook` endpoint
2. Webhook handler extracts payload and signature
3. HMAC-SHA256 signature validated (if secret configured)
4. Signal hash calculated using SHA-256(symbol + direction + timestamp)
5. Signal inserted into `signals` table with `status='pending'`
6. Duplicate check enforced by unique constraint on `signal_hash`
7. Webhook event logged to `webhook_events` table
8. If duplicate, return 200 OK immediately (TradingView sees success)

**Phase 2: Engine Routing** (100-200ms)
1. Strategy Router calculates routing hash from signal
2. Hash compared to `AB_SPLIT_PERCENTAGE` threshold
3. If hash % 100 < threshold: Route to Engine A
4. If hash % 100 >= threshold: Route to Engine B
5. Routing decision ensures consistent assignment per signal

**Phase 3a: Engine B Processing** (200-800ms, synchronous)
1. Meta Decision Agent invoked with signal
2. Context Agent fetches GEX data and options flow
3. Technical Agent fetches candles and calculates indicators
4. Risk Agent checks position limits and exposure
5. Specialist agents activated based on feature flags
6. Each agent returns recommendation + confidence score
7. Meta Decision Agent calculates weighted confidence
8. Risk Agent veto applied if risk score > 80
9. Final decision recorded in `shadow_decisions` table
10. If decision = ENTER:
    - Shadow Executor calculates strike price
    - Shadow Executor fetches current option price
    - Shadow trade inserted into `shadow_trades` table
    - Shadow position inserted into `shadow_positions` table
11. Webhook handler returns 200 OK to TradingView

**Phase 3b: Engine A Processing** (Asynchronous, 30s later)
1. Signal Processor Worker polls `signals` table
2. Finds signals with `status='pending'` and routed to Engine A
3. Fetches current market data (price, candles, indicators)
4. Applies entry rules (market hours, symbol validation, risk checks)
5. If approved:
   - Enriched data inserted into `refactored_signals` table
   - Signal status updated to 'approved'
6. If rejected:
   - Rejection reason recorded in `refactored_signals` table
   - Signal status updated to 'rejected'

**Phase 4: Order Creation** (Asynchronous, 30s after approval)
1. Order Creator Worker polls `signals` table
2. Finds signals with `status='approved'`
3. Calculates strike price:
   - Fetches current stock price
   - Rounds to nearest $5 strike (calls: round up, puts: round down)
4. Calculates expiration date:
   - Finds next Friday (or following Monday if Friday is holiday)
5. Formats option symbol: `SPY250117C00600000` (OCC format)
6. Inserts order into `orders` table with `status='pending_execution'`

**Phase 5: Trade Execution** (Asynchronous, 30s after order creation)
1. Paper Executor Worker polls `orders` table
2. Finds orders with `status='pending_execution'`
3. Fetches current option price from market data providers
4. Simulates fill at current mid price
5. Inserts trade record into `trades` table
6. Inserts position record into `refactored_positions` table with `status='open'`
7. Updates order status to 'filled'

**Phase 6: Position Monitoring** (Continuous, every 60s)
1. Position Refresher Worker polls `refactored_positions` table
2. Finds positions with `status='open'`
3. Fetches current option price for each position
4. Calculates unrealized P&L: (current_price - entry_price) * quantity * 100
5. Calculates P&L percentage: (unrealized_pnl / cost_basis) * 100
6. Updates position with current_price, unrealized_pnl, position_pnl_percent

**Phase 7: Exit Monitoring** (Continuous, every 60s)
1. Exit Monitor Worker polls `refactored_positions` table
2. Finds positions with `status='open'`
3. Fetches active exit rules from `exit_rules` table
4. For each position, evaluates exit conditions:
   - Tier 1: Hard fail (data corruption, system errors)
   - Tier 2: Protection (stop loss, time stop, DTE exit)
   - Tier 3: Profit (profit target)
   - Tier 4: Degradation (Greeks thresholds)
5. If exit condition met:
   - Fetches current option price
   - Calculates realized P&L
   - Updates position status to 'closed'
   - Records exit_reason and exit_timestamp

**Phase 8: UI Display** (On-demand, user-initiated)
1. User loads dashboard in browser
2. Browser sends GET request to `/api/dashboard/metrics`
3. Dashboard API fetches data in parallel:
   - Open positions from `refactored_positions`
   - Shadow positions from `shadow_positions`
   - Exit signals (calculated from positions + exit rules)
   - Queued signals from `signals` WHERE status='pending'
   - Source performance (aggregated from `signals`)
   - GEX data (cached from Positioning Service)
   - P&L curve (aggregated from closed positions)
   - Daily returns (aggregated from closed positions)
4. Data cached in Redis (if available) with TTLs:
   - Positions: No cache (real-time)
   - GEX: 5-minute TTL
   - Source performance: 10-minute TTL
   - P&L curve: 15-minute TTL
5. Dashboard API returns aggregated JSON response
6. Browser renders dashboard with charts and metrics

**Timing Summary**:
- Webhook to Database: 50-100ms
- Engine B Decision: 500-800ms (synchronous)
- Engine A Approval: 30-60 seconds (asynchronous)
- Order Creation: 30-60 seconds after approval
- Trade Execution: 30-60 seconds after order creation
- Position Updates: Every 60 seconds
- Exit Monitoring: Every 60 seconds
- Total Time (Webhook to Open Position): 2-4 minutes for Engine A, <1 second for Engine B shadow trades

---



---

## 4. Data Contracts & Schemas

### 4.1 Database Schema

**Engine 1 Tables** (Traditional Processing):

```sql
-- signals: Incoming webhook signals
CREATE TABLE signals (
  signal_id UUID PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  direction VARCHAR(10) CHECK (direction IN ('long', 'short')),
  timeframe VARCHAR(10) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) CHECK (status IN ('pending', 'approved', 'rejected')),
  raw_payload JSONB,
  signal_hash VARCHAR(64),  -- Added in migration 003
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- refactored_signals: Enriched signal data
CREATE TABLE refactored_signals (
  refactored_signal_id UUID PRIMARY KEY,
  signal_id UUID REFERENCES signals(signal_id),
  enriched_data JSONB,
  risk_check_result JSONB,
  rejection_reason TEXT,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- orders: All orders (paper and live)
CREATE TABLE orders (
  order_id UUID PRIMARY KEY,
  signal_id UUID REFERENCES signals(signal_id),
  symbol VARCHAR(20) NOT NULL,
  option_symbol VARCHAR(50) NOT NULL,
  strike DECIMAL(10, 2) NOT NULL,
  expiration DATE NOT NULL,
  type VARCHAR(10) CHECK (type IN ('call', 'put')),
  quantity INTEGER CHECK (quantity > 0),
  order_type VARCHAR(20) CHECK (order_type IN ('paper', 'live')),
  status VARCHAR(20) CHECK (status IN ('pending_execution', 'filled', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- trades: Executed trade records
CREATE TABLE trades (
  trade_id UUID PRIMARY KEY,
  order_id UUID REFERENCES orders(order_id),
  fill_price DECIMAL(10, 4) NOT NULL,
  fill_quantity INTEGER NOT NULL,
  fill_timestamp TIMESTAMPTZ NOT NULL,
  commission DECIMAL(10, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- refactored_positions: Position tracking with P&L
CREATE TABLE refactored_positions (
  position_id UUID PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  option_symbol VARCHAR(50) NOT NULL,
  strike DECIMAL(10, 2) NOT NULL,
  expiration DATE NOT NULL,
  type VARCHAR(10) CHECK (type IN ('call', 'put')),
  quantity INTEGER CHECK (quantity > 0),
  entry_price DECIMAL(10, 4) NOT NULL,
  current_price DECIMAL(10, 4),
  unrealized_pnl DECIMAL(10, 2),
  realized_pnl DECIMAL(10, 2),
  position_pnl_percent DECIMAL(10, 2),  -- Added in migration 004
  status VARCHAR(20) CHECK (status IN ('open', 'closing', 'closed')),
  entry_timestamp TIMESTAMPTZ NOT NULL,
  exit_timestamp TIMESTAMPTZ,
  exit_reason TEXT,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- exit_rules: Exit condition configuration
CREATE TABLE exit_rules (
  rule_id UUID PRIMARY KEY,
  rule_name VARCHAR(50) NOT NULL,
  profit_target_percent DECIMAL(5, 2),
  stop_loss_percent DECIMAL(5, 2),
  max_hold_time_hours INTEGER,
  min_dte_exit INTEGER,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- risk_limits: Risk management configuration
CREATE TABLE risk_limits (
  limit_id UUID PRIMARY KEY,
  max_position_size INTEGER,
  max_total_exposure DECIMAL(10, 2),
  max_exposure_percent DECIMAL(5, 2),
  max_positions_per_symbol INTEGER,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Engine 2 Tables** (Multi-Agent System):

```sql
-- experiments: A/B test assignments
CREATE TABLE experiments (
  experiment_id UUID PRIMARY KEY,
  signal_id UUID REFERENCES signals(signal_id),
  variant VARCHAR(1) CHECK (variant IN ('A', 'B')),
  assignment_hash VARCHAR(64) NOT NULL,
  split_percentage INTEGER CHECK (split_percentage >= 0 AND split_percentage <= 100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- agent_decisions: Individual agent outputs
CREATE TABLE agent_decisions (
  decision_id UUID PRIMARY KEY,
  experiment_id UUID REFERENCES experiments(experiment_id),
  signal_id UUID REFERENCES signals(signal_id),
  agent_name VARCHAR(50) NOT NULL,
  agent_type VARCHAR(20) CHECK (agent_type IN ('core', 'specialist', 'subagent')),
  bias VARCHAR(20) CHECK (bias IN ('bullish', 'bearish', 'neutral')),
  confidence INTEGER CHECK (confidence >= 0 AND confidence <= 100),
  reasons JSONB,
  block BOOLEAN DEFAULT false,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- shadow_trades: Simulated Engine 2 trades
CREATE TABLE shadow_trades (
  shadow_trade_id UUID PRIMARY KEY,
  experiment_id UUID REFERENCES experiments(experiment_id),
  signal_id UUID REFERENCES signals(signal_id),
  symbol VARCHAR(20) NOT NULL,
  option_symbol VARCHAR(50) NOT NULL,
  strike DECIMAL(10, 2) NOT NULL,
  expiration DATE NOT NULL,
  type VARCHAR(10) CHECK (type IN ('call', 'put')),
  quantity INTEGER CHECK (quantity > 0),
  entry_price DECIMAL(10, 4) NOT NULL,
  entry_timestamp TIMESTAMPTZ NOT NULL,
  contributing_agents JSONB,
  meta_confidence INTEGER CHECK (meta_confidence >= 0 AND meta_confidence <= 100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- shadow_positions: Simulated Engine 2 positions
CREATE TABLE shadow_positions (
  shadow_position_id UUID PRIMARY KEY,
  shadow_trade_id UUID REFERENCES shadow_trades(shadow_trade_id),
  symbol VARCHAR(20) NOT NULL,
  option_symbol VARCHAR(50) NOT NULL,
  strike DECIMAL(10, 2) NOT NULL,
  expiration DATE NOT NULL,
  type VARCHAR(10) CHECK (type IN ('call', 'put')),
  quantity INTEGER CHECK (quantity > 0),
  entry_price DECIMAL(10, 4) NOT NULL,
  current_price DECIMAL(10, 4),
  unrealized_pnl DECIMAL(10, 2),
  realized_pnl DECIMAL(10, 2),
  status VARCHAR(20) CHECK (status IN ('open', 'closing', 'closed')),
  entry_timestamp TIMESTAMPTZ NOT NULL,
  exit_timestamp TIMESTAMPTZ,
  exit_reason TEXT,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- agent_performance: Agent performance metrics
CREATE TABLE agent_performance (
  performance_id UUID PRIMARY KEY,
  agent_name VARCHAR(50) NOT NULL UNIQUE,
  total_signals INTEGER DEFAULT 0,
  approved_signals INTEGER DEFAULT 0,
  rejected_signals INTEGER DEFAULT 0,
  avg_confidence DECIMAL(5, 2),
  win_rate DECIMAL(5, 2),
  avg_win DECIMAL(10, 2),
  avg_loss DECIMAL(10, 2),
  expectancy DECIMAL(10, 2),
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- feature_flags: Runtime feature toggles
CREATE TABLE feature_flags (
  flag_id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT false,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by VARCHAR(100)
);
```

**Additional Tables** (from other migrations):

```sql
-- webhook_events: Webhook event logging (migration 003)
CREATE TABLE webhook_events (
  event_id UUID PRIMARY KEY,
  request_id UUID NOT NULL,
  signal_id UUID REFERENCES signals(signal_id),
  experiment_id UUID REFERENCES experiments(experiment_id),
  variant VARCHAR(1),
  status VARCHAR(20),
  error_message TEXT,
  symbol VARCHAR(20),
  direction VARCHAR(10),
  timeframe VARCHAR(10),
  processing_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- users: User authentication (migration 006)
CREATE TABLE users (
  user_id UUID PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) CHECK (role IN ('admin', 'researcher', 'user')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ
);

-- gex_snapshots: GEX data persistence (migration 005)
CREATE TABLE gex_snapshots (
  snapshot_id UUID PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  net_gex DECIMAL(20, 2),
  total_call_gex DECIMAL(20, 2),
  total_put_gex DECIMAL(20, 2),
  zero_gamma_level DECIMAL(10, 2),
  dealer_position VARCHAR(20),
  volatility_expectation VARCHAR(20),
  levels JSONB,
  source VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- options_flow_snapshots: Options flow persistence (migration 005)
CREATE TABLE options_flow_snapshots (
  snapshot_id UUID PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  total_call_volume BIGINT,
  total_put_volume BIGINT,
  entries JSONB,
  source VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.2 Key Data Transformations

**Webhook Payload → Signal Record**:
```typescript
// Input: Raw webhook payload
{
  symbol?: string,
  ticker?: string,
  direction?: string | "BUY" | "SELL",
  timeframe?: string | number,
  timestamp?: string | number
}

// Transformation:
// - Normalize direction: "BUY"/"long"/"bull" → "long", "SELL"/"short"/"bear" → "short"
// - Normalize timeframe: "5" → "5m", "60" → "1h"
// - Normalize timestamp: Unix/ISO → Date object
// - Generate signal hash: SHA-256(symbol:direction:timeframe:timestamp)

// Output: Signal record
{
  signal_id: UUID,
  symbol: string,
  direction: "long" | "short",
  timeframe: string,
  timestamp: Date,
  status: "pending",
  raw_payload: JSONB,
  signal_hash: string
}
```

**Signal → Enriched Signal**:
```typescript
// Input: Signal record + Market data
// Output: Enriched signal in refactored_signals
{
  refactored_signal_id: UUID,
  signal_id: UUID,
  enriched_data: {
    symbol: string,
    timeframe: string,
    currentPrice: number,
    indicators: {
      ema8: number[],
      ema21: number[],
      rsi: number[],
      atr: number[]
    },
    candlesCount: number,
    gex?: GexData,
    optionsFlow?: OptionsFlowSummary
  },
  risk_check_result: {
    marketOpen: boolean,
    openPositions: number,
    maxOpenPositions: number,
    positionLimitExceeded: boolean
  },
  rejection_reason?: string
}
```

**Approved Signal → Order**:
```typescript
// Input: Approved signal + Current price
// Transformation:
// - Calculate strike: ceil(price) for long, floor(price) for short
// - Calculate expiration: Next Friday + DTE days
// - Build option symbol: SYMBOL-YYYYMMDD-TYPE-STRIKE

// Output: Order record
{
  order_id: UUID,
  signal_id: UUID,
  symbol: string,
  option_symbol: string,  // e.g., "SPY-20260213-CALL-451.00"
  strike: number,
  expiration: Date,
  type: "call" | "put",
  quantity: number,
  order_type: "paper" | "live",
  status: "pending_execution"
}
```

**Order → Trade → Position**:
```typescript
// Input: Pending order + Option price
// Output 1: Trade record
{
  trade_id: UUID,
  order_id: UUID,
  fill_price: number,
  fill_quantity: number,
  fill_timestamp: Date,
  commission: number
}

// Output 2: Position record
{
  position_id: UUID,
  symbol: string,
  option_symbol: string,
  strike: number,
  expiration: Date,
  type: "call" | "put",
  quantity: number,
  entry_price: number,
  current_price: number,
  unrealized_pnl: number,
  position_pnl_percent: number,
  status: "open",
  entry_timestamp: Date
}
```


---

## 5. Service Boundaries & Responsibilities

### 5.1 Actual Responsibilities by Layer

**Ingestion Layer**:
- **Should Own**: Webhook validation, signature verification, initial storage, duplicate detection
- **Currently Owns**: All of the above PLUS:
  - Engine B agent execution (synchronous during webhook handling)
  - Market data fetching for Engine B
  - Shadow execution triggering
- **Leakage Detected**: 
  - **VIOLATION**: Engine B processing embedded in webhook handler (should be separate service)
  - **VIOLATION**: Market data fetching in webhook handler (should be in processing layer)
  - **REASON**: Performance optimization - Engine B requires immediate processing for A/B comparison

**Processing Layer (Workers)**:
- **Should Own**: Signal enrichment, risk checks, normalization, routing
- **Currently Owns**: All of the above for Engine A only
- **Leakage Detected**:
  - **GAP**: Engine B signals bypass Signal Processor Worker entirely
  - **INCONSISTENCY**: Engine A uses async workers, Engine B uses sync webhook processing
  - **REASON**: Architectural difference between engines

**Decision Layer**:
- **Should Own**: Trading decisions, strategy logic, signal evaluation
- **Currently Owns**: 
  - Engine A: Entry/exit engines, strike selection (via API, not used by workers)
  - Engine B: Agent swarm, meta-decision aggregation
- **Leakage Detected**:
  - **VIOLATION**: Simple strike selection logic in Order Creator Worker (should use Strike Selection Module)
  - **REASON**: Simplicity prioritized over sophistication

**Execution Layer**:
- **Should Own**: Order construction, broker communication, fill tracking
- **Currently Owns**: Order creation, paper execution, no real broker integration
- **Leakage Detected**:
  - **VIOLATION**: Strike calculation in Order Creator (should be in Decision Layer)
  - **VIOLATION**: Expiration calculation in Order Creator (should be in Decision Layer)
  - **REASON**: Convenience - all order logic centralized in one worker

**Trade Management Layer**:
- **Should Own**: Position tracking, P&L calculation, exit monitoring
- **Currently Owns**: All of the above
- **Leakage Detected**: None - clean separation

**UI Layer**:
- **Should Own**: Presentation, user interaction, client-side state
- **Currently Owns**: All of the above
- **Leakage Detected**: None - no business logic in UI

### 5.2 Responsibility Overlaps

**P&L Calculation** (Duplicate Logic):
- **Location 1**: Position Refresher Worker (unrealized P&L)
- **Location 2**: Paper Executor Worker (realized P&L)
- **Location 3**: Exit Monitor Worker (unrealized P&L for exit decisions)
- **Location 4**: Dashboard Endpoint (aggregated P&L)
- **Formula**: Same formula used in all locations: `(price_diff) * quantity * 100`
- **Risk**: Formula changes must be synchronized across 4 locations
- **Recommendation**: Extract to shared P&L calculation service

**Strike Calculation** (Duplicate Logic):
- **Location 1**: Order Creator Worker (simple ceil/floor)
- **Location 2**: Strike Selection Module (sophisticated delta-based)
- **Location 3**: Shadow Executor (simple ceil/floor, duplicates Order Creator)
- **Risk**: Inconsistent strike selection between Engine A and Engine B
- **Actual Behavior**: Workers use simple logic, module unused

**Market Data Fetching** (Duplicate Logic):
- **Location 1**: Webhook handler (for Engine B)
- **Location 2**: Signal Processor Worker (for Engine A)
- **Location 3**: Position Refresher Worker (for P&L updates)
- **Location 4**: Exit Monitor Worker (for exit decisions)
- **Shared Service**: Market Data Service provides unified interface
- **Risk**: Minimal - well-abstracted through service layer

### 5.3 Boundary Violations Summary

| Violation | Location | Should Be In | Currently In | Severity | Reason |
|-----------|----------|--------------|--------------|----------|--------|
| Engine B Processing | Webhook Handler | Separate Service | Ingestion Layer | High | Performance optimization |
| Strike Calculation | Order Creator | Decision Layer | Execution Layer | Medium | Convenience |
| Expiration Calculation | Order Creator | Decision Layer | Execution Layer | Medium | Convenience |
| Market Data Fetch | Webhook Handler | Processing Layer | Ingestion Layer | Medium | Engine B requirement |
| P&L Formula Duplication | 4 locations | Shared Service | Multiple layers | Low | Code duplication |

---

## 6. Execution & Trade Lifecycle

### 6.1 Order State Machine

```mermaid
stateDiagram-v2
    [*] --> pending_execution: Order Created
    pending_execution --> filled: Option Price Retrieved
    pending_execution --> failed: Price Fetch Failed
    filled --> [*]: Trade Record Created
    failed --> [*]: Error Logged
    
    note right of pending_execution
        Order Creator Worker
        creates orders with
        status=pending_execution
    end note
    
    note right of filled
        Paper Executor Worker
        fetches price and
        updates to filled
    end note
    
    note right of failed
        After 3 retry attempts
        or database error
    end note
```

**State Transitions**:

1. **pending_execution → filled**
   - **Trigger**: Paper Executor Worker successfully fetches option price
   - **Validation**: Price > 0, valid option symbol
   - **Side Effects**: 
     - Create trade record with fill_price, fill_quantity, fill_timestamp
     - Create or update position record
     - Update order status to 'filled'
   - **Timing**: 10-second intervals (Paper Executor runs every 10s)

2. **pending_execution → failed**
   - **Trigger**: Option price fetch fails after 3 retries OR database error
   - **Validation**: None
   - **Side Effects**:
     - Update order status to 'failed'
     - Log error with order_id
     - Increment error tracker counter
   - **Recovery**: Manual intervention required

### 6.2 Position State Machine

```mermaid
stateDiagram-v2
    [*] --> open: Position Created
    open --> closing: Exit Rule Triggered
    closing --> closed: Exit Order Filled
    open --> closed: Manual Close
    closed --> [*]: Final State
    
    note right of open
        Paper Executor creates
        position with entry_price
        Status refreshed every 60s
    end note
    
    note right of closing
        Exit Monitor detects:
        - Profit target
        - Stop loss
        - Time stop
        - DTE exit
    end note
    
    note right of closed
        Realized P&L calculated
        Exit timestamp recorded
    end note
```

**State Transitions**:

1. **[*] → open**
   - **Trigger**: Paper Executor fills entry order
   - **Validation**: Valid option symbol, price > 0, quantity > 0
   - **Side Effects**:
     - Create position record with entry_price, entry_timestamp
     - Set status='open'
     - Initialize unrealized_pnl=0
   - **Data**: entry_price, quantity, option_symbol, expiration, type

2. **open → closing**
   - **Trigger**: Exit Monitor detects exit condition
   - **Validation**: Exit rule enabled, condition met
   - **Side Effects**:
     - Update position status to 'closing'
     - Set exit_reason (profit_target, stop_loss, max_hold_time, min_dte_exit)
     - Create exit order with status='pending_execution'
   - **Timing**: 60-second intervals (Exit Monitor runs every 60s)

3. **closing → closed**
   - **Trigger**: Paper Executor fills exit order
   - **Validation**: Exit price > 0
   - **Side Effects**:
     - Calculate realized_pnl: `(exit_price - entry_price) * quantity * 100`
     - Update position status to 'closed'
     - Set exit_timestamp
     - Store realized_pnl
   - **Final State**: Position no longer monitored

4. **open → closed** (Manual Close)
   - **Trigger**: User-initiated close (not currently implemented)
   - **Validation**: Position exists and is open
   - **Side Effects**: Same as closing → closed
   - **Status**: Not implemented in current system

### 6.3 Trade Lifecycle Timing

**Complete Lifecycle Example**:

```
T+0s:    Webhook received (signal created, status=pending)
T+30s:   Signal Processor enriches (status=approved) [Engine A only]
T+60s:   Order Creator creates order (status=pending_execution)
T+70s:   Paper Executor fills order (status=filled, position created)
T+130s:  Position Refresher updates P&L (first update)
T+190s:  Position Refresher updates P&L (second update)
...
T+3600s: Exit Monitor detects profit target (position status=closing)
T+3610s: Paper Executor fills exit (position status=closed, realized P&L)
```

**Timing Variability**:
- Signal to order: 30-60 seconds (depends on worker timing)
- Order to fill: 10-70 seconds (depends on Paper Executor timing)
- Fill to first P&L update: 0-60 seconds (depends on Position Refresher timing)
- Exit trigger to close: 10-70 seconds (depends on Paper Executor timing)
- **Total lifecycle**: Typically 1-4 hours (depends on exit rules)

### 6.4 Error States and Recovery

**Order Failures**:
- **Cause**: Option price unavailable after 3 retries
- **State**: Order status='failed'
- **Recovery**: Manual - create new order or adjust signal
- **Data Integrity**: Signal remains approved, no position created

**Position Inconsistencies**:
- **Cause**: Database error during position creation
- **State**: Order filled but no position record
- **Recovery**: Manual - query trades table and recreate position
- **Prevention**: Database transactions (not currently implemented)

**Worker Failures**:
- **Cause**: Worker crashes or stops
- **State**: Pending records accumulate
- **Recovery**: Automatic - workers resume on restart
- **Data Integrity**: No data loss, processing resumes

**Shadow Position Divergence**:
- **Cause**: Engine B shadow positions not monitored by Exit Monitor
- **State**: Shadow positions remain open indefinitely
- **Recovery**: Shadow Executor has separate monitoring (not integrated with workers)
- **Risk**: Shadow positions may not reflect realistic exits


---

## 9. Failure & Retry Flows

### 9.1 Circuit Breaker Pattern

**Implementation**: Per-provider circuit breakers in Market Data Service

**Configuration**:
- Max Failures: 5 consecutive failures
- Reset Timeout: 60 seconds
- States: closed (normal), open (blocked), half-open (testing)

**State Transitions**:
```mermaid
stateDiagram-v2
    [*] --> Closed: Initial State
    Closed --> Open: 5 Failures
    Open --> HalfOpen: 60s Timeout
    HalfOpen --> Closed: Success
    HalfOpen --> Open: Failure
    Closed --> Closed: Success
    
    note right of Closed
        Normal operation
        All requests allowed
    end note
    
    note right of Open
        Provider blocked
        Requests skipped
        Fallback to next provider
    end note
    
    note right of HalfOpen
        Testing recovery
        One request allowed
    end note
```

**Behavior by Provider**:
- Alpaca: Circuit breaker active
- Polygon: Circuit breaker active
- MarketData.app: Circuit breaker active
- TwelveData: Circuit breaker active

**Fallback Chain**:
1. Primary provider fails → Circuit breaker records failure
2. After 5 failures → Circuit opens, provider skipped
3. Next provider in priority list attempted
4. If all providers fail → Error thrown to caller
5. After 60 seconds → Circuit half-opens, one request allowed
6. Success → Circuit closes, provider restored
7. Failure → Circuit reopens, wait another 60 seconds

### 9.2 Retry Strategy

**Exponential Backoff**:
```typescript
// Retry configuration
{
  retries: 2,  // Max 2 retries (3 total attempts)
  initialDelay: 1000ms,
  backoffMultiplier: 2,
  maxDelay: 5000ms
}

// Retry sequence:
// Attempt 1: Immediate
// Attempt 2: Wait 1000ms
// Attempt 3: Wait 2000ms
```

**Applied To**:
- Market data API calls (candles, quotes, option prices)
- Option price fetching in Paper Executor (3 attempts)
- Database queries (not currently implemented)

**Not Applied To**:
- Webhook handling (no retry, returns error immediately)
- Worker operations (workers retry on next interval)
- Dashboard queries (no retry, returns cached or error)

### 9.3 Failure Modes by Layer

**Ingestion Layer Failures**:

| Failure | Detection | Handling | Recovery | Impact |
|---------|-----------|----------|----------|--------|
| Invalid HMAC | Signature verification | 401 response | None - rejected | Signal not processed |
| Invalid payload | Zod validation | 400 response | None - rejected | Signal not processed |
| Duplicate signal | Database query | 200 DUPLICATE | None - ignored | No duplicate processing |
| Database unavailable | Connection error | 500 response | Retry on next webhook | Signal lost |
| Engine B crash | Exception catch | 500 response | Log error | Signal lost |

**Processing Layer Failures**:

| Failure | Detection | Handling | Recovery | Impact |
|---------|-----------|----------|----------|--------|
| Market data unavailable | API error | Log warning, reject signal | Retry on next worker run | Signal rejected |
| Position limit exceeded | Risk check | Reject signal | None - by design | Signal rejected |
| Database error | Exception catch | Log error, continue | Retry on next worker run | Signal skipped |
| Worker crash | Process exit | None | Restart worker | Pending signals accumulate |

**Execution Layer Failures**:

| Failure | Detection | Handling | Recovery | Impact |
|---------|-----------|----------|----------|--------|
| Option price unavailable | API error after 3 retries | Mark order failed | Manual intervention | Order not filled |
| Database error | Exception catch | Mark order failed | Manual intervention | Order not filled |
| Invalid option symbol | API error | Mark order failed | Manual intervention | Order not filled |
| Worker crash | Process exit | None | Restart worker | Pending orders accumulate |

**Trade Management Failures**:

| Failure | Detection | Handling | Recovery | Impact |
|---------|-----------|----------|----------|--------|
| Position price unavailable | API error | Skip position update | Retry on next worker run | Stale P&L |
| Exit rule evaluation error | Exception catch | Skip position | Retry on next worker run | Exit delayed |
| Database error | Exception catch | Log error | Retry on next worker run | Update skipped |

**UI Layer Failures**:

| Failure | Detection | Handling | Recovery | Impact |
|---------|-----------|----------|----------|--------|
| Dashboard query error | Exception catch | Return partial data | Next poll | Incomplete dashboard |
| Cache unavailable | Redis error | Fall back to database | Next poll | Slower response |
| Authentication failure | JWT verification | 401 response | User re-login | Access denied |

### 9.4 Data Consistency Guarantees

**Webhook Processing**:
- **Guarantee**: At-least-once delivery (TradingView retries on error)
- **Idempotency**: Duplicate detection via signal hash
- **Consistency**: Signal stored before routing decision
- **Risk**: Duplicate signals if hash collision (extremely rare)

**Worker Processing**:
- **Guarantee**: At-least-once processing (workers retry on next interval)
- **Idempotency**: Status checks prevent duplicate processing
- **Consistency**: Status updates atomic per signal/order/position
- **Risk**: Race conditions if multiple workers run (not currently possible)

**Position Updates**:
- **Guarantee**: Eventually consistent (updates every 60 seconds)
- **Idempotency**: Updates overwrite previous values
- **Consistency**: Last-write-wins for current_price and unrealized_pnl
- **Risk**: Stale data if market data provider fails

**Shadow Execution**:
- **Guarantee**: Best-effort (no retry on failure)
- **Idempotency**: One shadow trade per experiment
- **Consistency**: Shadow positions independent of real positions
- **Risk**: Shadow data may be incomplete if execution fails

### 9.5 Graceful Degradation

**Market Data Provider Failure**:
- **Degradation**: Fall back to next provider in priority list
- **User Impact**: Slight latency increase (additional API calls)
- **Recovery**: Automatic via circuit breaker

**Redis Cache Failure**:
- **Degradation**: Fall back to in-memory cache (node-cache)
- **User Impact**: Cache not shared across instances
- **Recovery**: Automatic reconnection attempt

**Optional Data Unavailable** (GEX, Options Flow):
- **Degradation**: Skip optional analysis, continue processing
- **User Impact**: Engine B agents may have reduced confidence
- **Recovery**: Automatic on next request

**Database Slow Queries**:
- **Degradation**: Queries timeout, return partial data
- **User Impact**: Dashboard may show incomplete data
- **Recovery**: Next poll retrieves fresh data

**Worker Overload**:
- **Degradation**: Processing queue grows, latency increases
- **User Impact**: Delayed order creation and execution
- **Recovery**: Workers catch up when load decreases

### 9.6 Monitoring and Alerting

**Current Monitoring**:
- Performance Monitor: Tracks request latency, slow requests
- Error Tracker: Counts errors by component
- Circuit Breaker Status: Available via `/metrics` endpoint
- Cache Statistics: Hit/miss rates, TTL remaining

**Missing Monitoring**:
- Worker queue depth (pending signals, orders, positions)
- Market data provider health (uptime, latency)
- Database connection pool utilization
- Shadow execution success rate
- Agent decision distribution (bias, confidence)

**No Alerting**:
- No automated alerts for failures
- No notifications for circuit breaker opens
- No alerts for worker crashes
- No alerts for database errors
- **Recommendation**: Implement alerting system (email, SMS, PagerDuty)

---

## 10. Configuration Management

### 10.1 Environment Variables

**Required Variables**:
```bash
DATABASE_URL=postgresql://user:password@host:5432/dbname
JWT_SECRET=your-secret-key-min-32-chars
```

**Optional Variables** (with defaults):
```bash
# Server
PORT=8080
NODE_ENV=development
APP_MODE=PAPER

# Redis (optional)
REDIS_URL=rediss://default:password@host:6379

# Authentication
HMAC_SECRET=your-hmac-secret

# Market Data Providers (at least one required)
ALPACA_API_KEY=your-key
ALPACA_SECRET_KEY=your-secret
POLYGON_API_KEY=your-key
TWELVE_DATA_API_KEY=your-key
MARKET_DATA_API_KEY=your-key

# Worker Intervals (milliseconds)
SIGNAL_PROCESSOR_INTERVAL=30000
ORDER_CREATOR_INTERVAL=30000
PAPER_EXECUTOR_INTERVAL=10000
POSITION_REFRESHER_INTERVAL=60000
EXIT_MONITOR_INTERVAL=60000

# Risk Management
MAX_POSITION_SIZE=10
MAX_DAILY_LOSS=1000.00
MAX_OPEN_POSITIONS=5
MAX_EXPOSURE_PERCENT=20.00

# Exit Rules
PROFIT_TARGET_PCT=50.00
STOP_LOSS_PCT=50.00
TIME_STOP_DTE=1
MAX_HOLD_DAYS=5

# A/B Testing
AB_SPLIT_PERCENTAGE=0
ENABLE_VARIANT_B=false

# Feature Flags (Engine 2)
ENABLE_ORB_SPECIALIST=false
ENABLE_STRAT_SPECIALIST=false
ENABLE_TTM_SPECIALIST=false
ENABLE_SATYLAND_SUBAGENT=false
ENABLE_SHADOW_EXECUTION=false
```

### 10.2 Configuration Validation

**Validation Rules**:
- `DATABASE_URL`: Must be valid PostgreSQL connection string
- `JWT_SECRET`: Must be at least 32 characters
- `APP_MODE`: Must be 'PAPER' or 'LIVE'
- `AB_SPLIT_PERCENTAGE`: Must be 0-100
- Worker intervals: Must be positive integers
- Risk limits: Must be positive numbers

**Validation Timing**: On server startup (before workers start)

**Validation Failure**: Server exits with error message

### 10.3 Runtime Configuration

**Database-Stored Configuration**:
- Exit rules: `exit_rules` table
- Risk limits: `risk_limits` table
- Feature flags: `feature_flags` table

**Modification**:
- Exit rules: INSERT new rule, set enabled=true
- Risk limits: INSERT new limit, set enabled=true
- Feature flags: UPDATE enabled column

**Effective Immediately**:
- Workers query database on each run
- Changes take effect on next worker interval
- No server restart required

**Default Values**:
- Exit rules: profit_target=50%, stop_loss=50%, max_hold=120h, min_dte=1
- Risk limits: max_position_size=10, max_exposure=10000, max_positions_per_symbol=3
- Feature flags: All disabled by default

### 10.4 Feature Flag System

**Implementation**: Database-backed feature flags

**Available Flags**:
1. `enable_variant_b`: Master switch for Engine 2
2. `enable_orb_specialist`: ORB specialist agent
3. `enable_strat_specialist`: Strat specialist agent
4. `enable_ttm_specialist`: TTM specialist agent
5. `enable_satyland_subagent`: Satyland sub-agent
6. `enable_shadow_execution`: Shadow trade execution

**Flag Evaluation**:
- Checked on each webhook request (Engine B)
- Checked on agent activation (specialists, sub-agents)
- Cached in memory for performance
- Refreshed periodically (not currently implemented)

**Flag Dependencies**:
- `enable_shadow_execution` requires `enable_variant_b=true`
- Specialist flags require `enable_variant_b=true`
- Sub-agent flags require `enable_variant_b=true`

**Flag Override**:
- Environment variables override database flags
- `ENABLE_VARIANT_B=true` overrides `feature_flags.enable_variant_b`
- Allows emergency disable without database access


---

## 12. Gaps & Risk Assessment

### 12.1 Undocumented Logic

**Implicit Behavior**:
1. **Signal Hash Collision Handling**: No explicit handling if two signals generate same hash
   - **Location**: Webhook handler
   - **Risk**: Duplicate signals could be processed if hash collision occurs
   - **Likelihood**: Extremely low (SHA-256 collision)
   - **Mitigation**: None currently implemented

2. **Worker Concurrency**: No explicit prevention of multiple worker instances
   - **Location**: Worker orchestration
   - **Risk**: Race conditions if multiple servers run same workers
   - **Likelihood**: High in multi-instance deployment
   - **Mitigation**: None currently implemented (assumes single instance)

3. **Shadow Position Exit Monitoring**: Shadow positions not monitored by Exit Monitor Worker
   - **Location**: Shadow Executor
   - **Risk**: Shadow positions remain open indefinitely
   - **Likelihood**: High
   - **Mitigation**: Shadow Executor has separate methods but not integrated

4. **Option Symbol Format Validation**: No validation of generated option symbols
   - **Location**: Order Creator, Shadow Executor
   - **Risk**: Invalid symbols could be created
   - **Likelihood**: Low (format is deterministic)
   - **Mitigation**: None currently implemented

5. **Market Hours Timezone Handling**: Assumes ET timezone for market hours
   - **Location**: MarketData.app client
   - **Risk**: Incorrect market hours if server timezone differs
   - **Likelihood**: Medium
   - **Mitigation**: Hardcoded ET timezone conversion

### 12.2 Hidden Dependencies

**Implicit Couplings**:
1. **Worker Timing Dependencies**: Order Creator depends on Signal Processor completing first
   - **Coupling**: Implicit timing assumption (30s intervals)
   - **Risk**: Orders created before signals enriched if timing misaligned
   - **Mitigation**: Status checks prevent processing unenriched signals

2. **Database Schema Assumptions**: Workers assume specific table structures
   - **Coupling**: Direct SQL queries with hardcoded column names
   - **Risk**: Schema changes break workers
   - **Mitigation**: None (no ORM, no schema validation)

3. **Market Data Provider Availability**: All processing depends on at least one provider working
   - **Coupling**: No offline mode or cached data fallback
   - **Risk**: Complete system halt if all providers fail
   - **Mitigation**: Circuit breaker and fallback chain

4. **Redis Optional but Assumed**: Dashboard assumes Redis for caching
   - **Coupling**: Falls back to in-memory cache but with degraded performance
   - **Risk**: Slow dashboard if Redis unavailable
   - **Mitigation**: Graceful degradation to node-cache

### 12.3 Duplicate Processing

**Identified Duplications**:
1. **P&L Calculation Formula**: Duplicated in 4 locations
   - **Locations**: Position Refresher, Paper Executor, Exit Monitor, Dashboard
   - **Risk**: Formula changes must be synchronized
   - **Severity**: Medium
   - **Recommendation**: Extract to shared utility function

2. **Strike Calculation**: Duplicated in 3 locations
   - **Locations**: Order Creator, Shadow Executor, Strike Selection Module (unused)
   - **Risk**: Inconsistent strike selection
   - **Severity**: Low (simple formula)
   - **Recommendation**: Use Strike Selection Module consistently

3. **Option Symbol Formatting**: Duplicated in 3 locations
   - **Locations**: Order Creator, Shadow Executor, Alpaca Client
   - **Risk**: Format inconsistencies
   - **Severity**: Low (deterministic format)
   - **Recommendation**: Extract to shared utility

4. **Expiration Calculation**: Duplicated in 2 locations
   - **Locations**: Order Creator, Shadow Executor
   - **Risk**: Different expiration dates for real vs shadow trades
   - **Severity**: Low (same logic)
   - **Recommendation**: Extract to shared utility

### 12.4 Schema Inconsistencies

**Field Name Variations**:
1. **Signal ID**: `signal_id` (signals) vs `signalId` (TypeScript)
   - **Impact**: Requires transformation in code
   - **Severity**: Low (handled by ORM-less approach)

2. **Timestamp Fields**: `created_at`, `entry_timestamp`, `fill_timestamp`, `exit_timestamp`
   - **Impact**: Inconsistent naming convention
   - **Severity**: Low (clear from context)

3. **Status Enums**: Different values across tables
   - **signals**: pending, approved, rejected
   - **orders**: pending_execution, filled, failed
   - **positions**: open, closing, closed
   - **Impact**: Cannot join on status
   - **Severity**: Low (different entities)

4. **Price Precision**: DECIMAL(10, 4) for prices, DECIMAL(10, 2) for P&L
   - **Impact**: Potential rounding errors
   - **Severity**: Low (acceptable precision)

### 12.5 Coupling Risks

**Tight Couplings**:
1. **Webhook Handler ↔ Engine B**: Synchronous processing blocks webhook response
   - **Risk**: Slow Engine B processing delays webhook response
   - **Impact**: TradingView timeout, signal loss
   - **Severity**: High
   - **Mitigation**: None (by design for A/B comparison)

2. **Workers ↔ Database Schema**: Direct SQL queries with hardcoded schemas
   - **Risk**: Schema changes break workers
   - **Impact**: Worker failures, processing stops
   - **Severity**: High
   - **Mitigation**: None (no ORM, no abstraction layer)

3. **Market Data Service ↔ Provider APIs**: Direct API calls with provider-specific logic
   - **Risk**: Provider API changes break integration
   - **Impact**: Market data unavailable
   - **Severity**: Medium
   - **Mitigation**: Multiple providers with fallback

4. **Dashboard ↔ Database Schema**: Direct queries with hardcoded column names
   - **Risk**: Schema changes break dashboard
   - **Impact**: Dashboard errors
   - **Severity**: Medium
   - **Mitigation**: None

**Circular Dependencies**:
- None identified

### 12.6 Data Race Conditions

**Potential Race Conditions**:
1. **Concurrent Position Updates**: Position Refresher and Exit Monitor both update positions
   - **Scenario**: Position Refresher updates current_price while Exit Monitor updates status
   - **Risk**: Lost updates (last-write-wins)
   - **Likelihood**: Low (different columns updated)
   - **Mitigation**: None (PostgreSQL row-level locking)

2. **Duplicate Order Creation**: Order Creator may create multiple orders for same signal
   - **Scenario**: Multiple Order Creator instances run simultaneously
   - **Risk**: Duplicate orders for same signal
   - **Likelihood**: High in multi-instance deployment
   - **Mitigation**: None (assumes single instance)

3. **Signal Status Updates**: Signal Processor and Webhook Handler may update same signal
   - **Scenario**: Engine B updates signal while Signal Processor processes it
   - **Risk**: Status inconsistency
   - **Likelihood**: Low (Engine B signals bypass Signal Processor)
   - **Mitigation**: Implicit (different code paths)

4. **Shadow Position Divergence**: Shadow positions not synchronized with real positions
   - **Scenario**: Real position closed but shadow position remains open
   - **Risk**: Inaccurate A/B comparison
   - **Likelihood**: High
   - **Mitigation**: None (separate monitoring required)

### 12.7 Security Risks

**Identified Risks**:
1. **HMAC Secret Optional**: Webhook signature verification can be disabled
   - **Risk**: Unauthorized signals accepted
   - **Severity**: High
   - **Mitigation**: Configuration validation warns if HMAC disabled

2. **JWT Secret Validation**: Requires 32+ characters but no complexity requirements
   - **Risk**: Weak secrets accepted
   - **Severity**: Medium
   - **Mitigation**: Length validation only

3. **SQL Injection**: Direct SQL queries with string interpolation
   - **Risk**: SQL injection if user input not sanitized
   - **Severity**: High
   - **Mitigation**: Parameterized queries used consistently

4. **API Key Exposure**: API keys stored in environment variables
   - **Risk**: Keys exposed in logs or error messages
   - **Severity**: Medium
   - **Mitigation**: Keys redacted in logs

5. **No Rate Limiting**: Webhook endpoint has no rate limiting
   - **Risk**: DoS attacks possible
   - **Severity**: Medium
   - **Mitigation**: None (relies on TradingView rate limiting)

### 12.8 Performance Risks

**Identified Bottlenecks**:
1. **Synchronous Engine B Processing**: Blocks webhook response
   - **Impact**: Slow webhook responses (800ms+)
   - **Risk**: TradingView timeout
   - **Mitigation**: None (by design)

2. **Dashboard Aggregation**: Fetches all data in parallel but no pagination
   - **Impact**: Slow dashboard with many positions
   - **Risk**: Timeout with 500+ positions
   - **Mitigation**: LIMIT clauses (200-500 records)

3. **Position Refresher**: Fetches prices sequentially
   - **Impact**: Slow updates with many positions
   - **Risk**: Stale P&L if many positions
   - **Mitigation**: None (sequential processing)

4. **No Database Indexing Strategy**: Indexes exist but not optimized
   - **Impact**: Slow queries as data grows
   - **Risk**: Performance degradation over time
   - **Mitigation**: Basic indexes on status, timestamps, symbols

5. **No Query Optimization**: Direct queries without optimization
   - **Impact**: Inefficient queries
   - **Risk**: Slow dashboard and workers
   - **Mitigation**: None (no query analysis)

### 12.9 Scalability Risks

**Identified Limitations**:
1. **Single Instance Assumption**: Workers assume single server instance
   - **Impact**: Cannot scale horizontally
   - **Risk**: Duplicate processing if multiple instances
   - **Mitigation**: None (requires distributed locking)

2. **In-Memory Cache**: node-cache not shared across instances
   - **Impact**: Cache misses in multi-instance deployment
   - **Risk**: Increased load on database and APIs
   - **Mitigation**: Redis cache (optional)

3. **No Queue System**: Workers poll database instead of using message queue
   - **Impact**: Inefficient polling, database load
   - **Risk**: Scalability limited by database
   - **Mitigation**: None (requires message queue)

4. **No Load Balancing**: Single server handles all webhooks
   - **Impact**: Limited throughput
   - **Risk**: Cannot handle high signal volume
   - **Mitigation**: None (requires load balancer)

5. **No Sharding Strategy**: Single database for all data
   - **Impact**: Database becomes bottleneck
   - **Risk**: Performance degradation with large datasets
   - **Mitigation**: None (requires sharding strategy)

---

## Summary of Missing Documentation

The following areas have now been documented:

✅ **Database Schema** - Complete table definitions with constraints and indexes  
✅ **Data Transformations** - Field mappings and transformation logic  
✅ **Service Boundaries** - Actual responsibilities and boundary violations  
✅ **State Machines** - Order and position lifecycle with timing  
✅ **Failure & Retry Flows** - Circuit breakers, retry strategies, degradation  
✅ **Configuration Management** - Environment variables, validation, feature flags  
✅ **Gaps & Risk Assessment** - Undocumented logic, coupling, race conditions, security  

**Documentation Now Complete**: All major architectural areas have been documented according to the original discovery prompt requirements.


---

## 7. UI & P&L Calculation

### 7.1 UI Components and Data Flow

**Dashboard Component** (`frontend/components/Dashboard.js`):
- **Purpose**: Main dashboard view displaying portfolio metrics, performance charts, and recent activity
- **Data Source**: `/api/dashboard/metrics` endpoint
- **Refresh**: Manual refresh button + auto-refresh on mount
- **State Management**: React useState hooks for data, status, range selection
- **Loading States**: Skeleton loaders while fetching data
- **Error Handling**: Error message display if API call fails

**Data Flow**:
1. User navigates to dashboard (`/`)
2. Dashboard component mounts
3. `loadData()` function invoked
4. Browser sends GET `/api/dashboard/metrics` with auth token
5. Next.js API route (`frontend/app/api/dashboard/metrics/route.js`) proxies to backend
6. Backend dashboard route (`src/routes/dashboard.ts`) aggregates data
7. Response includes:
   - `positions`: Open positions with current P&L
   - `shadow_positions`: Engine B shadow positions
   - `health`: System health status
   - `exit_signals`: Positions meeting exit conditions
   - `queued_signals`: Pending signals awaiting processing
   - `source_performance`: Signal source acceptance rates
   - `gex`: Gamma exposure data for SPY
   - `pnl_curve`: Cumulative P&L over time
   - `daily_returns`: Daily P&L values
   - `metadata`: Response time, cache hits/misses
8. Dashboard component updates state with response data
9. React re-renders with new data
10. Charts and metrics displayed to user

**Other UI Components**:
- **Orders** (`frontend/components/Orders.js`): Displays order history from `/api/orders`
- **Positions** (`frontend/components/Positioning.js`): Displays position details and GEX data from `/api/positioning/[symbol]`
- **History** (`frontend/components/History.js`): Displays historical statistics from `/api/history/stats`
- **Monitoring** (`frontend/components/Monitoring.js`): Displays system health from `/api/monitoring/status`
- **Settings** (`frontend/components/Settings.js`): Displays configuration status from `/api/settings/status`

### 7.2 P&L Calculation Logic

**P&L is calculated in FOUR locations** (duplication identified):

#### Location 1: Position Refresher Worker (`src/workers/position-refresher.ts`)

**Purpose**: Updates unrealized P&L for open positions

**Formula**:
```typescript
unrealizedPnl = (currentPrice - entryPrice) * quantity * 100
costBasis = entryPrice * quantity * 100
positionPnlPercent = (unrealizedPnl / costBasis) * 100
```

**Data Sources**:
- `entry_price`: From `refactored_positions` table (filled at trade execution)
- `current_price`: Fetched from market data providers (Alpaca, Polygon, MarketData.app, TwelveData)
- `quantity`: From `refactored_positions` table (number of contracts)

**Frequency**: Every 60 seconds for all open positions

**Storage**: Updates `refactored_positions` table columns:
- `current_price`
- `unrealized_pnl`
- `position_pnl_percent`
- `last_updated`

#### Location 2: Paper Executor Worker (`src/workers/paper-executor.ts`)

**Purpose**: Calculates initial P&L when position is opened (always $0)

**Formula**:
```typescript
unrealizedPnl = 0  // Position just opened
realizedPnl = 0    // No exit yet
positionPnlPercent = 0
```

**Data Sources**:
- `entry_price`: Current option price at fill time
- `current_price`: Same as entry_price (just filled)
- `quantity`: From order record

**Frequency**: Once per trade execution

**Storage**: Inserts into `refactored_positions` table with initial values

#### Location 3: Exit Monitor Worker (`src/workers/exit-monitor.ts`)

**Purpose**: Calculates realized P&L when position is closed

**Formula**:
```typescript
realizedPnl = (exitPrice - entryPrice) * quantity * 100
costBasis = entryPrice * quantity * 100
positionPnlPercent = (realizedPnl / costBasis) * 100
```

**Data Sources**:
- `entry_price`: From `refactored_positions` table
- `exit_price`: Fetched from market data providers at exit time
- `quantity`: From `refactored_positions` table

**Frequency**: When exit condition is met

**Storage**: Updates `refactored_positions` table columns:
- `current_price` (set to exit price)
- `realized_pnl`
- `position_pnl_percent`
- `status` (set to 'closed')
- `exit_timestamp`
- `exit_reason`

#### Location 4: Dashboard API Route (`src/routes/dashboard.ts`)

**Purpose**: Calculates P&L for exit signal detection

**Formula**:
```typescript
pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100
```

**Data Sources**:
- `entry_price`: From `refactored_positions` table
- `current_price`: From `refactored_positions` table (updated by Position Refresher)

**Frequency**: On each dashboard API request

**Usage**: Determines if position meets exit conditions for display in exit signals

**Note**: This is a READ-ONLY calculation for display purposes, does not update database

### 7.3 P&L Data Lineage

**Source Data**:
1. **Entry Price**: Captured at trade execution from market data provider mid price
2. **Current Price**: Fetched every 60 seconds from market data providers
3. **Quantity**: Determined at order creation (currently hardcoded to 1 contract)

**Transformations**:
1. **Option Price Fetch**: Market data service with fallback chain (Alpaca → Polygon → MarketData.app → TwelveData)
2. **P&L Calculation**: (current - entry) * quantity * 100 (multiplier for options contracts)
3. **Percentage Calculation**: (pnl / cost_basis) * 100

**Storage**:
- `refactored_positions.entry_price`: DECIMAL(10, 4)
- `refactored_positions.current_price`: DECIMAL(10, 4)
- `refactored_positions.unrealized_pnl`: DECIMAL(10, 2)
- `refactored_positions.realized_pnl`: DECIMAL(10, 2)
- `refactored_positions.position_pnl_percent`: DECIMAL(10, 2)

**Display**:
- Dashboard: Aggregated metrics (total P&L, win rate, avg P&L)
- Positions: Individual position P&L with percentage
- History: Historical P&L curve and daily returns

### 7.4 UI Data Refresh Mechanisms

**Real-Time Updates** (No Caching):
- Open positions: Fetched on every dashboard load
- Shadow positions: Fetched on every dashboard load
- Exit signals: Calculated on every dashboard load
- Queued signals: Fetched on every dashboard load

**Cached Updates** (Redis with TTL):
- GEX data: 5-minute TTL
- Source performance: 10-minute TTL
- P&L curve: 15-minute TTL
- Daily returns: 15-minute TTL

**Fallback Caching** (node-cache if Redis unavailable):
- Same TTLs as Redis
- In-memory cache per server instance
- Not shared across instances

**Manual Refresh**:
- User clicks "Refresh" button
- Bypasses cache for all data
- Fetches fresh data from database and APIs

**Auto-Refresh**:
- Dashboard component auto-refreshes on mount
- No periodic auto-refresh (user must manually refresh)

---

## 8. External Dependencies

### 8.1 Data Provider Dependencies

#### 8.1.1 Alpaca Markets

**Integration Method**: REST API + WebSocket (WebSocket not currently used)

**API Endpoints Used**:
- `/v2/stocks/{symbol}/quotes/latest`: Latest stock quote
- `/v2/stocks/{symbol}/bars`: Historical candles
- `/v2/options/contracts`: Option chain data
- `/v2/options/quotes/latest`: Latest option quote
- `/v1/clock`: Market hours information

**Data Format**: JSON

**Authentication**: API Key + Secret in headers

**Rate Limits**: 200 requests/minute

**Usage Purpose**:
- Stock price quotes
- Historical candle data
- Option price quotes
- Market hours validation

**Failure Handling**:
- Circuit breaker: Opens after 5 failures, resets after 60 seconds
- Fallback: Try next provider in chain (Polygon → MarketData.app → TwelveData)
- Retry: Up to 2 retries with exponential backoff

**Platform Impact if Unavailable**:
- No impact if other providers available
- If all providers fail: Position updates stop, new trades cannot execute

**Configuration**:
- `ALPACA_API_KEY`: Required
- `ALPACA_API_SECRET`: Required
- `ALPACA_BASE_URL`: Optional (defaults to paper trading URL)


#### 8.1.2 Polygon.io

**Integration Method**: REST API + WebSocket

**API Endpoints Used**:
- `/v2/aggs/ticker/{symbol}/range/{multiplier}/{timespan}/{from}/{to}`: Historical candles
- `/v2/last/trade/{symbol}`: Latest trade
- `/v3/reference/options/contracts`: Option chain data
- `/v2/last/trade/O:{optionSymbol}`: Latest option trade

**WebSocket Streams**:
- Stock quotes: `wss://socket.polygon.io/stocks`
- Subscriptions: `Q.{symbol}` for quotes

**Data Format**: JSON

**Authentication**: API Key in query parameter

**Rate Limits**: 5 requests/minute (free tier)

**Usage Purpose**:
- Stock price quotes (REST and WebSocket)
- Historical candle data
- Option price quotes
- Real-time quote streaming (if enabled)

**Failure Handling**:
- Circuit breaker: Opens after 5 failures, resets after 60 seconds
- Fallback: Try next provider in chain (MarketData.app → TwelveData → Alpaca)
- Retry: Up to 2 retries with exponential backoff
- WebSocket: Auto-reconnect on disconnect

**Platform Impact if Unavailable**:
- No impact if other providers available
- WebSocket streaming disabled if Polygon unavailable
- If all providers fail: Position updates stop, new trades cannot execute

**Configuration**:
- `POLYGON_API_KEY`: Required
- `POLYGON_WS_ENABLED`: Optional (enables WebSocket streaming)

#### 8.1.3 MarketData.app

**Integration Method**: REST API

**API Endpoints Used**:
- `/v1/stocks/quotes/{symbol}`: Latest stock quote
- `/v1/stocks/candles/{resolution}/{symbol}`: Historical candles
- `/v1/options/chain/{symbol}`: Complete option chain
- `/v1/options/quotes/{optionSymbol}`: Latest option quote

**Data Format**: JSON

**Authentication**: API Token in headers

**Rate Limits**: 100 requests/minute

**Usage Purpose**:
- Stock price quotes
- Historical candle data
- Option chain data (for GEX calculations)
- Option price quotes
- Options flow data

**Failure Handling**:
- Circuit breaker: Opens after 5 failures, resets after 60 seconds
- Fallback: Try next provider in chain (TwelveData → Alpaca → Polygon)
- Retry: Up to 2 retries with exponential backoff

**Platform Impact if Unavailable**:
- No impact on basic trading if other providers available
- GEX calculations unavailable (Context Agent degraded)
- Options flow analysis unavailable (Context Agent degraded)
- If all providers fail: Position updates stop, new trades cannot execute

**Configuration**:
- `MARKETDATA_API_TOKEN`: Required

#### 8.1.4 TwelveData

**Integration Method**: REST API

**API Endpoints Used**:
- `/quote`: Latest stock quote
- `/time_series`: Historical candles
- `/market_state`: Market hours information

**Data Format**: JSON

**Authentication**: API Key in query parameter

**Rate Limits**: 8 requests/minute (free tier)

**Usage Purpose**:
- Stock price quotes
- Historical candle data
- Market hours validation (fallback)

**Failure Handling**:
- Circuit breaker: Opens after 5 failures, resets after 60 seconds
- Fallback: Try next provider in chain (Alpaca → Polygon → MarketData.app)
- Retry: Up to 2 retries with exponential backoff

**Platform Impact if Unavailable**:
- No impact if other providers available
- If all providers fail: Position updates stop, new trades cannot execute

**Configuration**:
- `TWELVEDATA_API_KEY`: Required

### 8.2 Signal Source Dependencies

#### 8.2.1 TradingView

**Integration Method**: Webhook POST requests

**Data Format**: JSON payload with custom fields

**Expected Payload**:
```json
{
  "symbol": "SPY",
  "direction": "long",
  "timeframe": "5m",
  "timestamp": "2024-01-15T09:31:00Z",
  "source": "strategy_name",
  "indicator": "indicator_name",
  "strategy": "strategy_name"
}
```

**Authentication**: HMAC-SHA256 signature in `X-Signature` header (optional)

**Failure Handling**:
- Invalid signature: Reject with 401 Unauthorized
- Duplicate signal: Accept with 200 OK (idempotent)
- Invalid payload: Reject with 400 Bad Request
- Database error: Reject with 500 Internal Server Error

**Platform Impact if Unavailable**:
- No new signals received
- Existing positions continue to be monitored
- Exit monitoring continues
- Platform remains operational but no new trades

**Configuration**:
- `TRADINGVIEW_WEBHOOK_SECRET`: Optional (enables HMAC validation)

### 8.3 Infrastructure Dependencies

#### 8.3.1 PostgreSQL Database

**Integration Method**: Direct connection via `pg` library

**Connection String**: `DATABASE_URL` environment variable

**Usage Purpose**:
- Primary data store for all system state
- Signal storage and processing queue
- Order and trade records
- Position tracking
- Configuration storage (exit rules, risk limits, feature flags)
- Audit logging (webhook events)

**Failure Handling**:
- Connection retry: Automatic reconnection on disconnect
- Query retry: No automatic retry (fails immediately)
- Transaction rollback: Automatic on error

**Platform Impact if Unavailable**:
- Complete system failure
- No signal processing
- No trade execution
- No position updates
- Dashboard unavailable

**Configuration**:
- `DATABASE_URL`: Required (PostgreSQL connection string)

#### 8.3.2 Redis Cache

**Integration Method**: Direct connection via `ioredis` library

**Connection String**: `REDIS_URL` environment variable

**Usage Purpose**:
- Dashboard data caching (GEX, source performance, P&L curve)
- Reduces database load
- Improves dashboard response time

**Failure Handling**:
- Connection failure: Graceful degradation to node-cache
- Command failure: Log error and continue without cache
- No retry: Single attempt per operation

**Platform Impact if Unavailable**:
- No impact on core trading functionality
- Dashboard slower (no caching)
- Increased database load
- Falls back to in-memory node-cache

**Configuration**:
- `REDIS_URL`: Optional (enables Redis caching)

---

## 11. Integrated Data Sources

### 11.1 Data Source Catalog

| Data Source | Provider | Data Type | Update Frequency | Access Method | Criticality |
|-------------|----------|-----------|------------------|---------------|-------------|
| Stock Quotes | Alpaca, Polygon, MarketData.app, TwelveData | Real-time price | On-demand | REST API | Critical |
| Historical Candles | Alpaca, Polygon, MarketData.app, TwelveData | OHLCV data | On-demand | REST API | Critical |
| Option Quotes | Alpaca, Polygon, MarketData.app | Real-time price | On-demand | REST API | Critical |
| Option Chain | MarketData.app | Strike/expiration data | On-demand | REST API | Important |
| Market Hours | Alpaca, TwelveData | Open/close times | On-demand | REST API | Important |
| GEX Data | MarketData.app (derived) | Gamma exposure | On-demand | REST API + calculation | Important |
| Options Flow | MarketData.app | Trade flow | On-demand | REST API | Optional |
| WebSocket Quotes | Polygon | Real-time streaming | Continuous | WebSocket | Optional |
| Trading Signals | TradingView | Entry signals | Event-driven | Webhook | Critical |
| Database State | PostgreSQL | All system state | Continuous | Direct connection | Critical |
| Cache Data | Redis | Cached responses | Continuous | Direct connection | Optional |

### 11.2 Data Source Details

#### 11.2.1 Stock Quotes

**Providers**: Alpaca, Polygon, MarketData.app, TwelveData (fallback chain)

**Data Type**: Latest bid, ask, mid price for stock symbols

**Update Frequency**: On-demand (fetched when needed)

**Freshness Requirements**: < 1 minute old

**Validation Logic**:
- Price must be positive number
- Bid <= Ask
- Mid = (Bid + Ask) / 2

**Criticality**: Critical

**Platform Capabilities Dependent**:
- Position P&L updates
- Entry price determination
- Exit price determination
- Strike price calculation

**Failure Impact**:
- Position updates stop
- New trades cannot execute
- Exit monitoring degraded

#### 11.2.2 Historical Candles

**Providers**: Alpaca, Polygon, MarketData.app, TwelveData (fallback chain)

**Data Type**: OHLCV (Open, High, Low, Close, Volume) bars

**Update Frequency**: On-demand (fetched when needed)

**Freshness Requirements**: < 5 minutes old

**Validation Logic**:
- Open, High, Low, Close must be positive
- High >= Open, Close, Low
- Low <= Open, Close, High
- Volume >= 0

**Criticality**: Critical

**Platform Capabilities Dependent**:
- Technical indicator calculation (RSI, MACD, Bollinger Bands, ATR)
- Technical Agent analysis
- Trend detection
- Momentum analysis

**Failure Impact**:
- Engine B decisions degraded (Technical Agent unavailable)
- Engine A continues with basic price data

#### 11.2.3 Option Quotes

**Providers**: Alpaca, Polygon, MarketData.app (fallback chain)

**Data Type**: Latest bid, ask, mid price for option contracts

**Update Frequency**: On-demand (fetched when needed)

**Freshness Requirements**: < 1 minute old

**Validation Logic**:
- Price must be positive number
- Bid <= Ask
- Mid = (Bid + Ask) / 2
- Option symbol format validated

**Criticality**: Critical

**Platform Capabilities Dependent**:
- Trade execution (entry price)
- Position P&L updates (current price)
- Exit monitoring (exit price)

**Failure Impact**:
- New trades cannot execute
- Position updates stop
- Exit monitoring stops


#### 11.2.4 Option Chain

**Provider**: MarketData.app (exclusive)

**Data Type**: Complete list of available option contracts with strikes, expirations, Greeks, open interest

**Update Frequency**: On-demand (fetched when needed)

**Freshness Requirements**: < 5 minutes old

**Validation Logic**:
- Strike must be positive
- Expiration must be future date
- Greeks must be within reasonable ranges
- Open interest >= 0

**Criticality**: Important

**Platform Capabilities Dependent**:
- GEX calculation (Context Agent)
- Max pain calculation
- Strike selection (if using Strike Selection Module)

**Failure Impact**:
- GEX data unavailable (Context Agent degraded)
- Engine B decisions degraded
- Engine A unaffected

#### 11.2.5 Market Hours

**Providers**: Alpaca (primary), TwelveData (fallback)

**Data Type**: Market open/close status, next open/close times

**Update Frequency**: On-demand (fetched when needed)

**Freshness Requirements**: < 1 minute old

**Validation Logic**:
- Status must be boolean
- Times must be valid timestamps
- Times must be in ET timezone

**Criticality**: Important

**Platform Capabilities Dependent**:
- Entry rule validation (market hours check)
- Context Agent market hours context

**Failure Impact**:
- Market hours check defaults to closed (conservative)
- Signals may be rejected during market hours

#### 11.2.6 GEX Data

**Provider**: MarketData.app (derived from option chain)

**Data Type**: Gamma exposure by strike, zero gamma level, dealer position, volatility expectation

**Update Frequency**: On-demand (fetched when needed)

**Freshness Requirements**: < 5 minutes old

**Validation Logic**:
- GEX values must be finite numbers
- Zero gamma level must be valid strike
- Dealer position must be: long_gamma, short_gamma, or neutral

**Criticality**: Important

**Platform Capabilities Dependent**:
- Context Agent market regime detection
- Gamma Flow Specialist analysis
- Dashboard GEX display

**Failure Impact**:
- Context Agent degraded (no GEX regime)
- Gamma Flow Specialist unavailable
- Engine B decisions degraded
- Engine A unaffected

#### 11.2.7 Options Flow

**Provider**: MarketData.app

**Data Type**: Recent large option trades with volume, premium, sentiment

**Update Frequency**: On-demand (fetched when needed)

**Freshness Requirements**: < 5 minutes old

**Validation Logic**:
- Volume must be positive
- Premium must be positive (if present)
- Sentiment must be: bullish, bearish, or neutral

**Criticality**: Optional

**Platform Capabilities Dependent**:
- Context Agent options flow analysis
- Dashboard options flow display

**Failure Impact**:
- Context Agent slightly degraded (no flow data)
- Engine B decisions slightly degraded
- Engine A unaffected

#### 11.2.8 WebSocket Quotes

**Provider**: Polygon (exclusive)

**Data Type**: Real-time streaming stock quotes

**Update Frequency**: Continuous (sub-second)

**Freshness Requirements**: < 1 second old

**Validation Logic**:
- Same as stock quotes
- Sequence numbers must be monotonic

**Criticality**: Optional

**Platform Capabilities Dependent**:
- Real-time price updates (if enabled)
- Reduces API call volume

**Failure Impact**:
- Falls back to REST API polling
- Slightly increased latency
- Increased API usage

#### 11.2.9 Trading Signals

**Provider**: TradingView

**Data Type**: Entry signals with symbol, direction, timeframe, timestamp

**Update Frequency**: Event-driven (webhook)

**Freshness Requirements**: < 1 minute old (signal timestamp)

**Validation Logic**:
- Symbol must be valid ticker
- Direction must be 'long' or 'short'
- Timeframe must be valid (1m, 5m, 15m, 1h, 4h, 1d)
- Timestamp must be recent (within 5 minutes)
- HMAC signature must be valid (if configured)

**Criticality**: Critical

**Platform Capabilities Dependent**:
- All trading functionality
- Signal processing
- Order creation
- Trade execution

**Failure Impact**:
- No new trades
- Existing positions continue to be monitored
- Platform remains operational but idle

#### 11.2.10 Database State

**Provider**: PostgreSQL

**Data Type**: All system state (signals, orders, trades, positions, configuration)

**Update Frequency**: Continuous (real-time writes and reads)

**Freshness Requirements**: Real-time (no staleness acceptable)

**Validation Logic**:
- Schema constraints enforced by database
- Foreign key integrity
- Check constraints on enums and ranges

**Criticality**: Critical

**Platform Capabilities Dependent**:
- All platform functionality

**Failure Impact**:
- Complete system failure
- No recovery without database

#### 11.2.11 Cache Data

**Provider**: Redis (optional)

**Data Type**: Cached API responses and computed data

**Update Frequency**: Continuous (writes on cache miss, reads on cache hit)

**Freshness Requirements**: Varies by data type (5-15 minute TTLs)

**Validation Logic**:
- JSON deserialization must succeed
- Data structure must match expected schema

**Criticality**: Optional

**Platform Capabilities Dependent**:
- Dashboard performance
- Reduced database load
- Reduced API call volume

**Failure Impact**:
- Dashboard slower
- Increased database load
- Increased API usage
- Falls back to node-cache

### 11.3 Data Source Dependencies Diagram

```mermaid
graph TD
    subgraph "Critical Data Sources"
        TV[TradingView Webhooks]
        DB[(PostgreSQL Database)]
        SP1[Stock Quotes: Alpaca/Polygon/MarketData/TwelveData]
        SP2[Historical Candles: Alpaca/Polygon/MarketData/TwelveData]
        SP3[Option Quotes: Alpaca/Polygon/MarketData]
    end
    
    subgraph "Important Data Sources"
        OC[Option Chain: MarketData.app]
        MH[Market Hours: Alpaca/TwelveData]
        GEX[GEX Data: MarketData.app derived]
    end
    
    subgraph "Optional Data Sources"
        OF[Options Flow: MarketData.app]
        WS[WebSocket Quotes: Polygon]
        RC[(Redis Cache)]
    end
    
    subgraph "Platform Components"
        WH[Webhook Handler]
        SP[Signal Processor]
        OC_W[Order Creator]
        PE[Paper Executor]
        PR[Position Refresher]
        EM[Exit Monitor]
        EB[Engine B]
        UI[Dashboard UI]
    end
    
    TV --> WH
    WH --> DB
    WH --> EB
    
    DB --> SP
    DB --> OC_W
    DB --> PE
    DB --> PR
    DB --> EM
    DB --> UI
    
    SP1 --> SP
    SP2 --> SP
    SP1 --> PR
    SP3 --> PE
    SP3 --> PR
    SP3 --> EM
    
    SP2 --> EB
    OC --> EB
    GEX --> EB
    OF --> EB
    MH --> EB
    
    WS -.-> PR
    RC -.-> UI
    
    style TV fill:#ff6b6b
    style DB fill:#ff6b6b
    style SP1 fill:#ff6b6b
    style SP2 fill:#ff6b6b
    style SP3 fill:#ff6b6b
    style OC fill:#ffd93d
    style MH fill:#ffd93d
    style GEX fill:#ffd93d
    style OF fill:#6bcf7f
    style WS fill:#6bcf7f
    style RC fill:#6bcf7f
```

**Legend**:
- Red: Critical (system fails without it)
- Yellow: Important (functionality degraded without it)
- Green: Optional (graceful degradation)

---

