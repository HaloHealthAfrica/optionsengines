# Requirements Document: Dual-Engine Options Trading Platform

## Introduction

This document specifies the requirements for a production-ready options trading platform with two parallel decision engines. Engine 1 (Control/Production) executes traditional signal processing with live paper trading. Engine 2 (Experimental/Shadow) implements a multi-agent swarm decision system that runs in shadow mode for A/B testing without live execution. The system must maintain 100% stability of the production engine while enabling safe experimentation with advanced decision-making strategies.

## Glossary

- **System**: The dual-engine options trading platform
- **Engine_1**: The control/production engine using traditional signal processing
- **Engine_2**: The experimental/shadow engine using multi-agent decision making
- **Signal_Processor**: Component that validates and enriches incoming trading signals
- **Market_Data_Service**: Component that fetches and caches market data from external APIs
- **Strategy_Router**: Component that assigns signals to Engine_1 or Engine_2 using deterministic hashing
- **Agent**: An autonomous decision-making component within Engine_2
- **Risk_Agent**: Agent with absolute veto power over trading decisions
- **Meta_Decision_Agent**: Agent that aggregates outputs from all other agents
- **Shadow_Mode**: Execution mode where decisions are logged but no live trades are placed
- **Feature_Flag**: Configuration toggle that enables/disables system functionality
- **Variant_A**: A/B test variant representing Engine_1 (control)
- **Variant_B**: A/B test variant representing Engine_2 (experimental)
- **Paper_Trade**: Simulated trade execution using real market prices
- **Position_Tracker**: Component that monitors open positions and calculates P&L
- **Exit_Monitor**: Component that checks exit conditions and triggers position closure
- **Webhook**: HTTP POST request from TradingView containing trading signals
- **Worker**: Background process that executes scheduled tasks
- **Experiment**: A/B test configuration that routes signals to variants
- **ORB_Specialist**: Agent specializing in Opening Range Breakout analysis
- **Strat_Specialist**: Agent specializing in The Strat methodology
- **TTM_Specialist**: Agent specializing in TTM Squeeze indicator analysis
- **Satyland_SubAgent**: Support agent providing confirmation using Satyland strategies
- **Shared_Data_Cache**: In-memory cache storing enriched market data for both engines

## Requirements

### Requirement 1: Signal Ingestion and Validation

**User Story:** As a trader, I want the system to receive and validate TradingView webhook signals, so that only properly formatted signals enter the processing pipeline.

#### Acceptance Criteria

1. WHEN a webhook POST request is received, THE System SHALL validate the request signature and payload structure
2. WHEN a signal contains all required fields (symbol, direction, timeframe, timestamp), THE System SHALL store it in the signals table with status "pending"
3. WHEN a signal is missing required fields, THE System SHALL reject it and return HTTP 400 with error details
4. WHEN a duplicate signal is received within 60 seconds, THE System SHALL deduplicate it and return HTTP 200 without creating a new record
5. WHEN a signal is successfully stored, THE System SHALL return HTTP 201 with the signal ID
6. THE System SHALL log all webhook requests including timestamp, payload, and validation result

### Requirement 2: Market Data Enrichment

**User Story:** As a system architect, I want market data to be fetched once and shared between both engines, so that API rate limits are respected and costs are minimized.

#### Acceptance Criteria

1. WHEN a signal requires market data, THE Market_Data_Service SHALL fetch OHLCV candles from Alpaca API
2. WHEN Alpaca API is unavailable, THE Market_Data_Service SHALL fallback to TwelveData API
3. WHEN market data is fetched, THE Market_Data_Service SHALL cache it in Shared_Data_Cache with 60-second TTL
4. WHEN multiple components request the same market data within cache TTL, THE Market_Data_Service SHALL return cached data without additional API calls
5. THE Market_Data_Service SHALL derive technical indicators (EMA, ATR, Bollinger Bands, Keltner Channels) from cached OHLCV data
6. THE Market_Data_Service SHALL track API call counts and cache hit rates for monitoring
7. WHEN cache hit rate falls below 70%, THE System SHALL log a warning

### Requirement 3: Engine 1 Signal Processing

**User Story:** As a trader, I want signals to be processed through validation and risk checks, so that only approved signals create orders.

#### Acceptance Criteria

1. WHEN Signal_Processor runs (every 30 seconds), THE System SHALL fetch all signals with status "pending"
2. WHEN processing a signal, THE Signal_Processor SHALL enrich it with market context from Market_Data_Service
3. WHEN a signal passes risk checks (position limits, capital allocation, market hours), THE Signal_Processor SHALL update its status to "approved"
4. WHEN a signal fails risk checks, THE Signal_Processor SHALL update its status to "rejected" with rejection reason
5. THE Signal_Processor SHALL store enriched signal data in refactored_signals table
6. WHEN processing completes, THE Signal_Processor SHALL log the count of approved and rejected signals

### Requirement 4: Engine 1 Order Creation

**User Story:** As a trader, I want approved signals to automatically create option orders with appropriate strikes and position sizing, so that trading opportunities are captured systematically.

#### Acceptance Criteria

1. WHEN Order_Creator runs (every 30 seconds), THE System SHALL fetch all approved signals without associated orders
2. WHEN creating an order, THE System SHALL calculate option strike price based on signal direction and current underlying price
3. WHEN creating an order, THE System SHALL calculate expiration date based on configured DTE (days to expiration)
4. WHEN creating an order, THE System SHALL calculate position size based on account capital and risk percentage
5. THE System SHALL store the order in orders table with status "pending_execution" and type "paper"
6. THE System SHALL link the order to its source signal via signal_id foreign key

### Requirement 5: Engine 1 Paper Trade Execution

**User Story:** As a trader, I want paper orders to be executed with real market prices, so that simulated performance reflects actual market conditions.

#### Acceptance Criteria

1. WHEN Paper_Executor runs (every 10 seconds), THE System SHALL fetch all orders with status "pending_execution" and type "paper"
2. WHEN executing a paper order, THE System SHALL fetch current option price from Alpaca API
3. WHEN option price is available, THE System SHALL create a trade record with fill_price equal to current market price
4. WHEN a trade is created, THE System SHALL update order status to "filled" and store execution timestamp
5. THE System SHALL create or update a position record in refactored_positions table with entry price and quantity
6. WHEN option price is unavailable, THE System SHALL retry up to 3 times before marking order as "failed"

### Requirement 6: Engine 1 Position Tracking

**User Story:** As a trader, I want real-time P&L updates on open positions, so that I can monitor performance and risk exposure.

#### Acceptance Criteria

1. WHEN Position_Refresher runs (every 60 seconds), THE System SHALL fetch all positions with status "open"
2. WHEN refreshing a position, THE System SHALL fetch current option price from Market_Data_Service
3. WHEN current price is available, THE System SHALL calculate unrealized_pnl as (current_price - entry_price) * quantity * 100
4. THE System SHALL update the position record with current_price, unrealized_pnl, and last_updated timestamp
5. THE System SHALL calculate position_pnl_percent as (unrealized_pnl / cost_basis) * 100
6. WHEN current price is unavailable, THE System SHALL log a warning and skip that position

### Requirement 7: Engine 1 Exit Monitoring

**User Story:** As a trader, I want positions to automatically close when exit conditions are met, so that profits are protected and losses are limited.

#### Acceptance Criteria

1. WHEN Exit_Monitor runs (every 60 seconds), THE System SHALL fetch all positions with status "open"
2. WHEN a position's unrealized_pnl_percent exceeds profit_target_percent, THE System SHALL create an exit order
3. WHEN a position's unrealized_pnl_percent falls below stop_loss_percent (negative), THE System SHALL create an exit order
4. WHEN a position's time_in_position exceeds max_hold_time_hours, THE System SHALL create an exit order
5. WHEN a position's days_to_expiration falls below min_dte_exit, THE System SHALL create an exit order
6. WHEN an exit order is created, THE System SHALL update position status to "closing" and store exit_reason
7. WHEN an exit order is filled, THE System SHALL update position status to "closed" and calculate realized_pnl

### Requirement 8: A/B Testing Framework

**User Story:** As a system architect, I want deterministic routing of signals to Engine_1 or Engine_2, so that A/B test results are reproducible and statistically valid.

#### Acceptance Criteria

1. WHEN a signal enters the system, THE Strategy_Router SHALL compute a deterministic hash from symbol, timeframe, and session_id
2. WHEN the hash is computed, THE Strategy_Router SHALL assign the signal to Variant_A or Variant_B based on hash modulo
3. THE Strategy_Router SHALL store the experiment assignment in experiments table with experiment_id and variant
4. WHEN feature flag "enable_variant_b" is false, THE Strategy_Router SHALL assign all signals to Variant_A
5. WHEN feature flag "enable_variant_b" is true, THE Strategy_Router SHALL split traffic according to configured percentage
6. THE Strategy_Router SHALL emit experiment_id and variant with every signal for downstream tracking

### Requirement 9: Engine 2 Multi-Agent Core

**User Story:** As a quantitative researcher, I want multiple specialized agents to analyze signals collaboratively, so that trading decisions incorporate diverse analytical perspectives.

#### Acceptance Criteria

1. WHEN a signal is assigned to Variant_B, THE System SHALL activate Technical_Agent, Context_Agent, Risk_Agent, and Meta_Decision_Agent
2. WHEN an agent analyzes a signal, THE System SHALL provide it with shared market data from Shared_Data_Cache
3. WHEN an agent completes analysis, THE System SHALL store its output in agent_decisions table with agent name, bias, confidence, reasons, and block flag
4. THE System SHALL enforce agent output schema: agent (string), bias (bullish/bearish/neutral), confidence (0-100), reasons (array), block (boolean)
5. WHEN Risk_Agent sets block flag to true, THE Meta_Decision_Agent SHALL reject the signal regardless of other agent outputs
6. WHEN all agents complete, THE Meta_Decision_Agent SHALL aggregate outputs using weighted confidence scores
7. THE Meta_Decision_Agent SHALL produce final decision with aggregated bias, confidence, and contributing agent list

### Requirement 10: Engine 2 Specialist Agents

**User Story:** As a quantitative researcher, I want conditional specialist agents for specific market patterns, so that domain expertise is applied when relevant.

#### Acceptance Criteria

1. WHERE feature flag "enable_orb_specialist" is true, WHEN a signal occurs during RTH session opening window, THE System SHALL activate ORB_Specialist
2. WHERE feature flag "enable_strat_specialist" is true, WHEN market structure patterns are detected, THE System SHALL activate Strat_Specialist
3. WHERE feature flag "enable_ttm_specialist" is true, WHEN TTM Squeeze state is "OFF" with aligned momentum, THE System SHALL activate TTM_Specialist
4. WHEN ORB_Specialist is active, THE System SHALL analyze breakout quality and assign confidence 0-100 based on momentum follow-through
5. WHEN Strat_Specialist is active, THE System SHALL detect patterns (2-1-2, 3-1-2, 3-2-2) and assign confidence 15-95 based on structure quality
6. WHEN TTM_Specialist is active, THE System SHALL validate squeeze release quality and assign confidence 0-80 based on alignment
7. THE System SHALL store specialist agent outputs with pattern attribution (strat_pattern, orb_quality, ttm_state)

### Requirement 11: Engine 2 Sub-Agents

**User Story:** As a quantitative researcher, I want support sub-agents that provide confirmation without direct execution authority, so that experimental strategies can be evaluated safely.

#### Acceptance Criteria

1. WHERE feature flag "enable_satyland_subagent" is true, WHEN a signal is analyzed, THE System SHALL activate Satyland_SubAgent
2. WHEN Satyland_SubAgent is active, THE System SHALL analyze Pivot Ribbon alignment, ATR levels, and phase oscillator state
3. THE Satyland_SubAgent SHALL assign confidence 20-90 based on trend alignment and pullback quality
4. THE Satyland_SubAgent SHALL NOT have veto power or direct execution authority
5. THE Meta_Decision_Agent SHALL include Satyland_SubAgent output with lower weight than specialist agents
6. THE System SHALL track Satyland_SubAgent performance metrics for potential promotion to specialist status

### Requirement 12: Engine 2 Shadow Execution

**User Story:** As a quantitative researcher, I want Engine_2 decisions to be simulated without live execution, so that experimental strategies can be validated safely.

#### Acceptance Criteria

1. WHEN Meta_Decision_Agent produces a final decision for Variant_B, THE System SHALL log the decision without creating live orders
2. WHEN shadow execution is enabled, THE System SHALL simulate order creation with same logic as Engine_1
3. WHEN simulating execution, THE System SHALL use real market prices from Market_Data_Service
4. THE System SHALL store shadow trades in shadow_trades table with simulated fill prices and timestamps
5. THE System SHALL track shadow positions in shadow_positions table with simulated P&L calculations
6. THE System SHALL update shadow positions using same refresh logic as Engine_1 positions
7. WHEN shadow positions meet exit conditions, THE System SHALL simulate exit orders and calculate realized P&L

### Requirement 13: Feature Flag System

**User Story:** As a system administrator, I want granular control over Engine_2 functionality, so that experimental features can be enabled/disabled without code deployment.

#### Acceptance Criteria

1. THE System SHALL store feature flags in feature_flags table with name, enabled status, and description
2. WHEN the system starts, THE System SHALL load all feature flags into memory cache
3. THE System SHALL provide API endpoint POST /feature-flags for updating flag status (admin authentication required)
4. WHEN a feature flag is updated, THE System SHALL refresh the memory cache within 5 seconds
5. THE System SHALL default all Engine_2 feature flags to false (enable_variant_b, enable_orb_specialist, enable_strat_specialist, enable_ttm_specialist, enable_satyland_subagent, enable_shadow_execution)
6. WHEN enable_variant_b is false, THE System SHALL route 100% of traffic to Variant_A regardless of other flag states

### Requirement 14: Event-Sourced Logging

**User Story:** As a quantitative researcher, I want complete audit trails of all agent decisions, so that I can replay and analyze decision-making processes.

#### Acceptance Criteria

1. WHEN a signal is processed by Engine_2, THE System SHALL log experiment_id, variant, and shared_data_reference
2. THE System SHALL log all active agent names and their individual outputs (bias, confidence, reasons, block)
3. THE System SHALL log Meta_Decision_Agent final decision with aggregation methodology
4. THE System SHALL log all timestamps (signal_received, enrichment_complete, agents_complete, decision_final)
5. THE System SHALL store logs in append-only format without updates or deletions
6. THE System SHALL enable replay of any signal processing by loading logged data and re-executing agent logic

### Requirement 15: Database Schema and Migrations

**User Story:** As a developer, I want a well-structured database schema with proper migrations, so that data integrity is maintained and schema evolution is controlled.

#### Acceptance Criteria

1. THE System SHALL implement PostgreSQL database with tables: signals, refactored_signals, orders, trades, refactored_positions, exit_rules, risk_limits, experiments, agent_decisions, shadow_trades, shadow_positions, agent_performance, feature_flags
2. THE System SHALL use foreign key constraints to maintain referential integrity between related tables
3. THE System SHALL create indexes on frequently queried columns (status, created_at, symbol, experiment_id)
4. THE System SHALL implement database migrations using a migration tool (node-pg-migrate or similar)
5. THE System SHALL version all schema changes with up and down migration scripts
6. WHEN a migration is applied, THE System SHALL record it in schema_migrations table with timestamp

### Requirement 16: API Endpoints for Engine 2

**User Story:** As a frontend developer, I want REST API endpoints for Engine_2 data, so that I can build dashboards showing A/B test results and agent performance.

#### Acceptance Criteria

1. THE System SHALL provide GET /experiments endpoint returning list of all A/B experiments with metadata
2. THE System SHALL provide GET /experiments/:id/results endpoint returning performance comparison between Variant_A and Variant_B
3. THE System SHALL provide GET /agents/performance endpoint returning per-agent metrics (accuracy, confidence calibration, win rate)
4. THE System SHALL provide GET /shadow-trades endpoint returning shadow trade history with filters (date range, symbol, agent)
5. THE System SHALL provide GET /shadow-positions endpoint returning current and historical shadow positions
6. THE System SHALL provide POST /feature-flags endpoint for updating feature flag status (admin authentication required)
7. THE System SHALL return all responses in JSON format with appropriate HTTP status codes

### Requirement 17: Frontend Dashboard Integration

**User Story:** As a trader, I want a unified dashboard showing both Engine_1 and Engine_2 performance, so that I can compare traditional and experimental approaches.

#### Acceptance Criteria

1. THE System SHALL provide a dashboard page displaying Engine_1 live positions and Engine_2 shadow positions side-by-side
2. THE System SHALL provide an experiments page showing A/B test results with statistical significance indicators
3. THE System SHALL provide an agent performance page showing individual agent metrics and confidence calibration charts
4. THE System SHALL provide a feature flags admin page for enabling/disabling Engine_2 functionality
5. THE System SHALL update all dashboard metrics in real-time using polling (30-second intervals)
6. THE System SHALL display loading states during data fetches and error messages when API calls fail

### Requirement 18: Error Handling and Resilience

**User Story:** As a system administrator, I want robust error handling and graceful degradation, so that transient failures do not crash the system.

#### Acceptance Criteria

1. WHEN an external API call fails, THE System SHALL retry up to 3 times with exponential backoff
2. WHEN all retries are exhausted, THE System SHALL log the error and continue processing other signals
3. WHEN a worker encounters an unhandled exception, THE System SHALL log the error with stack trace and restart the worker
4. WHEN database connection is lost, THE System SHALL attempt reconnection every 5 seconds up to 10 times
5. WHEN Market_Data_Service primary API fails, THE System SHALL automatically fallback to backup API
6. THE System SHALL implement circuit breaker pattern for external API calls (open after 5 consecutive failures, half-open after 60 seconds)

### Requirement 19: Performance and Monitoring

**User Story:** As a system administrator, I want performance metrics and health monitoring, so that I can detect and resolve issues proactively.

#### Acceptance Criteria

1. THE System SHALL complete database queries in less than 1 second for 95th percentile
2. THE System SHALL maintain cache hit rate above 70% for market data requests
3. THE System SHALL log worker execution time for each run and alert when exceeding 5 seconds
4. THE System SHALL provide health check endpoint GET /health returning status of database, cache, and external APIs
5. THE System SHALL track and expose metrics: signals_processed_per_minute, orders_created_per_minute, api_calls_per_minute, cache_hit_rate, worker_execution_time
6. THE System SHALL log all errors with severity levels (ERROR, WARN, INFO) and structured metadata

### Requirement 20: Authentication and Authorization

**User Story:** As a system administrator, I want secure authentication and role-based access control, so that sensitive operations are protected.

#### Acceptance Criteria

1. THE System SHALL implement JWT-based authentication for all API endpoints except webhooks and health checks
2. WHEN a user logs in with valid credentials, THE System SHALL issue a JWT token with 24-hour expiration
3. WHEN a request includes a valid JWT token, THE System SHALL extract user_id and role from token claims
4. THE System SHALL restrict POST /feature-flags endpoint to users with "admin" role
5. THE System SHALL restrict access to shadow trading data to users with "researcher" or "admin" role
6. WHEN a request includes an invalid or expired token, THE System SHALL return HTTP 401 Unauthorized

### Requirement 21: Deployment and Configuration

**User Story:** As a DevOps engineer, I want containerized deployment with environment-based configuration, so that the system can be deployed consistently across environments.

#### Acceptance Criteria

1. THE System SHALL provide a Dockerfile for building a production-ready container image
2. THE System SHALL read configuration from environment variables (DATABASE_URL, ALPACA_API_KEY, JWT_SECRET, etc.)
3. THE System SHALL validate all required environment variables on startup and exit with error if missing
4. THE System SHALL support deployment to Fly.io with provided fly.toml configuration
5. THE System SHALL run database migrations automatically on startup before starting workers
6. THE System SHALL expose metrics endpoint for Prometheus scraping (optional)

### Requirement 22: Testing Requirements

**User Story:** As a developer, I want comprehensive test coverage, so that regressions are caught before production deployment.

#### Acceptance Criteria

1. THE System SHALL include unit tests for all service modules (market-data, signal-processor, order-creator, etc.)
2. THE System SHALL include integration tests for end-to-end flows (webhook → signal → order → trade → position → exit)
3. THE System SHALL include tests for A/B routing logic ensuring deterministic variant assignment
4. THE System SHALL include tests for agent output schema validation
5. THE System SHALL include tests for shadow execution ensuring no live orders are created
6. THE System SHALL achieve minimum 80% code coverage for core business logic

### Requirement 23: Data Retention and Archival

**User Story:** As a compliance officer, I want configurable data retention policies, so that historical data is preserved according to regulatory requirements.

#### Acceptance Criteria

1. THE System SHALL retain all signals, orders, trades, and positions indefinitely by default
2. THE System SHALL retain agent_decisions and shadow_trades for minimum 90 days
3. WHERE data retention policy is configured, THE System SHALL archive records older than retention period to cold storage
4. THE System SHALL provide API endpoint for exporting historical data in CSV format
5. WHEN exporting data, THE System SHALL include all relevant fields and maintain referential integrity
6. THE System SHALL log all data export operations with user_id and timestamp for audit trail

### Requirement 24: Rate Limiting and Throttling

**User Story:** As a system administrator, I want rate limiting on external API calls, so that vendor rate limits are not exceeded and costs are controlled.

#### Acceptance Criteria

1. THE System SHALL implement rate limiter for Alpaca API calls (200 requests per minute)
2. THE System SHALL implement rate limiter for TwelveData API calls (800 requests per day)
3. WHEN rate limit is approaching (90% of limit), THE System SHALL log a warning
4. WHEN rate limit is exceeded, THE System SHALL queue requests and process them when limit resets
5. THE System SHALL track API usage per endpoint and expose metrics via /metrics endpoint
6. THE System SHALL provide configuration for rate limits via environment variables

### Requirement 25: Graceful Shutdown

**User Story:** As a DevOps engineer, I want graceful shutdown handling, so that in-flight operations complete before process termination.

#### Acceptance Criteria

1. WHEN the system receives SIGTERM or SIGINT signal, THE System SHALL stop accepting new webhook requests
2. WHEN shutdown is initiated, THE System SHALL wait for all active workers to complete their current iteration
3. THE System SHALL set maximum shutdown timeout of 30 seconds
4. WHEN shutdown timeout is reached, THE System SHALL force-terminate remaining operations and log incomplete tasks
5. THE System SHALL close all database connections and cache connections before exit
6. THE System SHALL log shutdown initiation and completion with timestamps

