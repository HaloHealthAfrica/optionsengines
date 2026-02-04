# Implementation Plan: Dual-Engine Options Trading Platform

## Overview

This implementation plan breaks down the dual-engine options trading platform into discrete, incremental tasks. The plan follows a phased approach: Engine 1 core functionality first, then Engine 2 multi-agent system, ensuring production stability throughout. Each task builds on previous work, with checkpoints for validation.

## Tasks

- [x] 1. Project setup and database foundation
  - Initialize Node.js project with TypeScript, Express, and PostgreSQL
  - Set up project structure: /src/services, /src/workers, /src/agents, /src/routes, /src/types
  - Configure TypeScript with strict mode and path aliases
  - Install dependencies: express, pg, node-cache, jsonwebtoken, fast-check, jest
  - Create .env.example with all required environment variables
  - _Requirements: 21.1, 21.2_

- [x] 2. Database schema and migrations
  - [x] 2.1 Create Engine 1 database tables
    - Write migration for signals, refactored_signals, orders, trades, refactored_positions, exit_rules, risk_limits tables
    - Add indexes on status, created_at, symbol columns
    - Add foreign key constraints for referential integrity
    - _Requirements: 15.1, 15.2, 15.3_
  
  - [x] 2.2 Create Engine 2 database tables
    - Write migration for experiments, agent_decisions, shadow_trades, shadow_positions, agent_performance, feature_flags tables
    - Add indexes on experiment_id, agent_name, variant columns
    - Add foreign key constraints linking to Engine 1 tables
    - _Requirements: 15.1, 15.2, 15.3_
  
  - [x] 2.3 Write property test for referential integrity
    - **Property 12: Order-signal referential integrity**
    - **Validates: Requirements 4.6, 15.2**
  
  - [x] 2.4 Create migration runner and schema_migrations table
    - Implement migration tracking in schema_migrations table
    - Create up/down migration scripts
    - _Requirements: 15.4, 15.5, 15.6_


- [ ] 3. Core services implementation
  - [x] 3.1 Implement Database Service
    - Create connection pool with PostgreSQL
    - Implement query execution with parameterized queries
    - Add transaction support (begin, commit, rollback)
    - Implement connection retry logic (up to 10 attempts, 5-second intervals)
    - _Requirements: 18.4_
  
  - [x] 3.2 Write property test for database retry logic
    - **Property 40: Worker resilience**
    - **Validates: Requirements 18.3, 18.4**
  
  - [x] 3.3 Implement Cache Service
    - Create in-memory cache with TTL support using node-cache
    - Implement get, set, delete, clear methods
    - Add cache statistics tracking (hits, misses, hit rate)
    - _Requirements: 2.3, 2.6_
  
  - [x] 3.4 Write property test for cache consistency
    - **Property 6: Cache consistency**
    - **Validates: Requirements 2.4**
  
  - [x] 3.5 Implement Rate Limiter Service
    - Create token bucket rate limiter for Alpaca (200 req/min)
    - Create token bucket rate limiter for TwelveData (800 req/day)
    - Implement request queueing when limit exceeded
    - Add warning logs at 90% of limit
    - _Requirements: 24.1, 24.2, 24.3, 24.4_
  
  - [x] 3.6 Write property test for rate limit enforcement
    - **Property 45: API rate limit enforcement**
    - **Validates: Requirements 24.1, 24.2**
  
  - [x] 3.7 Implement Authentication Service
    - Create JWT token generation with 24-hour expiration
    - Implement JWT token validation and claims extraction
    - Add role-based authorization checks
    - _Requirements: 20.1, 20.2, 20.3_
  
  - [x] 3.8 Write property test for JWT token issuance
    - **Property 42: JWT token issuance**
    - **Validates: Requirements 20.2**

- [x] 4. Market Data Service with caching
  - [x] 4.1 Implement Alpaca API client
    - Create API client for Alpaca with authentication
    - Implement getCandles method for OHLCV data
    - Implement getOptionPrice method for option pricing
    - Add error handling and logging
    - _Requirements: 2.1_
  
  - [x] 4.2 Implement TwelveData API client (fallback)
    - Create API client for TwelveData with authentication
    - Implement getCandles method matching Alpaca interface
    - Add error handling and logging
    - _Requirements: 2.2_
  
  - [x] 4.3 Implement Market Data Service with caching and fallback
    - Create unified interface for market data providers
    - Implement caching with 60-second TTL
    - Add automatic fallback from Alpaca to TwelveData on failure
    - Implement circuit breaker pattern (open after 5 failures, half-open after 60s)
    - Track API call counts and cache hit rates
    - _Requirements: 2.3, 2.4, 18.5, 18.6_
  
  - [x] 4.4 Write property test for API fallback behavior
    - **Property 8: API fallback behavior**
    - **Validates: Requirements 2.2, 18.5**
  
  - [x] 4.5 Implement technical indicator derivation
    - Calculate EMA (8, 13, 21, 48, 200) from cached OHLCV
    - Calculate ATR from cached OHLCV
    - Calculate Bollinger Bands from cached OHLCV
    - Calculate Keltner Channels from cached OHLCV
    - Calculate TTM Squeeze state from Bollinger Bands and Keltner Channels
    - _Requirements: 2.5_
  
  - [x] 4.6 Write property test for indicator derivation without API calls
    - **Property 7: Indicator derivation without API calls**
    - **Validates: Requirements 2.5**

- [x] 5. Checkpoint - Core services validation
  - Ensure all tests pass
  - Verify database connection and migrations
  - Verify cache hit rate tracking
  - Verify rate limiter enforcement
  - Ask the user if questions arise


- [-] 6. Webhook handler and signal ingestion (Engine 1)
  - [x] 6.1 Implement webhook validation
    - Create POST /webhook endpoint
    - Validate request signature and payload structure
    - Check for required fields (symbol, direction, timeframe, timestamp)
    - Return HTTP 400 for invalid payloads with error details
    - _Requirements: 1.1, 1.3_
  
  - [x] 6.2 Write property test for webhook validation consistency
    - **Property 1: Webhook validation consistency**
    - **Validates: Requirements 1.1**
  
  - [x] 6.3 Implement signal storage and deduplication
    - Store valid signals in signals table with status "pending"
    - Implement deduplication logic (check for duplicates within 60 seconds)
    - Return HTTP 201 with signal_id for new signals
    - Return HTTP 200 for duplicate signals without creating new record
    - Log all webhook requests with timestamp, payload, and validation result
    - _Requirements: 1.2, 1.4, 1.5, 1.6_
  
  - [x] 6.4 Write property test for deduplication idempotence
    - **Property 4: Deduplication idempotence**
    - **Validates: Requirements 1.4**
  
  - [x] 6.5 Write property test for webhook logging completeness
    - **Property 5: Webhook logging completeness**
    - **Validates: Requirements 1.6**

- [x] 7. Signal Processor worker (Engine 1)
  - [x] 7.1 Implement Signal Processor worker
    - Create worker that runs every 30 seconds
    - Fetch all signals with status "pending"
    - Enrich signals with market context from Market Data Service
    - Apply risk checks (position limits, capital allocation, market hours)
    - Update signal status to "approved" or "rejected" with reason
    - Store enriched data in refactored_signals table
    - Log count of approved and rejected signals
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  
  - [x] 7.2 Write property test for signal enrichment completeness
    - **Property 9: Signal enrichment completeness**
    - **Validates: Requirements 3.2, 3.5**
  
  - [x] 7.3 Write property test for risk check attribution
    - **Property 10: Risk check attribution**
    - **Validates: Requirements 3.4**

- [x] 8. Order Creator worker (Engine 1)
  - [x] 8.1 Implement Order Creator worker
    - Create worker that runs every 30 seconds
    - Fetch all approved signals without associated orders
    - Calculate option strike price based on signal direction and current price
    - Calculate expiration date based on configured DTE
    - Calculate position size based on account capital and risk percentage
    - Store order in orders table with status "pending_execution" and type "paper"
    - Link order to source signal via signal_id foreign key
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  
  - [x] 8.2 Write property test for approved signal order creation
    - **Property 11: Approved signal order creation**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

- [x] 9. Paper Executor worker (Engine 1)
  - [x] 9.1 Implement Paper Executor worker
    - Create worker that runs every 10 seconds
    - Fetch all orders with status "pending_execution" and type "paper"
    - Fetch current option price from Market Data Service
    - Create trade record with fill_price equal to current market price
    - Update order status to "filled" with execution timestamp
    - Create or update position record in refactored_positions table
    - Implement retry logic (up to 3 attempts) when price unavailable
    - Mark order as "failed" after exhausting retries
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  
  - [x] 9.2 Write property test for paper execution with real prices
    - **Property 13: Paper execution with real prices**
    - **Validates: Requirements 5.3**
  
  - [x] 9.3 Write property test for trade-to-position propagation
    - **Property 14: Trade-to-position propagation**
    - **Validates: Requirements 5.5**
  
  - [x] 9.4 Write property test for execution retry logic

- [x] 13. Checkpoint - Engine 1 complete validation
  - Ensure all tests pass
  - Test full cycle: Entry → Position tracking → Exit
  - Verify P&L updates in real-time
  - Verify exit conditions trigger automatically
  - Verify all 5 workers running without errors
  - Ask the user if questions arise

- [x] 14. Feature Flag Service (Engine 2 foundation)
  - [x] 14.1 Implement Feature Flag Service
    - Create feature_flags table initialization with default flags (all false)
    - Implement in-memory cache with 5-second refresh interval
    - Create isEnabled method for checking flag status
    - Create updateFlag method for admin updates
    - Create getAllFlags method for listing all flags
    - Create refreshCache method for cache updates
    - _Requirements: 13.1, 13.2, 13.4_
  
  - [x] 14.2 Create POST /feature-flags API endpoint
    - Implement endpoint with admin authentication required
    - Validate flag names against whitelist
    - Log all flag changes with user and timestamp
    - _Requirements: 13.3_
  
  - [x] 14.3 Write property test for feature flag cache refresh
    - **Property 22: Master feature flag override**
    - **Validates: Requirements 8.4, 13. 6**

- [ ] 15. A/B Testing Framework (Strategy Router)
  - [x] 15.1 Implement deterministic hash function
    - Create hash function using SHA256(symbol + timeframe + sessionId)
    - Ensure hash is deterministic (same inputs → same output)
    - _Requirements: 8.1_
  
  - [x] 15.2 Write property test for deterministic hash consistency
    - **Property 20: Deterministic hash consistency**
    - **Validates: Requirements 8.1**
  
  - [x] 15.3 Implement Strategy Router
    - Create route method that computes hash and assigns variant
    - Implement variant assignment: hash % 100 < splitPercentage ? 'B' : 'A'
    - Check enable_variant_b feature flag (if false, always return Variant A)
    - Store experiment assignment in experiments table
    - Emit experiment_id and variant for downstream tracking
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6_
  
  - [x] 15.4 Write property test for variant assignment determinism
    - **Property 21: Variant assignment determinism**
    - **Validates: Requirements 8.2**
  
  - [x] 15.5 Write property test for master feature flag override
    - **Property 22: Master feature flag override**
    - **Validates: Requirements 8.4, 13.6**
  
  - [x] 15.6 Write property test for experiment metadata propagation
    - **Property 23: Experiment metadata propagation**
    - **Validates: Requirements 8.6**

- [x] 16. Checkpoint - A/B framework validation
  - Ensure all tests pass
  - Verify deterministic routing with same inputs
  - Verify 100% Variant A when enable_variant_b is false
  - Verify experiment records are created
  - Ask the user if questions arise


- [-] 17. Agent Framework base classes (Engine 2)
  - [x] 17.1 Create Agent interface and base class
    - Define Agent interface with analyze and shouldActivate methods
    - Define AgentOutput interface with schema validation
    - Create BaseAgent abstract class with common functionality
    - Implement agent output schema validation
    - _Requirements: 9.4_
  
  - [x] 17.2 Write property test for agent output schema compliance
    - **Property 25: Agent output schema compliance**
    - **Validates: Requirements 9.4**
  
  - [x] 17.3 Create EnrichedSignal and MarketData types
    - Define EnrichedSignal interface
    - Define MarketData interface with candles, indicators, session context
    - _Requirements: 9.1, 9.2_

- [ ] 18. Core Agents implementation (Engine 2)
  - [x] 18.1 Implement Technical Agent
    - Create TechnicalAgent class extending BaseAgent
    - Analyze price position relative to EMAs
    - Detect trend direction and strength
    - Identify support/resistance levels
    - Assign confidence 0-90 based on alignment
    - _Requirements: 9.1_
  
  - [x] 18.2 Implement Context Agent
    - Create ContextAgent class extending BaseAgent
    - Analyze market regime (trending, ranging, volatile)
    - Calculate volatility state using ATR percentile
    - Determine session context (opening, mid-day, closing)
    - Assign confidence 0-90 based on regime favorability
    - _Requirements: 9.1_
  
  - [x] 18.3 Implement Risk Agent
    - Create RiskAgent class extending BaseAgent
    - Check position size limits
    - Check total exposure limits
    - Validate market hours
    - Validate capital allocation
    - Set block flag to true when limits exceeded
    - _Requirements: 9.1, 9.5_
  
  - [x] 18.4 Write property test for Risk Agent absolute veto
    - **Property 26: Risk Agent absolute veto**
    - **Validates: Requirements 9.5**
  
  - [x] 18.5 Implement Meta-Decision Agent
    - Create MetaDecisionAgent class
    - Check Risk Agent block flag (reject immediately if true)
    - Collect all agent outputs with confidence scores
    - Apply weighting hierarchy: specialists (40%), core (35%), sub-agents (25%)
    - Calculate weighted average confidence
    - Determine consensus bias (majority vote with confidence weighting)
    - Produce final decision with attribution
    - _Requirements: 9.6, 9.7_
  
  - [x] 18.6 Write property test for meta-decision weighting hierarchy
    - **Property 30: Meta-decision weighting hierarchy**
    - **Validates: Requirements 11.5**
  
  - [x] 18.7 Write property test for shared data access
    - **Property 24: Shared data access (no duplicate API calls)**
    - **Validates: Requirements 9.2**

- [ ] 19. Specialist Agents implementation (Engine 2)
  - [x] 19.1 Implement ORB Specialist
    - Create ORBSpecialist class extending BaseAgent
    - Implement shouldActivate: check feature flag, symbol (SPY/QQQ/SPX), RTH session, opening window
    - Calculate opening range (high/low of first N minutes)
    - Detect breakout direction and magnitude
    - Assess momentum follow-through (volume, price acceleration)
    - Assign confidence 0-100 based on breakout quality
    - Store metadata: orbHigh, orbLow, breakoutDirection, volumeRatio
    - _Requirements: 10.1, 10.4, 10.7_
  
  - [x] 19.2 Implement Strat Specialist
    - Create StratSpecialist class extending BaseAgent
    - Implement shouldActivate: check feature flag, detect market structure patterns
    - Classify candles (1: inside, 2: directional, 3: outside)
    - Detect patterns: 2-1-2, 3-1-2, 3-2-2, HTF rejection, wick rejection
    - Check HTF/LTF alignment
    - Validate with TTM Squeeze if available
    - Assign confidence 15-95 based on structure quality
    - Store metadata: stratPattern, candleSequence, htfAlignment, ttmConfirmation
    - _Requirements: 10.2, 10.5, 10.7_
  
  - [x] 19.3 Implement TTM Specialist
    - Create TTMSpecialist class extending BaseAgent
    - Implement shouldActivate: check feature flag, squeeze state OFF, momentum aligned
    - Detect squeeze release (transition from ON to OFF)
    - Measure momentum strength and direction
    - Validate release quality (clean vs choppy)
    - Assign confidence 0-80 based on release quality
    - Store metadata: squeezeState, momentumDirection, releaseQuality
    - _Requirements: 10.3, 10.6, 10.7_
  
  - [x] 19.4 Write property test for specialist agent conditional activation
    - **Property 27: Specialist agent conditional activation**
    - **Validates: Requirements 10.1, 10.2, 10.3**
  
  - [x] 19.5 Write property test for confidence bounds enforcement
    - **Property 28: Confidence bounds enforcement**
    - **Validates: Requirements 10.4, 10.5, 10.6, 11.3**

- [ ] 20. Sub-Agents implementation (Engine 2)
  - [x] 20.1 Implement Satyland Sub-Agent
    - Create SatylandSubAgent class extending BaseAgent
    - Implement shouldActivate: check feature flag
    - Analyze Pivot Ribbon (EMA 8/13/21/48/200 alignment)
    - Check ATR levels for level-to-level progression
    - Calculate Phase Oscillator for trend strength
    - Assess volume quality (Volume Stack Proxy)
    - Assign confidence 20-90 based on alignment
    - Store metadata: ribbonAlignment, atLevelToLevel, phaseOscillator, volumeQuality
    - _Requirements: 11.1, 11.2, 11.3_
  
  - [x] 20.2 Write property test for sub-agent no veto power
    - **Property 29: Sub-agent no veto power**
    - **Validates: Requirements 11.4**

- [ ] 21. Checkpoint - Multi-agent system validation
  - Ensure all tests pass
  - Verify all core agents produce valid outputs
  - Verify specialist agents activate conditionally
  - Verify Risk Agent veto power
  - Verify Meta-Decision Agent aggregation
  - Ask the user if questions arise


- [-] 22. Shadow Executor implementation (Engine 2)
  - [x] 22.1 Implement Shadow Executor
    - Create ShadowExecutor class
    - Implement simulateExecution method using same order creation logic as Engine 1
    - Fetch real option prices from Market Data Service
    - Store shadow trades in shadow_trades table with full attribution
    - Create/update shadow_positions table
    - Never call actual order placement APIs
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_
  
  - [x] 22.2 Write property test for no live orders from Engine 2 (CRITICAL)
    - **Property 31: No live orders from Engine 2**
    - **Validates: Requirements 12.1**
  
  - [x] 22.3 Write property test for shadow execution logic parity
    - **Property 32: Shadow execution logic parity**
    - **Validates: Requirements 12.2**
  
  - [x] 22.4 Write property test for shadow trade real pricing
    - **Property 33: Shadow trade real pricing**
    - **Validates: Requirements 12.3**
  
  - [x] 22.5 Implement shadow position refresh and exit monitoring
    - Create refreshShadowPositions method using same logic as Engine 1
    - Create monitorShadowExits method using same exit conditions as Engine 1
    - Update shadow_positions with current prices and P&L
    - Simulate exit orders when conditions met
    - Calculate realized P&L for closed shadow positions
    - _Requirements: 12.6, 12.7_
  
  - [x] 22.6 Write property test for shadow position P&L calculation parity
    - **Property 34: Shadow position P&L calculation parity**
    - **Validates: Requirements 12.6**

- [-] 23. Event-sourced logging (Engine 2)
  - [x] 23.1 Implement Event Logger
    - Create EventLogger class for append-only logging
    - Log experiment_id, variant, shared_data_reference for each signal
    - Log all active agent names and outputs
    - Log Meta_Decision_Agent final decision with aggregation methodology
    - Log all timestamps (signal_received, enrichment_complete, agents_complete, decision_final)
    - Store logs in agent_decisions table
    - _Requirements: 14.1, 14.2, 14.3, 14.4_
  
  - [x] 23.2 Write property test for log immutability
    - **Property 35: Log immutability**
    - **Validates: Requirements 14.5**
  
  - [x] 23.3 Write property test for signal processing replay
    - **Property 36: Signal processing replay**
    - **Validates: Requirements 14.6**
  
  - [x] 23.4 Write property test for event logging completeness
    - **Property 37: Event logging completeness**
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4**

- [-] 24. Engine 2 integration with webhook flow
  - [x] 24.1 Integrate Strategy Router into webhook handler
    - Call Strategy Router after signal validation
    - Route to Engine 1 (Variant A) or Engine 2 (Variant B)
    - Pass experiment_id and variant to downstream processing
    - _Requirements: 8.1, 8.2, 8.3_
  
  - [x] 24.2 Implement Variant B processing pipeline
    - Activate core agents (Technical, Context, Risk, Meta-Decision)
    - Conditionally activate specialist agents based on feature flags
    - Conditionally activate sub-agents based on feature flags
    - Collect all agent outputs
    - Run Meta-Decision Agent aggregation
    - Log all decisions via Event Logger
    - Call Shadow Executor if decision is "approve"
    - _Requirements: 9.1, 9.2, 9.3, 9.6, 9.7_
  
  - [x] 24.3 Ensure Engine 1 remains unchanged
    - Verify Variant A signals follow original Engine 1 flow
    - Verify no Engine 1 logic modifications
    - Verify Engine 1 workers continue operating independently
    - _Requirements: Non-breaking constraint_

- [ ] 25. Checkpoint - Engine 2 complete validation
  - Ensure all tests pass
  - Verify Engine 2 never creates live orders
  - Verify shadow trades logged with full attribution
  - Verify event sourcing enables replay
  - Verify Engine 1 unchanged when enable_variant_b is false
  - Ask the user if questions arise


- [-] 26. API endpoints for Engine 2 data
  - [x] 26.1 Implement GET /experiments endpoint
    - Return list of all A/B experiments with metadata
    - Support filtering by date range, symbol, variant
    - Return JSON with appropriate HTTP status codes
    - _Requirements: 16.1, 16.7_
  
  - [x] 26.2 Implement GET /experiments/:id/results endpoint
    - Calculate performance metrics for Variant A and Variant B
    - Calculate statistical significance
    - Return comparison data with win rates, avg P&L, expectancy
    - _Requirements: 16.2, 16.7_
  
  - [x] 26.3 Implement GET /agents/performance endpoint
    - Return per-agent metrics (accuracy, confidence calibration, win rate)
    - Calculate expectancy for each agent
    - Support filtering by agent name, date range
    - _Requirements: 16.3, 16.7_
  
  - [x] 26.4 Implement GET /shadow-trades endpoint
    - Return shadow trade history with filters (date range, symbol, agent)
    - Include full attribution (contributing agents, meta confidence)
    - _Requirements: 16.4, 16.7_
  
  - [x] 26.5 Implement GET /shadow-positions endpoint
    - Return current and historical shadow positions
    - Include P&L calculations and exit reasons
    - _Requirements: 16.5, 16.7_
  
  - [x] 26.6 Implement GET /health endpoint
    - Return status of database, cache, and external APIs
    - Include uptime and last check timestamps
    - _Requirements: 19.4_
  
  - [x] 26.7 Write property test for API response format
    - **Property 43: Token-based authentication**
    - **Validates: Requirements 20.1, 20.6**

- [-] 27. Frontend dashboard (React + TypeScript + Vite)
  - [x] 27.1 Set up frontend project
    - Initialize Vite project with React 18 and TypeScript
    - Install shadcn/ui components
    - Configure routing with react-router-dom
    - Set up API client with authentication
    - _Requirements: 17.1_
  
  - [x] 27.2 Create Dashboard page
    - Display Engine 1 live positions in table
    - Display Engine 2 shadow positions in table
    - Show side-by-side comparison
    - Implement 30-second polling for real-time updates
    - Display loading states and error messages
    - _Requirements: 17.1, 17.5, 17.6_
  
  - [x] 27.3 Create Experiments page
    - Display A/B test results with statistical significance
    - Show Variant A vs Variant B performance comparison
    - Include charts for win rate, avg P&L, expectancy
    - _Requirements: 17.2, 17.5, 17.6_
  
  - [x] 27.4 Create Agent Performance page
    - Display individual agent metrics in table
    - Show confidence calibration charts
    - Include expectancy and win rate per agent
    - _Requirements: 17.3, 17.5, 17.6_
  
  - [x] 27.5 Create Feature Flags admin page
    - Display all feature flags with enabled status
    - Implement toggle switches for enabling/disabling flags
    - Require admin authentication
    - Show last updated timestamp and user
    - _Requirements: 17.4, 17.5, 17.6_

- [-] 28. Error handling and resilience
  - [x] 28.1 Implement retry logic with exponential backoff
    - Add retry wrapper for all external API calls
    - Implement exponential backoff (2^attempt * 1000ms)
    - Log all retry attempts with context
    - _Requirements: 18.1_
  
  - [x] 28.2 Write property test for API retry with exponential backoff
    - **Property 38: API retry with exponential backoff**
    - **Validates: Requirements 18.1**
  
  - [x] 28.3 Implement graceful degradation
    - Catch and log all errors without crashing
    - Continue processing other signals when one fails
    - Track error rates for monitoring
    - _Requirements: 18.2_
  
  - [x] 28.4 Write property test for graceful degradation
    - **Property 39: Graceful degradation**
    - **Validates: Requirements 18.2**
  
  - [x] 28.5 Implement circuit breaker for external APIs
    - Create CircuitBreaker class
    - Open circuit after 5 consecutive failures
    - Transition to half-open after 60 seconds
    - Track circuit breaker state changes
    - _Requirements: 18.6_
  
  - [x] 28.6 Write property test for circuit breaker state transitions
    - **Property 41: Circuit breaker state transitions**
    - **Validates: Requirements 18.6**

- [-] 29. Graceful shutdown implementation
  - [x] 29.1 Implement shutdown signal handlers
    - Listen for SIGTERM and SIGINT signals
    - Stop accepting new webhook requests on shutdown
    - Wait for active workers to complete (max 30 seconds)
    - Force-terminate remaining operations after timeout
    - Close all database and cache connections
    - Log shutdown initiation and completion
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5, 25.6_
  
  - [x] 29.2 Write property test for shutdown signal handling
    - **Property 47: Shutdown signal handling**
    - **Validates: Requirements 25.1, 25.2, 25.3**
  
  - [x] 29.3 Write property test for resource cleanup on shutdown
    - **Property 48: Resource cleanup on shutdown**
    - **Validates: Requirements 25.5**

- [ ] 30. Checkpoint - System integration validation
  - Ensure all tests pass
  - Test end-to-end with both engines
  - Verify A/B test results show clear comparison
  - Verify frontend displays all data correctly
  - Verify graceful shutdown works
  - Ask the user if questions arise


- [-] 31. Deployment preparation
  - [x] 31.1 Create Dockerfile
    - Write multi-stage Dockerfile for production build
    - Install dependencies and build TypeScript
    - Set up non-root user for security
    - Expose port 3000
    - _Requirements: 21.1_
  
  - [x] 31.2 Create fly.toml configuration
    - Configure Fly.io deployment settings
    - Set up environment variables
    - Configure health checks
    - Set up auto-scaling rules
    - _Requirements: 21.4_
  
  - [x] 31.3 Implement environment variable validation
    - Create startup script that validates all required env vars
    - Exit with error if any required vars are missing
    - Log all configuration on startup (excluding secrets)
    - _Requirements: 21.2, 21.3_
  
  - [x] 31.4 Implement automatic database migrations on startup
    - Run migrations before starting workers
    - Verify migrations completed successfully
    - Log migration status
    - _Requirements: 21.5_

- [-] 32. Integration testing
  - [x] 32.1 Write end-to-end integration test
    - Test full flow: Webhook → Signal → Order → Trade → Position → Exit
    - Verify real market data is used
    - Verify all workers execute correctly
    - Verify position P&L updates
    - Verify exit conditions trigger
    - _Requirements: 1.1 through 7.7_
  
  - [x] 32.2 Write A/B testing integration test
    - Test deterministic routing with same inputs
    - Test 100% Variant A when enable_variant_b is false
    - Test traffic split when enable_variant_b is true
    - Verify experiment records created
    - _Requirements: 8.1 through 8.6_
  
  - [x] 32.3 Write Engine 2 shadow execution integration test
    - Test Variant B signal processing through all agents
    - Verify no live orders created for Variant B
    - Verify shadow trades logged with attribution
    - Verify shadow positions tracked correctly
    - _Requirements: 9.1 through 12.7_
  
  - [x] 32.4 Write feature flag integration test
    - Test master switch (enable_variant_b) overrides all other flags
    - Test specialist agent activation based on flags
    - Test sub-agent activation based on flags
    - _Requirements: 13.1 through 13.6_

- [ ] 33. Performance testing and optimization
  - [ ] 33.1 Test database query performance
    - Run queries with realistic data volumes
    - Verify 95th percentile < 1 second
    - Add indexes if needed
    - _Requirements: 19.1_
  
  - [ ] 33.2 Test cache hit rate
    - Run system with realistic signal volume
    - Verify cache hit rate > 70%
    - Tune cache TTL if needed
    - _Requirements: 19.2_
  
  - [ ] 33.3 Test worker execution time
    - Monitor worker execution time under load
    - Verify workers complete within intervals
    - Alert when execution time exceeds 5 seconds
    - _Requirements: 19.3_
  
  - [ ] 33.4 Test API rate limiting
    - Verify rate limits enforced correctly
    - Test queueing when limits exceeded
    - Verify warnings at 90% of limit
    - _Requirements: 24.1, 24.2, 24.3, 24.4_

- [ ] 34. Final deployment and monitoring
  - [ ] 34.1 Deploy to Fly.io
    - Build and push Docker image
    - Deploy to Fly.io
    - Run database migrations
    - Start all workers
    - _Requirements: 21.4_
  
  - [ ] 34.2 Verify production deployment
    - Test webhook endpoint with real TradingView signal
    - Verify Engine 1 processes signals correctly
    - Verify all workers running without errors
    - Verify database queries performing well
    - Verify cache hit rate > 70%
    - _Requirements: All_
  
  - [ ] 34.3 Enable Engine 2 in production (gradual rollout)
    - Set enable_variant_b to true with 5% traffic split
    - Monitor for 24 hours
    - Verify no live orders from Engine 2
    - Verify shadow trades logged correctly
    - Gradually increase to 10%, 25%, 50% if stable
    - _Requirements: 8.4, 8.5, 12.1_
  
  - [ ] 34.4 Set up monitoring and alerts
    - Monitor worker execution times
    - Monitor API call counts and cache hit rates
    - Monitor error rates and circuit breaker states
    - Set up alerts for critical failures
    - _Requirements: 19.3, 19.5, 19.6_

- [ ] 35. Final checkpoint - Production validation
  - Verify Engine 1 operates at 100% stability
  - Verify Engine 2 shadow mode working correctly
  - Verify no live orders from Engine 2
  - Verify A/B test results available in dashboard
  - Verify all feature flags working
  - 24-hour monitoring shows no critical issues
  - Ask the user if questions arise

## Notes

- All property-based tests are required for comprehensive validation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties with minimum 100 iterations
- Unit tests validate specific examples and edge cases
- Engine 1 must remain 100% stable throughout Engine 2 integration
- All Engine 2 functionality is feature-flagged and reversible
- Shadow execution ensures Engine 2 never places live trades

