# Implementation Plan: Options Trading Engines

## Overview

This implementation plan breaks down the development of three interconnected decision engines (Entry, Strike Selection, and Exit) into discrete, incremental coding tasks. Each task builds on previous work, with testing integrated throughout to validate correctness early. The plan follows a bottom-up approach: shared infrastructure first, then individual engines, then integration.

## Tasks

- [ ] 1. Set up shared infrastructure and type definitions
  - Create `/lib/shared/` directory structure
  - Define common TypeScript types (SetupType, RegimeType, GEXState, LiquidityState, SessionType, Greeks, EventRisk, RuleResult, ProgressCheck, Guardrails)
  - Define shared constants (DTE policies, liquidity gates, delta ranges, scoring weights)
  - Implement input validation utilities using Zod schemas
  - Set up audit logging infrastructure with structured log format
  - _Requirements: 8.1, 9.4, 9.5, 10.4, 10.5_

- [ ] 1.1 Write property test for shared type validation
  - **Property 1: Input validation completeness (shared types)**
  - **Validates: Requirements 9.6**

- [ ] 2. Implement Entry Decision Engine core logic
  - [ ] 2.1 Create `/lib/entryEngine/` directory structure
    - Create types.ts with EntryDecisionInput and EntryDecisionOutput interfaces
    - Create Zod validation schemas for input/output contracts
    - _Requirements: 1.1, 9.4, 9.5, 9.6_

  - [ ] 2.2 Implement Tier 1 hard blocking rules
    - Create `/lib/entryEngine/rules/tier1HardBlocks.ts`
    - Implement signal confidence check (mode-specific thresholds)
    - Implement regime conflict detection
    - Implement volatility mismatch detection
    - Implement portfolio guardrails checks
    - Implement liquidity safety checks
    - _Requirements: 1.3, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 2.3 Write property test for Tier 1 blocking
    - **Property 3: Tier 1 hard blocks**
    - **Validates: Requirements 1.3, 2.1, 2.2, 2.3, 2.4, 2.5**

  - [ ] 2.4 Implement Tier 2 delay rules
    - Create `/lib/entryEngine/rules/tier2Delays.ts`
    - Implement confirmation pending check
    - Implement timing window validation (session-based)
    - Implement GEX proximity check
    - _Requirements: 1.4, 2.6, 2.7, 2.8_

  - [ ] 2.5 Write property test for Tier 2 delays
    - **Property 4: Tier 2 delays**
    - **Validates: Requirements 1.4, 2.6, 2.7, 2.8**

  - [ ] 2.6 Implement Tier 3 entry approval and instruction generation
    - Create `/lib/entryEngine/rules/tier3Entry.ts`
    - Implement mode-specific entry instruction generation (SCALP_GUARDED, SWING, POSITION, LEAPS)
    - Implement urgency level calculation based on signal strength
    - _Requirements: 1.5, 1.6, 1.7, 1.8, 1.9_

  - [ ] 2.7 Write property test for mode-specific entry instructions
    - **Property 5: Entry approval with mode-specific instructions**
    - **Validates: Requirements 1.5, 1.6, 1.7, 1.8, 1.9**

  - [ ] 2.8 Implement main entry decision evaluator
    - Create `/lib/entryEngine/evaluator.ts`
    - Implement rule hierarchy evaluation (Tier 1 → Tier 2 → Tier 3)
    - Implement rationale compilation from triggered rules
    - Integrate audit logging
    - _Requirements: 1.2, 1.10, 8.2_

  - [ ] 2.9 Write property tests for entry engine
    - **Property 2: Rule hierarchy enforcement**
    - **Property 6: Output contract completeness**
    - **Property 7: Entry engine determinism**
    - **Property 8: Entry engine statelessness**
    - **Validates: Requirements 1.2, 1.10, 8.1, 10.1**

  - [ ] 2.10 Create Entry Decision API endpoint
    - Create `/pages/api/entry-decision.ts` (or `/app/api/entry-decision/route.ts` for App Router)
    - Implement POST handler with input validation
    - Implement error handling and response formatting
    - _Requirements: 9.1_

  - [ ] 2.11 Write integration tests for entry API
    - Test valid requests return 200 with correct structure
    - Test invalid requests return 400 with validation errors
    - _Requirements: 9.1_

- [ ] 3. Checkpoint - Entry Engine Complete
  - Ensure all entry engine tests pass
  - Verify audit logging is working
  - Ask the user if questions arise

- [ ] 4. Implement Strike Selection Engine core logic
  - [ ] 4.1 Create `/lib/strikeSelection/` directory structure
    - Create types.ts with StrikeSelectionInput, OptionContract, and StrikeSelectionOutput interfaces
    - Create Zod validation schemas for input/output contracts
    - _Requirements: 3.1, 9.4, 9.5, 9.6_

  - [ ] 4.2 Implement DTE filter
    - Create `/lib/strikeSelection/filters/dteFilter.ts`
    - Implement mode-specific DTE range filtering (SCALP 3-14, SWING 21-90, POSITION 90-180, LEAPS 180-720)
    - _Requirements: 3.2_

  - [ ] 4.3 Write property test for DTE filtering
    - **Property 10: DTE policy enforcement**
    - **Validates: Requirements 3.2**

  - [ ] 4.4 Implement liquidity filter
    - Create `/lib/strikeSelection/filters/liquidityFilter.ts`
    - Implement mode-specific liquidity gates (spread %, OI, volume)
    - _Requirements: 3.3, 3.4_

  - [ ] 4.5 Write property test for liquidity filtering
    - **Property 11: Liquidity gates enforcement**
    - **Validates: Requirements 3.3, 3.4**

  - [ ] 4.6 Implement Greeks filter
    - Create `/lib/strikeSelection/filters/greeksFilter.ts`
    - Implement delta range filtering (mode-specific)
    - Implement theta survivability check
    - Implement gamma acceptability check (mode-specific)
    - Implement vega acceptability check (IV-dependent)
    - _Requirements: 3.5, 3.6, 3.7, 3.8_

  - [ ] 4.7 Write property tests for Greeks filtering
    - **Property 12: Delta range enforcement**
    - **Property 13: Theta survivability constraint**
    - **Property 14: Gamma penalization for non-scalp setups**
    - **Property 15: Vega penalization in high IV environments**
    - **Validates: Requirements 3.5, 3.6, 3.7, 3.8**

  - [ ] 4.8 Implement contract scoring engine
    - Create `/lib/strikeSelection/scoring/scorer.ts`
    - Implement six scoring dimensions (liquidity fitness, Greeks stability, theta survivability, vega/IV alignment, cost efficiency, GEX suitability)
    - Create `/lib/strikeSelection/scoring/weights.ts` with mode-specific weightings
    - Implement weighted score calculation (0-100 range)
    - _Requirements: 3.9, 4.2_

  - [ ] 4.9 Write property test for scoring
    - **Property 16: Scoring range and completeness**
    - **Validates: Requirements 3.9**

  - [ ] 4.10 Implement guardrails generation
    - Add guardrails generation function to selector.ts
    - Implement mode-specific guardrails (max hold time, progress checks, theta burn limits, invalidation levels)
    - _Requirements: 3.10_

  - [ ] 4.11 Implement main strike selection logic
    - Create `/lib/strikeSelection/selector.ts`
    - Implement filter pipeline (DTE → liquidity → Greeks)
    - Implement scoring and ranking
    - Implement deterministic tie-breaking (prefer closer expiry, then strike)
    - Implement guardrails generation
    - Integrate audit logging
    - _Requirements: 3.10, 3.11, 4.1, 4.3, 4.4, 8.3_

  - [ ] 4.12 Write property tests for strike selection engine
    - **Property 17: Success output completeness**
    - **Property 18: Failure output completeness**
    - **Property 19: Strike selection determinism**
    - **Property 20: Deterministic tie-breaking**
    - **Property 21: Scoring breakdown auditability**
    - **Property 22: Strike selection statelessness**
    - **Validates: Requirements 3.10, 3.11, 4.1, 4.3, 4.4, 8.1, 10.2**

  - [ ] 4.13 Create Strike Selection API endpoint
    - Create `/pages/api/strike-selection.ts` (or `/app/api/strike-selection/route.ts`)
    - Implement POST handler with input validation
    - Implement error handling and response formatting
    - _Requirements: 9.2_

  - [ ] 4.14 Write integration tests for strike selection API
    - Test valid requests with various option chains
    - Test NO_VALID_STRIKE response when all contracts filtered
    - Test invalid requests return 400
    - _Requirements: 9.2_

- [ ] 5. Checkpoint - Strike Selection Engine Complete
  - Ensure all strike selection tests pass
  - Verify determinism with repeated calls
  - Ask the user if questions arise

- [ ] 6. Implement Exit Decision Engine core logic
  - [ ] 6.1 Create `/lib/exitEngine/` directory structure
    - Create types.ts with ExitDecisionInput and ExitDecisionOutput interfaces
    - Create Zod validation schemas for input/output contracts
    - _Requirements: 5.1, 9.4, 9.5, 9.6_

  - [ ] 6.2 Implement Tier 1 hard fail exit rules
    - Create `/lib/exitEngine/rules/tier1HardFail.ts`
    - Implement thesis invalidation check
    - Implement SCALP max hold time check (30-90 minutes)
    - Implement theta burn kill-switch (mode-specific limits)
    - Implement risk stop check (stop loss hit)
    - _Requirements: 5.3, 6.1, 6.2_

  - [ ] 6.3 Write property test for Tier 1 exits
    - **Property 25: Tier 1 hard fail exits**
    - **Validates: Requirements 5.3, 6.1, 6.2**

  - [ ] 6.4 Implement Tier 2 capital protection rules
    - Create `/lib/exitEngine/rules/tier2Protection.ts`
    - Implement progress check failure detection
    - Implement liquidity deterioration check (spread widening)
    - Implement regime flip detection
    - _Requirements: 5.4, 6.5, 6.7, 6.8_

  - [ ] 6.5 Write property test for Tier 2 exits
    - **Property 26: Tier 2 capital protection exits**
    - **Validates: Requirements 5.4, 6.5, 6.7, 6.8**

  - [ ] 6.6 Implement Tier 3 profit-taking rules
    - Create `/lib/exitEngine/rules/tier3Profit.ts`
    - Implement mode-specific profit ladder checks (SCALP +15%/+30%, SWING +25%/+50%/+80%, etc.)
    - Implement partial exit size calculation
    - _Requirements: 5.5, 6.3, 6.6_

  - [ ] 6.7 Write property test for Tier 3 exits
    - **Property 27: Tier 3 profit-taking exits**
    - **Validates: Requirements 5.5, 6.3, 6.6**

  - [ ] 6.8 Implement Tier 4 degradation management rules
    - Create `/lib/exitEngine/rules/tier4Degradation.ts`
    - Implement time stop checks
    - Implement delta decay detection (mode-specific thresholds)
    - Implement gamma stall detection (SCALP/SWING only)
    - Implement theta acceleration detection
    - Implement vega/IV shock detection
    - _Requirements: 5.6, 6.4, 7.1, 7.2, 7.3, 7.4_

  - [ ] 6.9 Write property tests for Tier 4 exits and Greeks degradation
    - **Property 28: Tier 4 degradation management**
    - **Property 31: Greeks degradation detection**
    - **Validates: Requirements 5.6, 6.4, 7.1, 7.2, 7.3, 7.4**

  - [ ] 6.10 Implement Greeks analyzer
    - Create `/lib/exitEngine/greeksAnalyzer.ts`
    - Implement delta change calculation
    - Implement gamma change calculation
    - Implement theta acceleration calculation
    - Implement IV change and vega exposure calculation
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ] 6.11 Implement metrics calculator
    - Add metrics calculation to evaluator
    - Calculate time in trade, option P&L %, underlying move %, theta burn estimate, delta change, IV change, spread %
    - _Requirements: 5.8_

  - [ ] 6.12 Implement main exit decision evaluator
    - Create `/lib/exitEngine/evaluator.ts`
    - Implement rule hierarchy evaluation (Tier 1 → Tier 2 → Tier 3 → Tier 4)
    - Implement conservative action selection when multiple rules trigger
    - Implement rationale compilation
    - Integrate metrics calculation
    - Integrate audit logging
    - _Requirements: 5.2, 5.7, 5.8, 8.4, 8.5_

  - [ ] 6.13 Write property tests for exit engine
    - **Property 24: Exit rule hierarchy enforcement**
    - **Property 29: Hold when no rules trigger**
    - **Property 30: Exit output completeness**
    - **Property 32: Conservative action selection**
    - **Property 33: Exit engine determinism**
    - **Property 34: Exit engine statelessness**
    - **Validates: Requirements 5.2, 5.7, 5.8, 8.1, 8.5, 10.3**

  - [ ] 6.14 Create Exit Decision API endpoint
    - Create `/pages/api/exit-decision.ts` (or `/app/api/exit-decision/route.ts`)
    - Implement POST handler with input validation
    - Implement error handling and response formatting
    - _Requirements: 9.3_

  - [ ] 6.15 Write integration tests for exit API
    - Test valid requests with various position states
    - Test all action types (HOLD, PARTIAL_EXIT, FULL_EXIT, TIGHTEN_STOP)
    - Test invalid requests return 400
    - _Requirements: 9.3_

- [ ] 7. Checkpoint - Exit Engine Complete
  - Ensure all exit engine tests pass
  - Verify conservative action selection with complex scenarios
  - Ask the user if questions arise

- [ ] 8. Implement cross-engine integration and testing
  - [ ] 8.1 Create test arbitraries (generators) for property tests
    - Create `/tests/arbitraries/entryDecisionArbitraries.ts`
    - Create `/tests/arbitraries/strikeSelectionArbitraries.ts`
    - Create `/tests/arbitraries/exitDecisionArbitraries.ts`
    - Create `/tests/arbitraries/commonArbitraries.ts`
    - Implement generators for all input types with realistic constraints
    - _Requirements: All property tests_

  - [ ] 8.2 Write cross-engine property test for audit logging
    - **Property 35: Comprehensive audit logging**
    - **Validates: Requirements 8.2, 8.3, 8.4**

  - [ ] 8.3 Write cross-engine integration tests
    - Test entry → strike selection flow (approved entry feeds into strike selection)
    - Test strike selection → exit decision flow (guardrails respected)
    - Test full workflow: entry → strike → exit
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ] 9. Final validation and documentation
  - [ ] 9.1 Run full test suite
    - Run all unit tests
    - Run all property tests with 100+ iterations
    - Run all integration tests
    - Verify >90% code coverage
    - _Requirements: All_

  - [ ] 9.2 Add inline code documentation
    - Document all public interfaces with JSDoc comments
    - Document complex rule logic with inline comments
    - Document scoring algorithm details
    - _Requirements: 8.1_

  - [ ] 9.3 Create README for each engine
    - Document API contracts
    - Document rule hierarchies
    - Document mode-specific behaviors
    - Include usage examples
    - _Requirements: All_

- [ ] 10. Final Checkpoint
  - Ensure all tests pass
  - Verify determinism across all engines
  - Verify audit logs are complete
  - Ask the user if questions arise

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties across all inputs
- Unit tests validate specific examples and edge cases
- Integration tests validate cross-engine workflows
- Checkpoints ensure incremental validation and provide opportunities for user feedback
