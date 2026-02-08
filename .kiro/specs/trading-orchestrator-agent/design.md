# Design Document: Trading Orchestrator Agent

## Overview

The Trading Orchestrator Agent is a coordination layer that ensures fair comparison between two trading engines by distributing identical inputs, managing experiments, and enforcing execution policies. The orchestrator operates as a stateless referee that reads from and writes to PostgreSQL, coordinating asynchronous workers without making trading decisions.

The system follows these core principles:
- **Determinism**: Same inputs always produce same outputs
- **Separation of Concerns**: Orchestrator coordinates, engines decide
- **Fair Comparison**: Both engines receive identical market context
- **Replayability**: All decisions can be reconstructed from stored data
- **Idempotency**: Safe concurrent processing across multiple workers

## Architecture

### System Context

```
TradingView → Webhook Handler → PostgreSQL (signals table)
                                      ↓
                            Signal Processing Workers
                                      ↓
                              Orchestrator Service
                                   ↙     ↘
                            Engine A      Engine B
                          (async worker) (sync/async)
                                   ↓         ↓
                            Real Trades  Shadow Trades
                                      ↓
                              PostgreSQL (experiments, trades, outcomes)
```

### Key Architectural Changes

1. **Webhook Handler Simplification**: Remove Engine B synchronous invocation, only validate and store
2. **Unified Signal Path**: Both engines consume from the same signals table with identical Market_Context
3. **Orchestrator as Coordinator**: New service layer that manages experiment creation and execution policy

### Data Flow

1. **Signal Intake**: TradingView → Webhook → signals table
2. **Signal Processing**: Worker polls signals → Orchestrator retrieves unprocessed signals
3. **Experiment Creation**: Orchestrator creates experiment record with deterministic variant assignment
4. **Policy Enforcement**: Orchestrator determines execution_mode based on policy
5. **Engine Invocation**: Orchestrator provides identical inputs to both engines
6. **Trade Execution**: Primary engine executes real trade, shadow engine creates shadow trade
7. **Outcome Tracking**: Both engines record outcomes linked to experiment_id

## Components and Interfaces

### 1. Orchestrator Service

**Responsibilities:**
- Retrieve unprocessed signals from signals table
- Create experiment records with deterministic variant assignment
- Enforce execution policy
- Distribute identical Market_Context to both engines
- Track outcomes and link to experiments

**Interface:**

```python
class OrchestratorService:
    def process_signals(self) -> List[ExperimentResult]:
        """
        Main entry point for signal processing.
        Polls signals table and processes unprocessed signals.
        """
        
    def create_experiment(self, signal: Signal) -> Experiment:
        """
        Creates experiment record with deterministic variant assignment.
        Returns: Experiment with experiment_id, variant, assignment_hash
        """
        
    def get_execution_policy(self, experiment: Experiment) -> ExecutionPolicy:
        """
        Determines execution policy based on configuration and system state.
        Returns: ExecutionPolicy with execution_mode, executed_engine, shadow_engine
        """
        
    def distribute_signal(self, signal: Signal, experiment: Experiment, policy: ExecutionPolicy) -> None:
        """
        Distributes signal with Market_Context to both engines.
        Ensures identical inputs for fair comparison.
        """
        
    def track_outcome(self, experiment_id: str, engine: str, outcome: TradeOutcome) -> None:
        """
        Records trade outcome linked to experiment for attribution.
        """
```

### 2. Signal Processor

**Responsibilities:**
- Retrieve unprocessed signals from database
- Create Market_Context snapshot
- Mark signals as processed to prevent duplicates

**Interface:**

```python
class SignalProcessor:
    def get_unprocessed_signals(self, limit: int = 10) -> List[Signal]:
        """
        Retrieves unprocessed signals with SELECT FOR UPDATE to prevent race conditions.
        """
        
    def create_market_context(self, signal: Signal) -> MarketContext:
        """
        Creates snapshot of market state at signal timestamp.
        Includes prices, indicators, and metadata.
        """
        
    def mark_processed(self, signal_id: str, experiment_id: str) -> None:
        """
        Marks signal as processed and links to experiment.
        """
```

### 3. Experiment Manager

**Responsibilities:**
- Generate deterministic variant assignments
- Create and store experiment records
- Prevent duplicate experiments

**Interface:**

```python
class ExperimentManager:
    def create_experiment(self, signal: Signal) -> Experiment:
        """
        Creates experiment with deterministic variant assignment.
        Uses signal_id and signal_hash for assignment_hash.
        """
        
    def get_variant_assignment(self, assignment_hash: str, split_percentage: float) -> str:
        """
        Deterministically assigns variant (A or B) based on hash.
        Uses modulo operation on hash for determinism.
        """
        
    def experiment_exists(self, signal_id: str) -> bool:
        """
        Checks if experiment already exists for signal.
        """
```

### 4. Policy Engine

**Responsibilities:**
- Read execution policy configuration
- Determine execution mode based on policy and system state
- Validate policy configuration

**Interface:**

```python
class PolicyEngine:
    def get_execution_policy(self, experiment: Experiment) -> ExecutionPolicy:
        """
        Determines execution policy for experiment.
        Returns policy with execution_mode, executed_engine, shadow_engine.
        """
        
    def validate_policy(self, policy_config: Dict) -> bool:
        """
        Validates policy configuration on startup.
        """
        
    def check_engine_availability(self, engine: str) -> bool:
        """
        Checks if engine is available for execution.
        """
```

### 5. Engine Coordinator

**Responsibilities:**
- Invoke engines with identical inputs
- Ensure shadow trade creation
- Synchronize exit logic between real and shadow trades

**Interface:**

```python
class EngineCoordinator:
    def invoke_engine_a(self, signal: Signal, context: MarketContext, is_shadow: bool) -> TradeRecommendation:
        """
        Invokes Engine A with signal and market context.
        """
        
    def invoke_engine_b(self, signal: Signal, context: MarketContext, is_shadow: bool) -> TradeRecommendation:
        """
        Invokes Engine B with signal and market context.
        """
        
    def synchronize_exits(self, real_trade_id: str, shadow_trade_id: str) -> None:
        """
        Ensures shadow trade exits when real trade exits.
        """
```

## Data Models

### Signal

```python
@dataclass
class Signal:
    signal_id: str  # UUID
    symbol: str  # e.g., "SPY"
    direction: str  # "long" | "short"
    timeframe: str  # "5m" | "15m" | "1h"
    timestamp: datetime  # ISO8601
    signal_hash: str  # SHA-256 of signal inputs
    raw_payload: Dict  # Original webhook payload
    processed: bool  # Processing status
    experiment_id: Optional[str]  # Link to experiment
```

### MarketContext

```python
@dataclass
class MarketContext:
    timestamp: datetime  # Snapshot time
    symbol: str
    current_price: float
    bid: float
    ask: float
    volume: int
    indicators: Dict[str, float]  # Technical indicators
    context_hash: str  # SHA-256 of context for audit
```

### Experiment

```python
@dataclass
class Experiment:
    experiment_id: str  # UUID
    signal_id: str  # Foreign key to signals
    variant: str  # "A" | "B"
    assignment_hash: str  # Deterministic hash for variant assignment
    split_percentage: float  # Capital split (0.0 to 1.0)
    created_at: datetime
    policy_version: str  # e.g., "v1.0"
```

### ExecutionPolicy

```python
@dataclass
class ExecutionPolicy:
    experiment_id: str
    execution_mode: str  # "SHADOW_ONLY" | "ENGINE_A_PRIMARY" | "ENGINE_B_PRIMARY" | "SPLIT_CAPITAL"
    executed_engine: Optional[str]  # "A" | "B" | None
    shadow_engine: Optional[str]  # "A" | "B" | None
    reason: str  # Human-readable explanation
    policy_version: str  # e.g., "v1.0"
    created_at: datetime
```

### TradeRecommendation

```python
@dataclass
class TradeRecommendation:
    experiment_id: str
    engine: str  # "A" | "B"
    symbol: str
    direction: str
    strike: float
    expiration: date
    quantity: int
    entry_price: float
    stop_loss: Optional[float]
    take_profit: Optional[float]
    is_shadow: bool
```

### TradeOutcome

```python
@dataclass
class TradeOutcome:
    outcome_id: str  # UUID
    experiment_id: str
    engine: str  # "A" | "B"
    trade_id: str  # Foreign key to trades or shadow_trades
    entry_price: float
    exit_price: float
    pnl: float
    exit_reason: str  # "stop_loss" | "take_profit" | "manual" | "expiration"
    entry_time: datetime
    exit_time: datetime
    is_shadow: bool
```

## Database Schema

### Tables

```sql
-- Existing: signals table (from webhook handler)
CREATE TABLE signals (
    signal_id UUID PRIMARY KEY,
    symbol VARCHAR(10) NOT NULL,
    direction VARCHAR(10) NOT NULL,
    timeframe VARCHAR(10) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    signal_hash VARCHAR(64) NOT NULL,
    raw_payload JSONB NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    experiment_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_signals_processed ON signals(processed) WHERE processed = FALSE;
CREATE INDEX idx_signals_timestamp ON signals(timestamp DESC);

-- New: experiments table
CREATE TABLE experiments (
    experiment_id UUID PRIMARY KEY,
    signal_id UUID NOT NULL REFERENCES signals(signal_id),
    variant VARCHAR(1) NOT NULL CHECK (variant IN ('A', 'B')),
    assignment_hash VARCHAR(64) NOT NULL,
    split_percentage DECIMAL(3,2) NOT NULL DEFAULT 0.50,
    policy_version VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(signal_id)
);

CREATE INDEX idx_experiments_variant ON experiments(variant);
CREATE INDEX idx_experiments_created_at ON experiments(created_at DESC);

-- New: execution_policies table
CREATE TABLE execution_policies (
    policy_id UUID PRIMARY KEY,
    experiment_id UUID NOT NULL REFERENCES experiments(experiment_id),
    execution_mode VARCHAR(30) NOT NULL,
    executed_engine VARCHAR(1) CHECK (executed_engine IN ('A', 'B')),
    shadow_engine VARCHAR(1) CHECK (shadow_engine IN ('A', 'B')),
    reason TEXT NOT NULL,
    policy_version VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_execution_policies_experiment ON execution_policies(experiment_id);

-- New: market_contexts table (for audit and replay)
CREATE TABLE market_contexts (
    context_id UUID PRIMARY KEY,
    signal_id UUID NOT NULL REFERENCES signals(signal_id),
    timestamp TIMESTAMPTZ NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    current_price DECIMAL(10,2) NOT NULL,
    bid DECIMAL(10,2) NOT NULL,
    ask DECIMAL(10,2) NOT NULL,
    volume INTEGER NOT NULL,
    indicators JSONB NOT NULL,
    context_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_market_contexts_signal ON market_contexts(signal_id);

-- New: trade_outcomes table
CREATE TABLE trade_outcomes (
    outcome_id UUID PRIMARY KEY,
    experiment_id UUID NOT NULL REFERENCES experiments(experiment_id),
    engine VARCHAR(1) NOT NULL CHECK (engine IN ('A', 'B')),
    trade_id UUID NOT NULL,
    entry_price DECIMAL(10,2) NOT NULL,
    exit_price DECIMAL(10,2) NOT NULL,
    pnl DECIMAL(10,2) NOT NULL,
    exit_reason VARCHAR(20) NOT NULL,
    entry_time TIMESTAMPTZ NOT NULL,
    exit_time TIMESTAMPTZ NOT NULL,
    is_shadow BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_trade_outcomes_experiment ON trade_outcomes(experiment_id);
CREATE INDEX idx_trade_outcomes_engine ON trade_outcomes(engine);
CREATE INDEX idx_trade_outcomes_is_shadow ON trade_outcomes(is_shadow);
```

## Processing Flow

### Signal Processing Workflow

```
1. Worker polls signals table for unprocessed signals
   SELECT * FROM signals WHERE processed = FALSE LIMIT 10 FOR UPDATE SKIP LOCKED

2. For each signal:
   a. Check if experiment exists (idempotency)
   b. Create Market_Context snapshot
   c. Create Experiment with deterministic variant assignment
   d. Get Execution Policy based on configuration
   e. Distribute signal + context to both engines
   f. Track outcomes
   g. Mark signal as processed

3. Commit transaction
```

### Variant Assignment Algorithm

```python
def get_variant_assignment(assignment_hash: str, split_percentage: float) -> str:
    """
    Deterministic variant assignment using hash modulo.
    
    Args:
        assignment_hash: SHA-256 hash of signal_id + signal_hash
        split_percentage: Percentage allocated to Engine A (0.0 to 1.0)
    
    Returns:
        "A" or "B"
    """
    # Convert hash to integer
    hash_int = int(assignment_hash[:16], 16)
    
    # Use modulo 100 for percentage-based assignment
    bucket = hash_int % 100
    
    # Assign based on split_percentage
    threshold = int(split_percentage * 100)
    return "A" if bucket < threshold else "B"
```

### Execution Policy Logic (v1.0)

```python
def get_execution_policy(experiment: Experiment) -> ExecutionPolicy:
    """
    Determines execution policy based on configuration and system state.
    
    Policy v1.0:
    - If APP_MODE = PAPER and Engine A available: ENGINE_A_PRIMARY
    - If Engine A unavailable: SHADOW_ONLY
    - Never allow both engines to execute real capital
    """
    app_mode = os.getenv("APP_MODE", "PAPER")
    engine_a_available = check_engine_availability("A")
    
    if app_mode == "PAPER" and engine_a_available:
        return ExecutionPolicy(
            experiment_id=experiment.experiment_id,
            execution_mode="ENGINE_A_PRIMARY",
            executed_engine="A",
            shadow_engine="B",
            reason="Paper trading mode with Engine A as primary",
            policy_version="v1.0"
        )
    else:
        return ExecutionPolicy(
            experiment_id=experiment.experiment_id,
            execution_mode="SHADOW_ONLY",
            executed_engine=None,
            shadow_engine="A" if not engine_a_available else "B",
            reason="Engine A unavailable or non-paper mode",
            policy_version="v1.0"
        )
```

### Shadow Trade Synchronization

When a real trade exits:
1. Query shadow_trades table for matching experiment_id
2. Apply same exit logic with same timestamp and market conditions
3. Record outcome for shadow trade
4. Link both outcomes to experiment_id for comparison

## Error Handling

### Error Categories

1. **Signal Processing Errors**
   - Invalid signal format: Log error, skip signal, continue processing
   - Missing required fields: Log error, mark signal as failed, continue
   - Database connection errors: Retry with exponential backoff, alert on repeated failures

2. **Experiment Creation Errors**
   - Duplicate experiment: Skip creation, use existing experiment_id
   - Hash collision: Log warning, use signal_id as tiebreaker
   - Transaction conflicts: Retry with exponential backoff

3. **Engine Invocation Errors**
   - Engine A unavailable: Switch to SHADOW_ONLY mode, log alert
   - Engine B unavailable: Continue with Engine A only, log warning
   - Timeout: Log error, mark experiment as failed, continue

4. **Policy Enforcement Errors**
   - Invalid policy configuration: Fail fast on startup, reject invalid config
   - Policy version mismatch: Log warning, use latest policy version

### Error Recovery

- **Transient Errors**: Retry with exponential backoff (max 3 attempts)
- **Permanent Errors**: Log error, mark record as failed, alert operator
- **Partial Failures**: Complete successful operations, log failures for manual review

### Logging Strategy

All errors must include:
- `signal_id`: For tracing back to original signal
- `experiment_id`: For linking to experiment (if created)
- `error_type`: Category of error
- `error_message`: Detailed error description
- `stack_trace`: Full stack trace for debugging
- `timestamp`: When error occurred

## Testing Strategy

The Trading Orchestrator Agent requires both unit tests and property-based tests to ensure correctness, determinism, and fair comparison between engines.

### Unit Testing

Unit tests will focus on:
- **Specific Examples**: Verify correct behavior for known signal inputs
- **Edge Cases**: Empty signals, missing fields, invalid timestamps
- **Error Conditions**: Database failures, engine unavailability, timeout scenarios
- **Integration Points**: Database transactions, engine invocations, policy enforcement

### Property-Based Testing

Property-based tests will verify universal properties across randomized inputs. Each test will run a minimum of 100 iterations to ensure comprehensive coverage.

**Configuration:**
- Testing Library: Hypothesis (Python)
- Minimum Iterations: 100 per property test
- Tag Format: `# Feature: trading-orchestrator-agent, Property {N}: {property_text}`

**Test Data Generators:**
- Random signals with valid structure
- Random market contexts with realistic prices
- Random experiment configurations
- Random execution policies

### Testing Approach

1. **Unit Tests**: Validate specific scenarios and edge cases
2. **Property Tests**: Validate universal correctness properties
3. **Integration Tests**: Validate end-to-end flows with real database
4. **Replay Tests**: Validate determinism by replaying stored experiments

Both unit and property tests are complementary and necessary for comprehensive coverage.


## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Signal Retrieval Completeness
*For any* signal stored in the signals table, when the Orchestrator retrieves it, all required fields (signal_id, symbol, direction, timeframe, timestamp, signal_hash, raw_payload) should be present and non-null.

**Validates: Requirements 1.1**

### Property 2: Market Context Creation
*For any* signal processed by the Orchestrator, a valid Market_Context snapshot should be created containing timestamp, symbol, current_price, bid, ask, volume, indicators, and context_hash.

**Validates: Requirements 1.2**

### Property 3: Identical Inputs to Both Engines
*For any* signal distributed by the Orchestrator, both Engine A and Engine B should receive identical Market_Context (verified by matching context_hash) and identical normalized signal data.

**Validates: Requirements 1.3, 9.1, 9.2, 9.3**

### Property 4: Signal Immutability During Distribution
*For any* signal, the signal_hash before distribution should equal the signal_hash after distribution, ensuring no modification occurred.

**Validates: Requirements 1.4, 7.5**

### Property 5: Distribution Audit Trail
*For any* signal distributed by the Orchestrator, a market_contexts record should exist with matching signal_id, distribution timestamp, and context_hash.

**Validates: Requirements 1.5**

### Property 6: Experiment Creation Idempotency
*For any* signal_id, no matter how many times the Orchestrator processes it (including concurrent attempts), exactly one experiment record should exist in the experiments table.

**Validates: Requirements 2.1, 10.1, 10.3**

### Property 7: Deterministic Assignment Hash Generation
*For any* signal with the same signal_id and signal_hash, the Orchestrator should generate the same assignment_hash every time, regardless of when or how many times it's computed.

**Validates: Requirements 2.2**

### Property 8: Deterministic Variant Assignment (Replay Property)
*For any* signal with the same signal_id and signal_hash, the Orchestrator should assign the same variant (A or B) every time, ensuring experiments can be replayed with identical results.

**Validates: Requirements 2.3, 2.5, 6.1, 6.4**

### Property 9: Experiment Record Completeness
*For any* experiment created by the Orchestrator, all required fields (experiment_id, signal_id, variant, assignment_hash, split_percentage, policy_version) should be present and stored in the database.

**Validates: Requirements 2.4**

### Property 10: Execution Policy Enforcement for ENGINE_A_PRIMARY
*For any* experiment with execution_mode set to ENGINE_A_PRIMARY, the execution policy should have executed_engine="A" and shadow_engine="B".

**Validates: Requirements 3.2**

### Property 11: Shadow-Only Mode Safety
*For any* experiment with execution_mode set to SHADOW_ONLY, the execution policy should have executed_engine=None, ensuring no real trades are executed.

**Validates: Requirements 3.4**

### Property 12: Mutual Exclusion of Real Trade Execution
*For any* experiment, at most one engine should have executed_engine status (either "A" or "B" or None), never both simultaneously.

**Validates: Requirements 3.5**

### Property 13: Execution Policy Record Existence
*For any* experiment created by the Orchestrator, a corresponding execution_policies record should exist with matching experiment_id.

**Validates: Requirements 3.6**

### Property 14: Shadow Trade Creation Requirement
*For any* experiment where an engine is assigned as shadow_engine, that engine should create at least one shadow trade record (is_shadow=true) linked to the experiment_id.

**Validates: Requirements 4.1**

### Property 15: Exit Synchronization
*For any* real trade that exits, if a corresponding shadow trade exists for the same experiment_id, the shadow trade should also exit with the same exit timestamp and market conditions.

**Validates: Requirements 4.2**

### Property 16: Shadow Trade Attribution
*For any* shadow trade created, it should have is_shadow=true and a valid experiment_id linking it to the originating experiment.

**Validates: Requirements 4.3, 4.4**

### Property 17: Trade Outcome Record Completeness
*For any* completed trade (real or shadow), a trade_outcomes record should exist with all required fields (outcome_id, experiment_id, engine, trade_id, entry_price, exit_price, pnl, exit_reason, entry_time, exit_time, is_shadow).

**Validates: Requirements 5.1**

### Property 18: Performance Aggregation by Engine
*For any* set of trade outcomes, when aggregated by engine variant, the sum of individual P&Ls should equal the total P&L for that engine.

**Validates: Requirements 5.3**

### Property 19: Performance Metrics Calculation Correctness
*For any* set of trade outcomes for an engine, the calculated win rate should equal (winning_trades / total_trades) and average P&L should equal (sum of P&Ls / total_trades).

**Validates: Requirements 5.4**

### Property 20: Experiment Traceability
*For any* experiment_id, querying the experiments table should return exactly one record with the engine variant that recommended the trade.

**Validates: Requirements 5.5**

### Property 21: Policy Version Tracking
*For any* execution policy record, the policy_version field should be present and non-empty, enabling tracking of policy changes over time.

**Validates: Requirements 6.5**

### Property 22: Webhook Payload Validation
*For any* webhook payload received, if it contains all required fields (symbol, direction, timeframe, timestamp), validation should pass; otherwise, it should fail.

**Validates: Requirements 8.1**

### Property 23: Valid Signal Storage
*For any* valid webhook payload that passes validation, a signal record should be created in the signals table with a unique signal_id.

**Validates: Requirements 8.2**

### Property 24: Single Signal Record Per Webhook
*For any* webhook received, the Orchestrator should create exactly one signal record, not separate records for each engine.

**Validates: Requirements 9.4**

### Property 25: Signal Processing Status Update
*For any* signal processed by the Orchestrator, the processed flag should be set to true and experiment_id should be populated.

**Validates: Requirements 9.5**

### Property 26: Processing Lock During Signal Processing
*For any* signal currently being processed, a processing lock should exist (either via database lock or status flag) preventing concurrent processing.

**Validates: Requirements 10.5**

### Property 27: Structured Logging for Signal Retrieval
*For any* signal retrieved by the Orchestrator, a log entry should exist containing signal_id, symbol, direction, and timestamp.

**Validates: Requirements 11.1**

### Property 28: Structured Logging for Experiment Creation
*For any* experiment created by the Orchestrator, a log entry should exist containing experiment_id, signal_id, variant, and assignment_hash.

**Validates: Requirements 11.2**

### Property 29: Structured Logging for Policy Application
*For any* execution policy applied, a log entry should exist containing experiment_id, execution_mode, executed_engine, and policy_version.

**Validates: Requirements 11.3**

### Property 30: Structured Logging for Shadow Trade Creation
*For any* shadow trade created, a log entry should exist containing experiment_id, engine, and shadow_trade_id.

**Validates: Requirements 11.4**

### Property 31: Error Logging with Context
*For any* error that occurs during signal processing, a log entry should exist containing signal_id, experiment_id (if created), error_type, error_message, and timestamp.

**Validates: Requirements 11.5**

### Property 32: Dynamic Configuration Application
*For any* configuration change to execution policy, new experiments created after the change should use the new policy without requiring system restart.

**Validates: Requirements 12.2**

### Property 33: Split Capital Percentage Application
*For any* experiment created in SPLIT_CAPITAL mode, the split_percentage field should be used in the variant assignment algorithm to allocate capital between engines.

**Validates: Requirements 12.4**

### Edge Cases and Examples

The following scenarios should be tested as specific examples rather than universal properties:

**Example 1: Paper Mode with Engine A Available**
- Given: APP_MODE=PAPER and Engine A is available
- Expected: execution_mode should be ENGINE_A_PRIMARY
- **Validates: Requirements 3.1**

**Example 2: Engine A Unavailable**
- Given: Engine A is unavailable
- Expected: execution_mode should be SHADOW_ONLY
- **Validates: Requirements 3.3**

**Example 3: Configuration Loading**
- Given: Valid execution policy configuration in environment variables
- Expected: Orchestrator should successfully load configuration on startup
- **Validates: Requirements 12.1**

**Example 4: Supported Execution Modes**
- Given: Configuration with each mode (SHADOW_ONLY, ENGINE_A_PRIMARY, ENGINE_B_PRIMARY, SPLIT_CAPITAL)
- Expected: Orchestrator should accept and apply each mode correctly
- **Validates: Requirements 12.3**

**Example 5: Invalid Configuration Rejection**
- Given: Invalid execution policy configuration (e.g., unknown mode)
- Expected: Orchestrator should reject configuration and fail fast on startup
- **Validates: Requirements 12.5**

**Edge Case 1: Webhook Response Time**
- Given: Valid webhook payload
- Expected: Webhook handler should return HTTP 200 within 3 seconds
- **Validates: Requirements 8.3**
- Note: This is a performance requirement best tested with load testing tools
