# Requirements Document: Options Trading Engines

## Introduction

This specification defines three interconnected decision engines for an options trading platform: Entry Decision Engine, Strike Selection Engine, and Exit Decision Engine. These engines operate as execution-layer services that make deterministic, auditable decisions about trade entry, option contract selection, and trade exit management. The engines integrate with an existing Next.js trading platform that provides signal ingestion, multi-agent decisioning, regime detection, and risk orchestration capabilities.

## Glossary

- **Entry_Decision_Engine**: Service that evaluates trade signals and market conditions to determine whether to enter a trade
- **Strike_Selection_Engine**: Service that selects specific option contracts based on approved trade parameters and market conditions
- **Exit_Decision_Engine**: Service that evaluates open positions and determines exit actions
- **Signal**: A trade opportunity indicator with confidence level, pattern, and timeframe
- **Setup_Type**: Trade classification (SCALP_GUARDED, SWING, POSITION, LEAPS)
- **Regime**: Market environment classification affecting trade suitability
- **GEX_State**: Gamma exposure state indicating dealer positioning
- **IV_Percentile**: Implied volatility ranking relative to historical range
- **DTE**: Days to expiration for option contracts
- **Greeks**: Option sensitivity metrics (delta, gamma, theta, vega)
- **Liquidity_State**: Market liquidity condition affecting execution quality
- **Thesis**: The underlying rationale for a trade position
- **HTF**: Higher timeframe analysis
- **OI**: Open interest in option contracts
- **Spread**: Difference between bid and ask prices

## Requirements

### Requirement 1: Entry Decision Engine Core Functionality

**User Story:** As a trading system, I want to evaluate trade signals against market conditions and risk constraints, so that I only enter trades when conditions are favorable.

#### Acceptance Criteria

1. WHEN a trade signal is received, THE Entry_Decision_Engine SHALL validate the input contract contains symbol, timestamp, direction, setup type, signal data, market context, timing context, and risk context
2. WHEN evaluating a signal, THE Entry_Decision_Engine SHALL apply rule hierarchy in order: Tier 1 hard blocks, Tier 2 delays, Tier 3 entry approval
3. WHEN a Tier 1 rule triggers, THE Entry_Decision_Engine SHALL return action BLOCK with triggered rules and rationale
4. WHEN a Tier 2 rule triggers without Tier 1 violations, THE Entry_Decision_Engine SHALL return action WAIT with triggered rules and rationale
5. WHEN no blocking or delay rules trigger, THE Entry_Decision_Engine SHALL return action ENTER with urgency level and entry instructions
6. WHEN setup type is SCALP_GUARDED and entry is approved, THE Entry_Decision_Engine SHALL set entry type to LIMIT or STOP_LIMIT with confirmation required and max wait 5-10 minutes
7. WHEN setup type is SWING and entry is approved with high confidence, THE Entry_Decision_Engine SHALL allow MARKET entry type
8. WHEN setup type is POSITION and entry is approved, THE Entry_Decision_Engine SHALL allow staged entries with structure-based confirmation
9. WHEN setup type is LEAPS and entry is approved, THE Entry_Decision_Engine SHALL prefer LIMIT entry type with relaxed timing constraints
10. THE Entry_Decision_Engine SHALL return output contract containing action, urgency, entry instructions, triggered rules, and rationale

### Requirement 2: Entry Decision Engine Rule Enforcement

**User Story:** As a risk manager, I want the entry engine to enforce hard blocks and timing constraints, so that trades only enter under safe conditions.

#### Acceptance Criteria

1. WHEN signal confidence is below minimum threshold, THE Entry_Decision_Engine SHALL trigger Tier 1 hard block
2. WHEN regime conflicts with trade direction, THE Entry_Decision_Engine SHALL trigger Tier 1 hard block
3. WHEN volatility mismatches setup type requirements, THE Entry_Decision_Engine SHALL trigger Tier 1 hard block
4. WHEN portfolio guardrails are breached, THE Entry_Decision_Engine SHALL trigger Tier 1 hard block
5. WHEN liquidity state is unsafe, THE Entry_Decision_Engine SHALL trigger Tier 1 hard block
6. WHEN confirmation is pending, THE Entry_Decision_Engine SHALL trigger Tier 2 delay
7. WHEN timing window is unfavorable, THE Entry_Decision_Engine SHALL trigger Tier 2 delay
8. WHEN GEX proximity indicates dealer resistance, THE Entry_Decision_Engine SHALL trigger Tier 2 delay

### Requirement 3: Strike Selection Engine Core Functionality

**User Story:** As a trading system, I want to select specific option contracts that match trade parameters and risk constraints, so that positions have optimal risk-reward characteristics.

#### Acceptance Criteria

1. WHEN a strike selection request is received, THE Strike_Selection_Engine SHALL validate input contains symbol, spot price, direction, setup type, signal confidence, expected hold time, expected move, regime, GEX state, IV percentile, event risk, risk budget, and option chain
2. WHEN evaluating option contracts, THE Strike_Selection_Engine SHALL filter by DTE policy: SCALP_GUARDED 3-14 days, SWING 21-90 days, POSITION 90-180 days, LEAPS 180-720 days
3. WHEN evaluating option contracts, THE Strike_Selection_Engine SHALL apply liquidity gates: SCALP spread ≤8% AND OI ≥1000 AND volume ≥500
4. WHEN evaluating option contracts, THE Strike_Selection_Engine SHALL apply liquidity gates: SWING/POSITION spread ≤12-15% AND OI ≥300 AND volume ≥100
5. WHEN evaluating option contracts, THE Strike_Selection_Engine SHALL enforce delta ranges: SCALP 0.45-0.65, SWING 0.25-0.40, POSITION 0.20-0.35, LEAPS 0.15-0.30
6. WHEN evaluating option contracts, THE Strike_Selection_Engine SHALL reject contracts with theta decay exceeding expected hold time tolerance
7. WHEN evaluating option contracts for SWING or longer setups, THE Strike_Selection_Engine SHALL penalize high gamma contracts
8. WHEN evaluating option contracts with high IV percentile, THE Strike_Selection_Engine SHALL penalize high vega contracts
9. WHEN scoring option contracts, THE Strike_Selection_Engine SHALL compute score 0-100 based on liquidity fitness, Greeks stability, theta survivability, vega/IV alignment, cost efficiency, and GEX suitability
10. WHEN a valid contract is found, THE Strike_Selection_Engine SHALL return trade contract with symbol, direction, setup type, expiry, DTE, strike, mid price, Greeks snapshot, scores breakdown, guardrails, and rationale
11. WHEN no valid contract is found, THE Strike_Selection_Engine SHALL return NO_VALID_STRIKE with failed checks

### Requirement 4: Strike Selection Engine Deterministic Scoring

**User Story:** As a trading system, I want strike selection to be deterministic and auditable, so that the same inputs always produce the same contract selection.

#### Acceptance Criteria

1. FOR ALL option chains with identical input parameters, THE Strike_Selection_Engine SHALL return the same selected contract
2. WHEN scoring contracts, THE Strike_Selection_Engine SHALL apply mode-specific weightings consistently
3. WHEN multiple contracts have identical scores, THE Strike_Selection_Engine SHALL apply deterministic tie-breaking rules
4. THE Strike_Selection_Engine SHALL include complete scoring breakdown in output for audit purposes

### Requirement 5: Exit Decision Engine Core Functionality

**User Story:** As a trading system, I want to evaluate open positions and determine exit actions, so that profits are captured and losses are limited.

#### Acceptance Criteria

1. WHEN an exit evaluation request is received, THE Exit_Decision_Engine SHALL validate input contains trade position, entry data, contract details, guardrails, targets, live market snapshot, and optional thesis status
2. WHEN evaluating a position, THE Exit_Decision_Engine SHALL apply rule hierarchy in order: Tier 1 hard fail exits, Tier 2 capital protection, Tier 3 profit taking, Tier 4 degradation management
3. WHEN a Tier 1 rule triggers, THE Exit_Decision_Engine SHALL return action FULL_EXIT with urgency HIGH
4. WHEN a Tier 2 rule triggers without Tier 1 violations, THE Exit_Decision_Engine SHALL return action PARTIAL_EXIT or FULL_EXIT with urgency MEDIUM or HIGH
5. WHEN a Tier 3 rule triggers without higher tier violations, THE Exit_Decision_Engine SHALL return action PARTIAL_EXIT with urgency LOW or MEDIUM
6. WHEN a Tier 4 rule triggers without higher tier violations, THE Exit_Decision_Engine SHALL return action TIGHTEN_STOP or PARTIAL_EXIT with urgency LOW
7. WHEN no exit rules trigger, THE Exit_Decision_Engine SHALL return action HOLD with current metrics
8. THE Exit_Decision_Engine SHALL return output containing action, urgency, size percentage, new stop level, triggered rules, rationale, and metrics

### Requirement 6: Exit Decision Engine Mode-Specific Policies

**User Story:** As a trading system, I want exit decisions to respect setup type characteristics, so that scalps exit quickly and LEAPS avoid churn.

#### Acceptance Criteria

1. WHEN setup type is SCALP_GUARDED and time in trade exceeds 30-90 minutes, THE Exit_Decision_Engine SHALL trigger Tier 1 hard fail exit
2. WHEN setup type is SCALP_GUARDED and theta burn exceeds 10-20%, THE Exit_Decision_Engine SHALL trigger Tier 1 hard fail exit
3. WHEN setup type is SCALP_GUARDED and profit reaches +15%, THE Exit_Decision_Engine SHALL trigger Tier 3 partial exit
4. WHEN setup type is SWING and time in trade exceeds 7-14 days without progress, THE Exit_Decision_Engine SHALL trigger Tier 4 time stop
5. WHEN setup type is SWING and regime flips against trade, THE Exit_Decision_Engine SHALL trigger Tier 2 partial exit
6. WHEN setup type is SWING and profit reaches +25%, THE Exit_Decision_Engine SHALL trigger Tier 3 partial exit
7. WHEN setup type is POSITION or LEAPS and major regime reversal occurs, THE Exit_Decision_Engine SHALL trigger Tier 2 capital protection exit
8. WHEN setup type is LEAPS and extreme IV event occurs, THE Exit_Decision_Engine SHALL trigger Tier 2 capital protection exit

### Requirement 7: Exit Decision Engine Greeks-Aware Logic

**User Story:** As a trading system, I want exit decisions to account for option Greeks changes, so that positions are exited when Greeks deteriorate.

#### Acceptance Criteria

1. WHEN delta decays below mode-specific threshold, THE Exit_Decision_Engine SHALL trigger Tier 4 degradation rule
2. WHEN gamma stalls for SCALP or SWING setup, THE Exit_Decision_Engine SHALL trigger Tier 4 degradation rule
3. WHEN theta acceleration exceeds tolerance, THE Exit_Decision_Engine SHALL trigger Tier 4 degradation rule
4. WHEN vega exposure increases during IV shock, THE Exit_Decision_Engine SHALL trigger Tier 4 degradation rule

### Requirement 8: Cross-Engine Determinism and Auditability

**User Story:** As a compliance officer, I want all engine decisions to be deterministic and fully auditable, so that I can review and explain every decision.

#### Acceptance Criteria

1. FOR ALL engine inputs with identical parameters, THE engines SHALL return identical outputs
2. WHEN processing a request, THE Entry_Decision_Engine SHALL log inputs, computed metrics, triggered rules, final decision, and timestamp
3. WHEN processing a request, THE Strike_Selection_Engine SHALL log inputs, computed metrics, triggered rules, final decision, and timestamp
4. WHEN processing a request, THE Exit_Decision_Engine SHALL log inputs, computed metrics, triggered rules, final decision, and timestamp
5. WHEN multiple rules trigger simultaneously, THE Exit_Decision_Engine SHALL prefer the most conservative action deterministically

### Requirement 9: API Endpoints and Type Safety

**User Story:** As a developer, I want fully typed TypeScript APIs for all engines, so that integration is type-safe and errors are caught at compile time.

#### Acceptance Criteria

1. THE Entry_Decision_Engine SHALL expose POST /api/entry-decision endpoint
2. THE Strike_Selection_Engine SHALL expose POST /api/strike-selection endpoint
3. THE Exit_Decision_Engine SHALL expose POST /api/exit-decision endpoint
4. THE engines SHALL define TypeScript interfaces for all input contracts
5. THE engines SHALL define TypeScript interfaces for all output contracts
6. THE engines SHALL validate input contracts at runtime and return validation errors for invalid inputs

### Requirement 10: Stateless Operation

**User Story:** As a system architect, I want all engines to be stateless, so that they can scale horizontally and recover from failures.

#### Acceptance Criteria

1. THE Entry_Decision_Engine SHALL NOT maintain state between requests
2. THE Strike_Selection_Engine SHALL NOT maintain state between requests
3. THE Exit_Decision_Engine SHALL NOT maintain state between requests
4. THE engines SHALL derive all decisions from input parameters only
5. THE engines SHALL NOT depend on external state or caching for decision logic
