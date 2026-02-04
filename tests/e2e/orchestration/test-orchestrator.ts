/**
 * Test Orchestrator Interface and Types
 * 
 * This module defines the core interfaces and types for the test orchestration layer.
 * The orchestrator coordinates test execution, injects synthetic data, captures system state,
 * and provides replay functionality.
 * 
 * Requirements: 3.1, 3.2, 3.3, 14.1, 14.2, 13.5
 */

import { SyntheticWebhook } from '../generators/webhook-generator';
import { SyntheticGEX } from '../generators/gex-generator';

/**
 * Test configuration for orchestrator setup
 */
export interface TestConfig {
  /** Whether to use an isolated test environment */
  isolatedEnvironment: boolean;
  
  /** Feature flags to configure for the test */
  featureFlags: Record<string, boolean>;
  
  /** Whether to mock external APIs (TwelveData, Alpaca, MarketDataApp, broker APIs) */
  mockExternalAPIs: boolean;
  
  /** Whether to capture all log entries during test execution */
  captureAllLogs: boolean;
  
  /** Optional timeout for test execution in milliseconds */
  timeout?: number;
  
  /** Optional test environment name */
  environment?: string;

  /** Optional deterministic seed for test runs */
  seed?: number;

  /** Use real HTTP/db system instead of synthetic */
  useRealSystem?: boolean;

  /** Base URL for the real webhook endpoint */
  baseUrl?: string;
}

/**
 * Test context that tracks the state of a test execution
 */
export interface TestContext {
  /** Unique identifier for this test run */
  testId: string;
  
  /** Configuration used for this test */
  config: TestConfig;
  
  /** Timestamp when the test started */
  startTime: number;
  
  /** All synthetic data injected during this test */
  injectedData: Array<SyntheticWebhook | SyntheticGEX>;
  
  /** All system states captured during this test */
  capturedStates: SystemState[];
  
  /** Optional metadata for the test */
  metadata?: Record<string, any>;
}

/**
 * Captured system state at a point in time
 */
export interface SystemState {
  /** Timestamp when this state was captured */
  timestamp: number;
  
  /** Number of webhook processing operations */
  webhookProcessingCount: number;
  
  /** Number of enrichment service calls */
  enrichmentCallCount: number;
  
  /** All variant assignments made by the router */
  routerDecisions: VariantAssignment[];
  
  /** All decisions made by Engine A */
  engineADecisions: Decision[];
  
  /** All decisions made by Engine B */
  engineBDecisions: Decision[];
  
  /** All agent activations in Engine B */
  agentActivations: AgentActivation[];
  
  /** All shadow executions */
  shadowExecutions: ShadowTrade[];
  
  /** All live executions */
  liveExecutions: LiveTrade[];
  
  /** All log entries captured */
  logs: LogEntry[];
  
  /** External API call counts by service */
  externalAPICalls: Record<string, number>;
}

/**
 * Variant assignment made by the Strategy Router
 */
export interface VariantAssignment {
  /** Unique identifier for the signal */
  signalId: string;
  
  /** Assigned variant (A or B) */
  variant: 'A' | 'B';
  
  /** Timestamp when assignment was made */
  assignedAt: number;
  
  /** Reason for the assignment */
  reason: string;
  
  /** Feature flags active at time of assignment */
  featureFlags: Record<string, boolean>;
}

/**
 * Trading decision made by an engine
 */
export interface Decision {
  /** Unique identifier for the signal */
  signalId: string;
  
  /** Engine that made the decision */
  engine: 'A' | 'B';
  
  /** Trading action */
  action: 'BUY' | 'SELL' | 'HOLD' | 'CLOSE';
  
  /** Confidence level (0-1) */
  confidence: number;
  
  /** Reasoning for the decision */
  reasoning: string;
  
  /** Timestamp when decision was made */
  decidedAt: number;
  
  /** Optional quantity */
  quantity?: number;
  
  /** Optional price */
  price?: number;
}

/**
 * Agent activation in Engine B
 */
export interface AgentActivation {
  /** Unique identifier for the signal */
  signalId: string;
  
  /** Name of the agent */
  agentName: 'ORB' | 'STRAT' | 'TTM' | 'SATYLAND' | 'RISK' | 'META_DECISION';
  
  /** Whether the agent was activated */
  activated: boolean;
  
  /** Input data provided to the agent */
  input: EnrichedSnapshot;
  
  /** Output from the agent */
  output: {
    /** Agent's recommendation */
    recommendation: 'BUY' | 'SELL' | 'HOLD' | 'VETO';
    
    /** Agent's confidence level (0-1) */
    confidence: number;
    
    /** Agent's reasoning */
    reasoning: string;
  };
  
  /** Timestamp when agent was activated */
  activatedAt: number;
}

/**
 * Enriched snapshot passed to engines
 */
export interface EnrichedSnapshot {
  /** Original webhook payload */
  webhook: WebhookPayload;
  
  /** Market data from external APIs */
  marketData: {
    currentPrice: number;
    bid: number;
    ask: number;
    spread: number;
    dayHigh: number;
    dayLow: number;
    dayVolume: number;
  };
  
  /** GEX data */
  gexData: {
    total_gex: number;
    call_gex: number;
    put_gex: number;
    net_gex: number;
    gamma_flip_level: number | null;
    regime: 'POSITIVE' | 'NEGATIVE' | 'GAMMA_FLIP_NEAR' | 'NEUTRAL';
  };
  
  /** Technical indicators */
  technicalIndicators: {
    orbHigh?: number;
    orbLow?: number;
    ttmSqueeze?: boolean;
    trendDirection?: 'UP' | 'DOWN' | 'SIDEWAYS';
  };
  
  /** Timestamp when enrichment occurred */
  enrichedAt: number;
}

/**
 * Webhook payload structure
 */
export interface WebhookPayload {
  symbol: string;
  timeframe: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  signal?: string;
  strategy?: string;
}

/**
 * Shadow trade execution (Engine B)
 */
export interface ShadowTrade {
  /** Unique identifier for the signal */
  signalId: string;
  
  /** Engine that executed (always 'B' for shadow) */
  engine: 'B';
  
  /** Trading action */
  action: 'BUY' | 'SELL' | 'CLOSE';
  
  /** Quantity */
  quantity: number;
  
  /** Price */
  price: number;
  
  /** Simulated PnL */
  simulatedPnL: number;
  
  /** Timestamp of execution */
  executedAt: number;
  
  /** Broker API was NOT called (always false for shadow) */
  brokerAPICalled: false;
}

/**
 * Live trade execution (Engine A)
 */
export interface LiveTrade {
  /** Unique identifier for the signal */
  signalId: string;
  
  /** Engine that executed (always 'A' for live) */
  engine: 'A';
  
  /** Trading action */
  action: 'BUY' | 'SELL' | 'CLOSE';
  
  /** Quantity */
  quantity: number;
  
  /** Price */
  price: number;
  
  /** Order ID from broker */
  orderId: string;
  
  /** Timestamp of execution */
  executedAt: number;
  
  /** Broker API was called */
  brokerAPICalled: boolean;
}

/**
 * Log entry captured during test execution
 */
export interface LogEntry {
  /** Timestamp of log entry */
  timestamp: number;
  
  /** Log level */
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  
  /** Phase of execution */
  phase: string;
  
  /** Signal ID */
  signalId: string;
  
  /** Variant assignment */
  variant: 'A' | 'B';
  
  /** Activated agents (if Engine B) */
  agents?: string[];
  
  /** Confidence level */
  confidence?: number;
  
  /** Execution label */
  executionLabel: 'SHADOW' | 'LIVE';
  
  /** GEX regime (if available) */
  gexRegime?: string;
  
  /** Log message */
  message: string;

  /** Trading action */
  action?: string;
  
  /** Additional metadata */
  metadata: Record<string, any>;
}

/**
 * Test Orchestrator Interface
 * 
 * The orchestrator coordinates test execution, data injection, state capture, and replay.
 */
export interface TestOrchestrator {
  /**
   * Set up a test environment with the given configuration
   * 
   * @param config - Test configuration
   * @returns Test context for this test run
   */
  setupTest(config: TestConfig): Promise<TestContext>;
  
  /**
   * Inject a synthetic webhook into the system under test
   * 
   * @param context - Test context
   * @param webhook - Synthetic webhook to inject
   */
  injectWebhook(context: TestContext, webhook: SyntheticWebhook): Promise<void>;
  
  /**
   * Inject synthetic GEX data into the system under test
   * 
   * @param context - Test context
   * @param gex - Synthetic GEX data to inject
   */
  injectGEX(context: TestContext, gex: SyntheticGEX): Promise<void>;
  
  /**
   * Capture the current system state
   * 
   * @param context - Test context
   * @returns Captured system state
   */
  captureState(context: TestContext): Promise<SystemState>;
  
  /**
   * Tear down the test environment and clean up resources
   * 
   * @param context - Test context
   */
  teardownTest(context: TestContext): Promise<void>;
  
  /**
   * Replay a test using stored context
   * 
   * @param context - Test context to replay
   * @returns New test context from replay
   */
  replayTest(context: TestContext): Promise<TestContext>;
}
