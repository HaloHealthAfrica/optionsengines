/**
 * Validation Framework Interface and Types
 * 
 * This module defines the core interfaces and types for the validation framework.
 * The framework validates system behavior against expected outcomes for all requirements.
 * 
 * Requirements: 3.1-3.4, 4.1-4.5, 5.1-5.5, 6.1-6.9, 7.1-7.3, 8.1-8.5, 9.1-9.5, 10.1-10.5, 11.1-11.9, 12.1-12.5, 13.1-13.5
 */

import { SystemState, Decision, AgentActivation } from '../orchestration/test-orchestrator';

/**
 * Result of a validation check
 */
export interface ValidationResult {
  /** Whether the validation passed */
  passed: boolean;
  
  /** Phase being validated */
  phase: string;
  
  /** Requirement being validated */
  requirement: string;
  
  /** Human-readable message describing the result */
  message: string;
  
  /** Optional detailed information about the validation */
  details?: any;
  
  /** Expected value (for failures) */
  expected?: any;
  
  /** Actual value (for failures) */
  actual?: any;
}

/**
 * Expectation for webhook ingestion validation
 */
export interface WebhookIngestionExpectation {
  /** Expected number of webhook processing operations */
  expectedProcessingCount: number;
  
  /** Expected number of enrichment service calls */
  expectedEnrichmentCount: number;
  
  /** Whether snapshot sharing is expected */
  expectedSnapshotSharing: boolean;
  
  /** Expected external API call counts by service */
  expectedAPICalls?: Record<string, number>;
}

/**
 * Expectation for routing validation
 */
export interface RoutingExpectation {
  /** Expected variant assignment */
  expectedVariant: 'A' | 'B';
  
  /** Whether deterministic routing is expected */
  expectedDeterminism: boolean;
  
  /** Whether feature flag behavior is expected to be correct */
  expectedFeatureFlagBehavior: boolean;
  
  /** Expected variant distribution (for batch tests) */
  expectedDistribution?: {
    variantA: number;
    variantB: number;
    tolerance: number; // Acceptable deviation as percentage
  };
  
  /** Expected logging fields */
  expectedLoggingFields?: string[];
}

/**
 * Baseline for Engine A regression validation
 */
export interface EngineABaseline {
  /** Baseline decisions from pre-experiment Engine A */
  baselineDecisions: Decision[];
  
  /** Baseline processing latency in milliseconds */
  baselineLatency: number;
  
  /** Baseline execution mode (always LIVE for Engine A) */
  baselineExecutionMode: 'LIVE';
  
  /** Acceptable latency increase threshold in milliseconds */
  latencyThreshold?: number;
}

/**
 * Expectation for Engine B validation
 */
export interface EngineBExpectation {
  /** Expected agent activations */
  expectedAgentActivations: string[];
  
  /** Expected data source (always SHARED_SNAPSHOT) */
  expectedDataSource: 'SHARED_SNAPSHOT';
  
  /** Expected execution mode (always SHADOW) */
  expectedExecutionMode: 'SHADOW';
  
  /** Expected external API call count (should be 0) */
  expectedExternalAPICalls: number;
  
  /** Expected confidence adjustments */
  expectedConfidenceAdjustments?: {
    agent: string;
    adjustment: 'INCREASE' | 'DECREASE' | 'NEUTRAL';
    reason: string;
  }[];
  
  /** Expected meta-decision aggregation */
  expectedMetaDecisionAggregation?: boolean;
}

/**
 * Expectation for logging validation
 */
export interface LoggingExpectation {
  /** Required fields in log entries */
  requiredFields: string[];
  
  /** Expected variant */
  expectedVariant: 'A' | 'B';
  
  /** Expected agents (for Engine B) */
  expectedAgents?: string[];
  
  /** Expected confidence level */
  expectedConfidence?: number;
  
  /** Expected execution label */
  expectedExecutionLabel: 'SHADOW' | 'LIVE';
  
  /** Expected GEX regime (if applicable) */
  expectedGEXRegime?: string;
  
  /** Confidence tolerance for comparison */
  confidenceTolerance?: number;
}

/**
 * Frontend state for validation
 */
export interface FrontendState {
  /** Signals displayed in the frontend */
  displayedSignals: Array<{
    signalId: string;
    variant: 'A' | 'B';
    agents: string[];
    confidence: number;
    executionLabel: 'SHADOW' | 'LIVE';
    action: string;
    timestamp: number;
  }>;
  
  /** Timestamp when frontend state was captured */
  capturedAt: number;
}

/**
 * Expectation for risk veto validation
 */
export interface RiskVetoExpectation {
  /** Whether a veto is expected */
  expectedVeto: boolean;
  
  /** Expected veto reason (if veto is expected) */
  expectedVetoReason?: string;
  
  /** Whether execution should be prevented */
  expectedExecutionPrevention: boolean;
  
  /** Whether veto should be logged */
  expectedVetoLogging: boolean;
}

/**
 * Expectation for GEX regime validation
 */
export interface GEXRegimeExpectation {
  /** Expected GEX regime type */
  expectedRegime: 'POSITIVE' | 'NEGATIVE' | 'GAMMA_FLIP_NEAR' | 'NEUTRAL';
  
  /** Expected confidence adjustment based on regime */
  expectedConfidenceAdjustment: 'INCREASE' | 'DECREASE' | 'NEUTRAL';
  
  /** Expected agent behavior based on regime */
  expectedAgentBehavior?: {
    agent: string;
    behavior: string;
  }[];
  
  /** Whether GEX attribution is expected in logs */
  expectedGEXAttribution: boolean;
}

/**
 * Validation Framework Interface
 * 
 * The framework provides validation methods for all system phases and requirements.
 */
export interface ValidationFramework {
  /**
   * Validate webhook ingestion behavior
   * 
   * Validates:
   * - Single processing of identical webhooks
   * - Single enrichment call per webhook
   * - Snapshot sharing between engines
   * - No duplicate external API calls
   * 
   * @param state - Captured system state
   * @param expected - Expected ingestion behavior
   * @returns Validation result
   */
  validateWebhookIngestion(
    state: SystemState,
    expected: WebhookIngestionExpectation
  ): ValidationResult;
  
  /**
   * Validate routing behavior
   * 
   * Validates:
   * - Deterministic variant assignment
   * - Feature flag behavior
   * - Variant distribution
   * - Routing logging completeness
   * 
   * @param state - Captured system state
   * @param expected - Expected routing behavior
   * @returns Validation result
   */
  validateRouting(
    state: SystemState,
    expected: RoutingExpectation
  ): ValidationResult;
  
  /**
   * Validate Engine A behavior against baseline
   * 
   * Validates:
   * - No behavioral regression (decisions match baseline)
   * - No performance regression (latency within threshold)
   * - Execution isolation (only live execution)
   * - No new code paths
   * 
   * @param state - Captured system state
   * @param baseline - Baseline behavior from pre-experiment
   * @returns Validation result
   */
  validateEngineA(
    state: SystemState,
    baseline: EngineABaseline
  ): ValidationResult;
  
  /**
   * Validate Engine B behavior
   * 
   * Validates:
   * - Conditional agent activation
   * - Data source isolation (no external API calls)
   * - Shadow execution only
   * - Multi-agent interaction
   * - Meta-decision aggregation
   * 
   * @param state - Captured system state
   * @param expected - Expected Engine B behavior
   * @returns Validation result
   */
  validateEngineB(
    state: SystemState,
    expected: EngineBExpectation
  ): ValidationResult;
  
  /**
   * Validate shadow execution isolation
   * 
   * Validates:
   * - Only shadow execution for Engine B
   * - No broker API calls
   * - Shadow PnL tracking
   * - Live state unchanged
   * 
   * @param state - Captured system state
   * @returns Validation result
   */
  validateShadowExecution(state: SystemState): ValidationResult;
  
  /**
   * Validate logging and attribution
   * 
   * Validates:
   * - Backend logging completeness
   * - All required fields present
   * - Correct attribution
   * - GEX regime logging (if applicable)
   * 
   * @param state - Captured system state
   * @param expected - Expected logging behavior
   * @returns Validation result
   */
  validateLogging(
    state: SystemState,
    expected: LoggingExpectation
  ): ValidationResult;
  
  /**
   * Validate frontend-backend consistency
   * 
   * Validates:
   * - Frontend displays match backend logs
   * - Variant assignment consistency
   * - Agent activation consistency
   * - Confidence score consistency
   * - Execution label consistency
   * 
   * @param frontendState - Captured frontend state
   * @param backendState - Captured backend state
   * @returns Validation result
   */
  validateFrontend(
    frontendState: FrontendState,
    backendState: SystemState
  ): ValidationResult;
  
  /**
   * Validate determinism across multiple runs
   * 
   * Validates:
   * - Identical outputs for identical inputs
   * - Engine A determinism
   * - Engine B determinism
   * - Routing determinism
   * 
   * @param states - Multiple system states from identical test runs
   * @returns Validation result
   */
  validateDeterminism(states: SystemState[]): ValidationResult;
  
  /**
   * Validate risk veto functionality
   * 
   * Validates:
   * - Risk agent can veto trades
   * - Veto prevents execution
   * - Veto is logged with attribution
   * 
   * @param state - Captured system state
   * @param expected - Expected veto behavior
   * @returns Validation result
   */
  validateRiskVeto(
    state: SystemState,
    expected: RiskVetoExpectation
  ): ValidationResult;
  
  /**
   * Validate GEX regime sensitivity
   * 
   * Validates:
   * - Agents adjust behavior based on GEX regime
   * - Confidence adjustments match regime
   * - GEX attribution in logs
   * 
   * @param state - Captured system state
   * @param expected - Expected GEX behavior
   * @returns Validation result
   */
  validateGEXRegime(
    state: SystemState,
    expected: GEXRegimeExpectation
  ): ValidationResult;
  
  /**
   * Validate feature flag kill-switch
   * 
   * Validates:
   * - Engine B disabled when flag is off
   * - All signals route to Engine A
   * - No specialist agents activate
   * - No shadow execution
   * - Behavior matches pre-experiment baseline
   * 
   * @param state - Captured system state
   * @param baseline - Baseline behavior from pre-experiment
   * @returns Validation result
   */
  validateFeatureFlag(
    state: SystemState,
    baseline: EngineABaseline
  ): ValidationResult;
}
