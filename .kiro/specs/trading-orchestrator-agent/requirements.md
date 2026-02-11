# Requirements Document: Trading Orchestrator Agent

## Introduction

The Trading Orchestrator Agent is a coordination layer for a dual-engine options trading platform that ensures fair comparison between Engine A (rule-based) and Engine B (multi-agent AI). The orchestrator acts as a referee, distributing identical inputs to both engines, managing experiment attribution, enforcing execution policies, and tracking outcomes without modifying engine logic or making trading decisions itself.

## Glossary

- **Orchestrator**: The coordination system that manages signal distribution, experiment creation, and execution policy enforcement
- **Engine_A**: The rule-based trading engine that processes signals asynchronously via workers
- **Engine_B**: The multi-agent AI trading engine that processes signals synchronously
- **Signal**: A normalized trading opportunity record stored in the signals table from TradingView webhooks
- **Experiment**: A record that tracks which variant (engine) was assigned to process a signal
- **Execution_Policy**: The rules determining which engine executes real trades vs shadow trades
- **Shadow_Trade**: A simulated trade created by the non-executing engine that follows the same exit logic as real trades
- **Variant**: The engine assignment (A or B) for a specific experiment
- **Signal_Hash**: A SHA-256 hash of signal inputs ensuring deterministic processing
- **Assignment_Hash**: A deterministic hash used for variant assignment to ensure replayability
- **Execution_Mode**: The operational mode (SHADOW_ONLY, ENGINE_A_PRIMARY, ENGINE_B_PRIMARY, SPLIT_CAPITAL)
- **Market_Context**: The complete market state snapshot including timestamp, prices, and indicators at signal time
- **Worker**: An asynchronous process that polls database tables on intervals to process signals

## Requirements

### Requirement 1: Signal Normalization and Distribution

**User Story:** As a platform operator, I want both engines to receive identical normalized signals with the same timestamp and market context, so that performance comparisons are fair and deterministic.

#### Acceptance Criteria

1. WHEN a signal is stored in the signals table, THE Orchestrator SHALL retrieve it with all required fields (signal_id, symbol, direction, timeframe, timestamp, signal_hash, raw_payload)
2. WHEN normalizing a signal, THE Orchestrator SHALL create a Market_Context snapshot containing timestamp, current prices, and relevant market data
3. WHEN distributing a signal, THE Orchestrator SHALL provide identical Market_Context to both Engine_A and Engine_B
4. THE Orchestrator SHALL NOT modify signal data during distribution
5. WHEN a signal is distributed, THE Orchestrator SHALL record the distribution timestamp and Market_Context hash for audit purposes

### Requirement 2: Experiment Creation and Attribution

**User Story:** As a data analyst, I want every signal to create an experiment record with deterministic variant assignment, so that I can track which engine processed each signal and replay decisions.

#### Acceptance Criteria

1. WHEN a signal is processed, THE Orchestrator SHALL create exactly one experiment record in the experiments table
2. THE Orchestrator SHALL generate a deterministic Assignment_Hash from signal_id and signal_hash
3. WHEN assigning a variant, THE Orchestrator SHALL use the Assignment_Hash to deterministically select Engine_A or Engine_B
4. THE Orchestrator SHALL store experiment_id, signal_id, variant, assignment_hash, and split_percentage in the experiments table
5. FOR ALL experiments with the same signal_id and signal_hash, THE Orchestrator SHALL assign the same variant (deterministic replay)

### Requirement 3: Execution Policy Enforcement

**User Story:** As a platform operator, I want the orchestrator to enforce execution policies that determine which engine executes real trades, so that I can control capital allocation and prevent double execution.

#### Acceptance Criteria

1. WHEN APP_MODE is PAPER and Engine_A is available, THE Orchestrator SHALL set execution_mode to ENGINE_A_PRIMARY
2. WHEN execution_mode is ENGINE_A_PRIMARY, THE Orchestrator SHALL allow Engine_A to execute real trades and require Engine_B to create shadow trades
3. WHEN Engine_A is unavailable, THE Orchestrator SHALL set execution_mode to SHADOW_ONLY
4. WHEN execution_mode is SHADOW_ONLY, THE Orchestrator SHALL prevent both engines from executing real trades
5. THE Orchestrator SHALL NEVER allow both Engine_A and Engine_B to execute real trades simultaneously for the same signal
6. THE Orchestrator SHALL store execution policy decisions in an execution_policy table with experiment_id, execution_mode, executed_engine, shadow_engine, reason, and policy_version

### Requirement 4: Shadow Trade Enforcement

**User Story:** As a platform operator, I want the non-executing engine to create shadow trades that follow the same exit logic as real trades, so that I can compare engine performance fairly.

#### Acceptance Criteria

1. WHEN an engine is assigned as shadow_engine, THE Orchestrator SHALL require that engine to create shadow trade records
2. WHEN a real trade exits, THE Orchestrator SHALL trigger the corresponding shadow trade to exit with the same timestamp and market conditions
3. THE Orchestrator SHALL track shadow trade outcomes separately from real trade outcomes
4. WHEN a shadow trade is created, THE Orchestrator SHALL link it to the experiment_id for attribution
5. THE Orchestrator SHALL validate that shadow trades use the same entry and exit logic as real trades

### Requirement 5: Outcome Attribution and Tracking

**User Story:** As a data analyst, I want to track performance metrics per engine even when not executing, so that I can compare Engine_A vs Engine_B performance over time.

#### Acceptance Criteria

1. WHEN a trade completes (real or shadow), THE Orchestrator SHALL record the outcome with experiment_id, engine variant, P&L, entry_price, exit_price, and exit_reason
2. THE Orchestrator SHALL maintain separate outcome tables for real trades and shadow trades
3. WHEN querying performance, THE Orchestrator SHALL aggregate outcomes by engine variant
4. THE Orchestrator SHALL calculate performance metrics including win rate, average P&L, and Sharpe ratio per engine
5. FOR ALL experiments, THE Orchestrator SHALL enable answering: "Which engine recommended this trade, and why did it execute?"

### Requirement 6: Determinism and Replayability

**User Story:** As a system architect, I want all orchestrator decisions to be deterministic and replayable, so that I can debug issues and verify system behavior.

#### Acceptance Criteria

1. WHEN processing a signal with the same signal_id and signal_hash, THE Orchestrator SHALL produce identical experiment records and execution decisions
2. THE Orchestrator SHALL NOT use random number generation or non-deterministic algorithms for variant assignment
3. THE Orchestrator SHALL NOT invoke LLM APIs or other non-deterministic services during signal processing
4. WHEN replaying an experiment, THE Orchestrator SHALL use stored Market_Context to reproduce the same inputs
5. THE Orchestrator SHALL maintain a policy_version field to track execution policy changes over time

### Requirement 7: Architectural Separation of Concerns

**User Story:** As a system architect, I want the orchestrator to coordinate without making trading decisions, so that engine logic remains independent and testable.

#### Acceptance Criteria

1. THE Orchestrator SHALL NOT calculate technical indicators or fetch market data directly
2. THE Orchestrator SHALL NOT modify engine rules, agent weights, or trading parameters
3. THE Orchestrator SHALL NOT select strikes, calculate position sizes, or apply exit logic
4. THE Orchestrator SHALL NOT override engine decisions or recommendations
5. WHEN an engine produces a trade recommendation, THE Orchestrator SHALL record it without modification

### Requirement 8: Webhook Handler Refactoring

**User Story:** As a system architect, I want the webhook handler to only validate and store signals, so that signal processing is unified and Engine_B is not invoked synchronously.

#### Acceptance Criteria

1. WHEN a TradingView webhook is received, THE Webhook_Handler SHALL validate the payload structure
2. WHEN validation passes, THE Webhook_Handler SHALL store the signal in the signals table
3. THE Webhook_Handler SHALL return HTTP 200 within 3 seconds of receiving the webhook
4. THE Webhook_Handler SHALL NOT invoke Engine_B synchronously
5. THE Webhook_Handler SHALL NOT perform signal normalization or experiment creation

### Requirement 9: Unified Signal Processing Path

**User Story:** As a system architect, I want both engines to consume signals from the same normalized source, so that processing is consistent and fair.

#### Acceptance Criteria

1. WHEN Engine_A processes a signal, THE Orchestrator SHALL provide the normalized signal from the signals table
2. WHEN Engine_B processes a signal, THE Orchestrator SHALL provide the same normalized signal from the signals table
3. THE Orchestrator SHALL ensure both engines receive signals with identical Market_Context snapshots
4. THE Orchestrator SHALL NOT create separate signal records for Engine_A and Engine_B
5. WHEN a signal is processed, THE Orchestrator SHALL mark it as processed to prevent duplicate processing

### Requirement 10: Concurrency and Idempotency

**User Story:** As a platform operator, I want the orchestrator to handle concurrent signal processing safely, so that multiple worker instances don't create duplicate experiments or double-execute trades.

#### Acceptance Criteria

1. WHEN multiple workers attempt to process the same signal, THE Orchestrator SHALL ensure only one experiment is created
2. THE Orchestrator SHALL use database transactions with appropriate isolation levels to prevent race conditions
3. WHEN an experiment already exists for a signal_id, THE Orchestrator SHALL skip experiment creation
4. THE Orchestrator SHALL use optimistic locking or SELECT FOR UPDATE to prevent concurrent execution
5. WHEN a signal is being processed, THE Orchestrator SHALL mark it with a processing_lock to prevent duplicate work

### Requirement 11: Observability and Logging

**User Story:** As a platform operator, I want structured logs for all orchestrator operations, so that I can debug issues and monitor system health.

#### Acceptance Criteria

1. WHEN a signal is retrieved, THE Orchestrator SHALL log signal_id, symbol, direction, and timestamp
2. WHEN an experiment is created, THE Orchestrator SHALL log experiment_id, signal_id, variant, and assignment_hash
3. WHEN an execution policy is applied, THE Orchestrator SHALL log experiment_id, execution_mode, executed_engine, and policy_version
4. WHEN a shadow trade is created, THE Orchestrator SHALL log experiment_id, engine, and shadow_trade_id
5. WHEN an error occurs, THE Orchestrator SHALL log the error with full context including signal_id and experiment_id

### Requirement 12: Configuration Management

**User Story:** As a platform operator, I want to change execution policies via configuration without code changes, so that I can adapt to different market conditions and testing scenarios.

#### Acceptance Criteria

1. THE Orchestrator SHALL read execution policy configuration from environment variables or a configuration table
2. WHEN configuration changes, THE Orchestrator SHALL apply the new policy to new experiments without restart
3. THE Orchestrator SHALL support execution modes: SHADOW_ONLY, ENGINE_A_PRIMARY, ENGINE_B_PRIMARY, SPLIT_CAPITAL
4. WHEN SPLIT_CAPITAL mode is configured, THE Orchestrator SHALL use split_percentage to allocate capital between engines
5. THE Orchestrator SHALL validate configuration on startup and reject invalid policy settings
