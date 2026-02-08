# Implementation Plan: Trading Orchestrator Agent

## Overview

This implementation plan converts the Trading Orchestrator Agent design into discrete coding tasks. The orchestrator will coordinate signal distribution, experiment creation, and execution policy enforcement for fair comparison between Engine A and Engine B. Implementation will be in TypeScript for the Node.js platform.

The approach follows these principles:
- **Incremental Progress**: Each task builds on previous work
- **Early Validation**: Core functionality tested as soon as implemented
- **Database-First**: Schema and migrations before application logic
- **Test Coverage**: Property-based tests for universal properties, unit tests for specific scenarios

## Tasks

- [x] 1. Set up database schema and migrations
  - Create PostgreSQL migration files for new tables (experiments, execution_policies, market_contexts, trade_outcomes)
  - Add indexes for performance (processed signals, experiment lookups, outcome queries)
  - Create database connection pool configuration
  - Write migration runner script
  - _Requirements: 2.4, 3.6, 5.1, 5.2_

- [x] 2. Implement core data models and types
  - [x] 2.1 Create TypeScript interfaces for all data models
    - Define Signal, MarketContext, Experiment, ExecutionPolicy, TradeRecommendation, TradeOutcome types
    - Add validation schemas using Zod or similar
    - _Requirements: 1.1, 2.4, 3.6, 5.1_
  
  - [x] 2.2 Write property test for data model validation
    - **Property 1: Signal Retrieval Completeness**
    - **Validates: Requirements 1.1**
  
  - [x] 2.3 Write property test for Market Context creation
    - **Property 2: Market Context Creation**
    - **Validates: Requirements 1.2**

- [x] 3. Implement Signal Processor component
  - [x] 3.1 Create SignalProcessor class with database queries
    - Implement getUnprocessedSignals() with SELECT FOR UPDATE SKIP LOCKED
    - Implement createMarketContext() to snapshot market state
    - Implement markProcessed() to update signal status
    - _Requirements: 1.1, 1.2, 1.5, 9.5, 10.5_
  
  - [x] 3.2 Write property test for signal immutability
    - **Property 4: Signal Immutability During Distribution**
    - **Validates: Requirements 1.4, 7.5**
  
  - [x] 3.3 Write property test for distribution audit trail
    - **Property 5: Distribution Audit Trail**
    - **Validates: Requirements 1.5**
  
  - [x] 3.4 Write unit tests for edge cases
    - Test empty signal list handling
    - Test database connection failures
    - Test invalid signal formats
    - _Requirements: 1.1, 1.2_

- [x] 4. Implement Experiment Manager component
  - [x] 4.1 Create ExperimentManager class with deterministic assignment
    - Implement createExperiment() with assignment hash generation
    - Implement getVariantAssignment() using modulo-based deterministic algorithm
    - Implement experimentExists() for idempotency checks
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 6.1, 6.2, 10.3_
  
  - [x] 4.2 Write property test for deterministic assignment hash
    - **Property 7: Deterministic Assignment Hash Generation**
    - **Validates: Requirements 2.2**
  
  - [x] 4.3 Write property test for deterministic variant assignment (replay)
    - **Property 8: Deterministic Variant Assignment (Replay Property)**
    - **Validates: Requirements 2.3, 2.5, 6.1, 6.4**
  
  - [x] 4.4 Write property test for experiment creation idempotency
    - **Property 6: Experiment Creation Idempotency**
    - **Validates: Requirements 2.1, 10.1, 10.3**
  
  - [x] 4.5 Write property test for experiment record completeness
    - **Property 9: Experiment Record Completeness**
    - **Validates: Requirements 2.4**

- [x] 5. Checkpoint - Ensure core data flow works
  - Run migrations and verify schema
  - Test signal retrieval and experiment creation end-to-end
  - Ensure all tests pass, ask the user if questions arise

- [x] 6. Implement Policy Engine component
  - [x] 6.1 Create PolicyEngine class with configuration management
    - Implement getExecutionPolicy() with v1.0 logic (ENGINE_A_PRIMARY or SHADOW_ONLY)
    - Implement validatePolicy() for configuration validation
    - Implement checkEngineAvailability() for engine health checks
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 12.1, 12.2, 12.3, 12.5_
  
  - [x] 6.2 Write property test for execution policy enforcement (ENGINE_A_PRIMARY)
    - **Property 10: Execution Policy Enforcement for ENGINE_A_PRIMARY**
    - **Validates: Requirements 3.2**
  
  - [x] 6.3 Write property test for shadow-only mode safety
    - **Property 11: Shadow-Only Mode Safety**
    - **Validates: Requirements 3.4**
  
  - [x] 6.4 Write property test for mutual exclusion of real trade execution
    - **Property 12: Mutual Exclusion of Real Trade Execution**
    - **Validates: Requirements 3.5**
  
  - [x] 6.5 Write property test for execution policy record existence
    - **Property 13: Execution Policy Record Existence**
    - **Validates: Requirements 3.6**
  
  - [x] 6.6 Write unit tests for policy examples
    - Test Example 1: Paper mode with Engine A available
    - Test Example 2: Engine A unavailable
    - Test Example 3: Configuration loading
    - Test Example 4: Supported execution modes
    - Test Example 5: Invalid configuration rejection
    - _Requirements: 3.1, 3.3, 12.1, 12.3, 12.5_

- [x] 7. Implement Engine Coordinator component
  - [x] 7.1 Create EngineCoordinator class for engine invocation
    - Implement invokeEngineA() to call Engine A with signal and context
    - Implement invokeEngineB() to call Engine B with signal and context
    - Implement synchronizeExits() for shadow trade exit coordination
    - _Requirements: 1.3, 4.2, 9.1, 9.2, 9.3_
  
  - [x] 7.2 Write property test for identical inputs to both engines
    - **Property 3: Identical Inputs to Both Engines**
    - **Validates: Requirements 1.3, 9.1, 9.2, 9.3**
  
  - [x] 7.3 Write property test for exit synchronization
    - **Property 15: Exit Synchronization**
    - **Validates: Requirements 4.2**
  
  - [x] 7.4 Write unit tests for engine invocation errors
    - Test engine timeout handling
    - Test engine unavailability
    - Test partial failures
    - _Requirements: 1.3, 4.2_

- [x] 8. Implement Orchestrator Service (main coordinator)
  - [x] 8.1 Create OrchestratorService class integrating all components
    - Implement processSignals() as main entry point
    - Implement createExperiment() orchestration
    - Implement getExecutionPolicy() orchestration
    - Implement distributeSignal() orchestration
    - Implement trackOutcome() for outcome recording
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 3.1, 4.1, 5.1, 9.1, 9.2, 9.3, 9.4_
  
  - [x] 8.2 Write property test for shadow trade creation requirement
    - **Property 14: Shadow Trade Creation Requirement**
    - **Validates: Requirements 4.1**
  
  - [x] 8.3 Write property test for shadow trade attribution
    - **Property 16: Shadow Trade Attribution**
    - **Validates: Requirements 4.3, 4.4**
  
  - [x] 8.4 Write property test for single signal record per webhook
    - **Property 24: Single Signal Record Per Webhook**
    - **Validates: Requirements 9.4**
  
  - [x] 8.5 Write property test for signal processing status update
    - **Property 25: Signal Processing Status Update**
    - **Validates: Requirements 9.5**

- [x] 9. Implement outcome tracking and performance metrics
  - [x] 9.1 Create OutcomeTracker class for trade outcome recording
    - Implement recordOutcome() to store trade outcomes
    - Implement getPerformanceMetrics() for aggregation by engine
    - Implement calculateWinRate() and calculateAveragePnL()
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  
  - [x] 9.2 Write property test for trade outcome record completeness
    - **Property 17: Trade Outcome Record Completeness**
    - **Validates: Requirements 5.1**
  
  - [x] 9.3 Write property test for performance aggregation by engine
    - **Property 18: Performance Aggregation by Engine**
    - **Validates: Requirements 5.3**
  
  - [x] 9.4 Write property test for performance metrics calculation
    - **Property 19: Performance Metrics Calculation Correctness**
    - **Validates: Requirements 5.4**
  
  - [x] 9.5 Write property test for experiment traceability
    - **Property 20: Experiment Traceability**
    - **Validates: Requirements 5.5**

- [x] 10. Checkpoint - Ensure orchestration flow works end-to-end
  - Test complete signal processing workflow
  - Verify experiment creation, policy enforcement, and outcome tracking
  - Ensure all tests pass, ask the user if questions arise

- [x] 11. Implement structured logging
  - [x] 11.1 Create Logger utility with structured logging
    - Implement logSignalRetrieval() with signal_id, symbol, direction, timestamp
    - Implement logExperimentCreation() with experiment_id, signal_id, variant, assignment_hash
    - Implement logPolicyApplication() with experiment_id, execution_mode, executed_engine, policy_version
    - Implement logShadowTradeCreation() with experiment_id, engine, shadow_trade_id
    - Implement logError() with signal_id, experiment_id, error_type, error_message, stack_trace, timestamp
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  
  - [x] 11.2 Write property test for structured logging completeness
    - **Property 27: Structured Logging for Signal Retrieval**
    - **Property 28: Structured Logging for Experiment Creation**
    - **Property 29: Structured Logging for Policy Application**
    - **Property 30: Structured Logging for Shadow Trade Creation**
    - **Property 31: Error Logging with Context**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5**

- [x] 12. Refactor webhook handler
  - [x] 12.1 Update webhook handler to remove Engine B synchronous invocation
    - Remove Engine B call from webhook handler
    - Keep only validation and signal storage
    - Ensure HTTP 200 response within 3 seconds
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  
  - [x] 12.2 Write property test for webhook payload validation
    - **Property 22: Webhook Payload Validation**
    - **Validates: Requirements 8.1**
  
  - [x] 12.3 Write property test for valid signal storage
    - **Property 23: Valid Signal Storage**
    - **Validates: Requirements 8.2**
  
  - [x] 12.4 Write unit test for webhook response time (edge case)
    - Test that webhook returns HTTP 200 within 3 seconds
    - _Requirements: 8.3_

- [x] 13. Implement worker process for signal polling
  - [x] 13.1 Create worker script that polls signals table
    - Implement polling loop with configurable interval
    - Call OrchestratorService.processSignals() on each iteration
    - Add graceful shutdown handling
    - Add error recovery with exponential backoff
    - _Requirements: 1.1, 9.1, 9.2, 9.3, 10.1, 10.2, 10.3, 10.4, 10.5_
  
  - [x] 13.2 Write property test for processing lock during signal processing
    - **Property 26: Processing Lock During Signal Processing**
    - **Validates: Requirements 10.5**
  
  - [x] 13.3 Write unit tests for concurrency scenarios
    - Test multiple workers processing different signals
    - Test duplicate experiment prevention
    - Test transaction isolation
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 14. Implement configuration management
  - [x] 14.1 Create ConfigManager for execution policy configuration
    - Load configuration from environment variables
    - Support dynamic configuration updates
    - Validate configuration on startup
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_
  
  - [x] 14.2 Write property test for dynamic configuration application
    - **Property 32: Dynamic Configuration Application**
    - **Validates: Requirements 12.2**
  
  - [x] 14.3 Write property test for split capital percentage application
    - **Property 33: Split Capital Percentage Application**
    - **Validates: Requirements 12.4**
  
  - [x] 14.4 Write property test for policy version tracking
    - **Property 21: Policy Version Tracking**
    - **Validates: Requirements 6.5**

- [x] 15. Integration and wiring
  - [x] 15.1 Wire all components together in main application
    - Create dependency injection container
    - Initialize database connections
    - Start worker processes
    - Add health check endpoints
    - _Requirements: All requirements_
  
  - [x] 15.2 Write integration tests for end-to-end flows
    - Test complete signal-to-outcome flow
    - Test shadow trade synchronization
    - Test policy switching
    - Test concurrent processing
    - _Requirements: All requirements_

- [x] 16. Final checkpoint - Comprehensive testing and validation
  - Run all unit tests and property tests
  - Verify database schema and migrations
  - Test with realistic signal data
  - Validate determinism by replaying experiments
  - Ensure all tests pass, ask the user if questions arise

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Property tests use fast-check library (TypeScript equivalent of Hypothesis)
- Each property test runs minimum 100 iterations
- Checkpoints ensure incremental validation at key milestones
- All database operations use transactions for consistency
- Structured logging enables debugging and audit trails
