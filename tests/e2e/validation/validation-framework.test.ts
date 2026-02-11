/**
 * Validation Framework Unit Tests
 * 
 * Tests each validator with known good and bad inputs to ensure:
 * - Validators correctly identify valid behavior
 * - Validators correctly identify invalid behavior
 * - Error messages are clear and actionable
 * - Baseline comparison logic works correctly
 * 
 * Task: 6.8 Write unit tests for validation framework
 */

import { validateWebhookIngestion } from './webhook-ingestion-validator';
import { validateRouting } from './routing-validator';
import { validateEngineA } from './engine-a-validator';
import { validateEngineB } from './engine-b-validator';
import { validateLogging, validateFrontend } from './logging-validator';
import { validateDeterminism } from './determinism-validator';
import {
  SystemState,
  Decision,
  VariantAssignment,
  AgentActivation,
  ShadowTrade,
  LiveTrade,
  LogEntry
} from '../orchestration/test-orchestrator';
import {
  WebhookIngestionExpectation,
  RoutingExpectation,
  EngineABaseline,
  EngineBExpectation,
  LoggingExpectation,
  FrontendState
} from './validation-framework';

describe('Validation Framework', () => {
  describe('Webhook Ingestion Validator', () => {
    it('should pass with correct processing and enrichment counts', () => {
      const state: SystemState = createMockSystemState({
        webhookProcessingCount: 5,
        enrichmentCallCount: 5,
        externalAPICalls: { TwelveData: 5 }
      });

      const expected: WebhookIngestionExpectation = {
        expectedProcessingCount: 5,
        expectedEnrichmentCount: 5,
        expectedSnapshotSharing: false,
        expectedAPICalls: { TwelveData: 5 }
      };

      const result = validateWebhookIngestion(state, expected);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('passed');
    });

    it('should fail with incorrect processing count', () => {
      const state: SystemState = createMockSystemState({
        webhookProcessingCount: 10,
        enrichmentCallCount: 5
      });

      const expected: WebhookIngestionExpectation = {
        expectedProcessingCount: 5,
        expectedEnrichmentCount: 5,
        expectedSnapshotSharing: false
      };

      const result = validateWebhookIngestion(state, expected);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Processing count mismatch');
      expect(result.details).toBeDefined();
      expect(result.expected).toBeDefined();
      expect(result.actual).toBeDefined();
    });

    it('should fail with incorrect enrichment count', () => {
      const state: SystemState = createMockSystemState({
        webhookProcessingCount: 5,
        enrichmentCallCount: 10
      });

      const expected: WebhookIngestionExpectation = {
        expectedProcessingCount: 5,
        expectedEnrichmentCount: 5,
        expectedSnapshotSharing: false
      };

      const result = validateWebhookIngestion(state, expected);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Enrichment count mismatch');
    });

    it('should fail with incorrect external API calls', () => {
      const state: SystemState = createMockSystemState({
        webhookProcessingCount: 5,
        enrichmentCallCount: 5,
        externalAPICalls: { TwelveData: 10 }
      });

      const expected: WebhookIngestionExpectation = {
        expectedProcessingCount: 5,
        expectedEnrichmentCount: 5,
        expectedSnapshotSharing: false,
        expectedAPICalls: { TwelveData: 5 }
      };

      const result = validateWebhookIngestion(state, expected);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('External API call count validation failed');
    });
  });

  describe('Routing Validator', () => {
    it('should pass with correct variant assignment', () => {
      const state: SystemState = createMockSystemState({
        routerDecisions: [
          createMockVariantAssignment('signal-1', 'A'),
          createMockVariantAssignment('signal-2', 'A')
        ]
      });

      const expected: RoutingExpectation = {
        expectedVariant: 'A',
        expectedDeterminism: true,
        expectedFeatureFlagBehavior: true
      };

      const result = validateRouting(state, expected);

      expect(result.passed).toBe(true);
    });

    it('should fail with unexpected variant', () => {
      const state: SystemState = createMockSystemState({
        routerDecisions: [
          createMockVariantAssignment('signal-1', 'A'),
          createMockVariantAssignment('signal-2', 'B')
        ]
      });

      const expected: RoutingExpectation = {
        expectedVariant: 'A',
        expectedDeterminism: true,
        expectedFeatureFlagBehavior: true
      };

      const result = validateRouting(state, expected);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Unexpected variant assignments');
    });

    it('should validate variant distribution within tolerance', () => {
      const state: SystemState = createMockSystemState({
        routerDecisions: [
          ...Array(48).fill(null).map((_, i) => createMockVariantAssignment(`signal-${i}`, 'A')),
          ...Array(52).fill(null).map((_, i) => createMockVariantAssignment(`signal-${i + 48}`, 'B'))
        ]
      });

      const expected: RoutingExpectation = {
        expectedVariant: 'A', // This is ignored when expectedDistribution is provided
        expectedDeterminism: true,
        expectedFeatureFlagBehavior: false, // Don't validate feature flags for this test
        expectedDistribution: {
          variantA: 50, // Expecting 50%
          variantB: 50, // Expecting 50%
          tolerance: 5  // ±5% tolerance, so 45-55% is acceptable
        }
      };

      const result = validateRouting(state, expected);

      expect(result.passed).toBe(true);
    });

    it('should fail variant distribution outside tolerance', () => {
      const state: SystemState = createMockSystemState({
        routerDecisions: [
          ...Array(30).fill(null).map((_, i) => createMockVariantAssignment(`signal-${i}`, 'A')),
          ...Array(70).fill(null).map((_, i) => createMockVariantAssignment(`signal-${i + 30}`, 'B'))
        ]
      });

      const expected: RoutingExpectation = {
        expectedVariant: 'A',
        expectedDeterminism: true,
        expectedFeatureFlagBehavior: true,
        expectedDistribution: {
          variantA: 50,
          variantB: 50,
          tolerance: 5
        }
      };

      const result = validateRouting(state, expected);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('distribution outside tolerance');
    });
  });

  describe('Engine A Validator', () => {
    it('should pass when decisions match baseline', () => {
      const baselineDecisions = [
        createMockDecision('signal-1', 'BUY', 0.8, 'Bullish trend'),
        createMockDecision('signal-2', 'HOLD', 0.5, 'Neutral')
      ];

      const state: SystemState = createMockSystemState({
        engineADecisions: baselineDecisions,
        liveExecutions: [
          createMockExecution('signal-1', 'A', 'LIVE') as LiveTrade
        ]
      });

      const baseline: EngineABaseline = {
        baselineDecisions,
        baselineLatency: 5,
        baselineExecutionMode: 'LIVE'
      };

      const result = validateEngineA(state, baseline);

      expect(result.passed).toBe(true);
    });

    it('should fail when action differs from baseline', () => {
      const baselineDecisions = [
        createMockDecision('signal-1', 'BUY', 0.8, 'Bullish trend')
      ];

      const state: SystemState = createMockSystemState({
        engineADecisions: [
          createMockDecision('signal-1', 'SELL', 0.8, 'Bullish trend')
        ],
        liveExecutions: [
          createMockExecution('signal-1', 'A', 'LIVE') as LiveTrade
        ]
      });

      const baseline: EngineABaseline = {
        baselineDecisions,
        baselineLatency: 5,
        baselineExecutionMode: 'LIVE'
      };

      const result = validateEngineA(state, baseline);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Behavioral regression detected');
    });

    it('should fail when confidence differs from baseline', () => {
      const baselineDecisions = [
        createMockDecision('signal-1', 'BUY', 0.8, 'Bullish trend')
      ];

      const state: SystemState = createMockSystemState({
        engineADecisions: [
          createMockDecision('signal-1', 'BUY', 0.5, 'Bullish trend')
        ],
        liveExecutions: [
          createMockExecution('signal-1', 'A', 'LIVE') as LiveTrade
        ]
      });

      const baseline: EngineABaseline = {
        baselineDecisions,
        baselineLatency: 5,
        baselineExecutionMode: 'LIVE'
      };

      const result = validateEngineA(state, baseline);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Behavioral regression detected');
    });

    it('should fail when Engine A has shadow executions', () => {
      const baselineDecisions = [
        createMockDecision('signal-1', 'BUY', 0.8, 'Bullish trend')
      ];

      const state: SystemState = createMockSystemState({
        engineADecisions: baselineDecisions,
        shadowExecutions: [
          createMockExecution('signal-1', 'B', 'SHADOW') as ShadowTrade
        ]
      });

      const baseline: EngineABaseline = {
        baselineDecisions,
        baselineLatency: 5,
        baselineExecutionMode: 'LIVE'
      };

      const result = validateEngineA(state, baseline);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Execution isolation validation failed');
    });
  });

  describe('Engine B Validator', () => {
    it('should pass with correct agent activations and shadow execution', () => {
      const state: SystemState = createMockSystemState({
        engineBDecisions: [
          createMockDecision('signal-1', 'BUY', 0.75, 'Multi-agent consensus')
        ],
        agentActivations: [
          createMockAgentActivation('signal-1', 'ORB', true),
          createMockAgentActivation('signal-1', 'RISK', true),
          createMockAgentActivation('signal-1', 'META_DECISION', true)
        ],
        shadowExecutions: [
          createMockExecution('signal-1', 'B', 'SHADOW') as ShadowTrade
        ],
        externalAPICalls: {}
      });

      const expected: EngineBExpectation = {
        expectedAgentActivations: ['ORB', 'RISK', 'META_DECISION'],
        expectedDataSource: 'SHARED_SNAPSHOT',
        expectedExecutionMode: 'SHADOW',
        expectedExternalAPICalls: 0,
        expectedMetaDecisionAggregation: true
      };

      const result = validateEngineB(state, expected);

      expect(result.passed).toBe(true);
    });

    it('should fail with missing agent activations', () => {
      const state: SystemState = createMockSystemState({
        engineBDecisions: [
          createMockDecision('signal-1', 'BUY', 0.75, 'Multi-agent consensus')
        ],
        agentActivations: [
          createMockAgentActivation('signal-1', 'ORB', true)
        ],
        shadowExecutions: [
          createMockExecution('signal-1', 'B', 'SHADOW') as ShadowTrade
        ],
        externalAPICalls: {}
      });

      const expected: EngineBExpectation = {
        expectedAgentActivations: ['ORB', 'RISK', 'META_DECISION'],
        expectedDataSource: 'SHARED_SNAPSHOT',
        expectedExecutionMode: 'SHADOW',
        expectedExternalAPICalls: 0
      };

      const result = validateEngineB(state, expected);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Agent activation validation failed');
    });

    it('should fail when Engine B has live executions', () => {
      const state: SystemState = createMockSystemState({
        engineBDecisions: [
          createMockDecision('signal-1', 'BUY', 0.75, 'Multi-agent consensus')
        ],
        agentActivations: [
          createMockAgentActivation('signal-1', 'ORB', true)
        ],
        liveExecutions: [
          createMockExecution('signal-1', 'A', 'LIVE') as LiveTrade
        ],
        externalAPICalls: {}
      });

      const expected: EngineBExpectation = {
        expectedAgentActivations: ['ORB'],
        expectedDataSource: 'SHARED_SNAPSHOT',
        expectedExecutionMode: 'SHADOW',
        expectedExternalAPICalls: 0
      };

      const result = validateEngineB(state, expected);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Shadow execution validation failed');
    });

    it('should fail when shadow execution calls broker API', () => {
      const state: SystemState = createMockSystemState({
        engineBDecisions: [
          createMockDecision('signal-1', 'BUY', 0.75, 'Multi-agent consensus')
        ],
        agentActivations: [
          createMockAgentActivation('signal-1', 'ORB', true)
        ],
        shadowExecutions: [
          {
            signalId: 'signal-1',
            engine: 'B',
            action: 'BUY',
            quantity: 100,
            price: 450.5,
            simulatedPnL: 0,
            executedAt: Date.now(),
            brokerAPICalled: true as any // This is the error case we're testing
          } as ShadowTrade
        ],
        externalAPICalls: {}
      });

      const expected: EngineBExpectation = {
        expectedAgentActivations: ['ORB'],
        expectedDataSource: 'SHARED_SNAPSHOT',
        expectedExecutionMode: 'SHADOW',
        expectedExternalAPICalls: 0
      };

      const result = validateEngineB(state, expected);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Shadow execution validation failed');
    });
  });

  describe('Logging Validator', () => {
    it('should pass with complete logging', () => {
      const state: SystemState = createMockSystemState({
        logs: [
          createMockLogEntry('signal-1', 'A', 'LIVE', 0.8, ['ENGINE_A'])
        ],
        engineADecisions: [
          createMockDecision('signal-1', 'BUY', 0.8, 'Bullish')
        ]
      });

      const expected: LoggingExpectation = {
        requiredFields: ['signalId', 'variant', 'executionLabel', 'confidence'],
        expectedVariant: 'A',
        expectedExecutionLabel: 'LIVE'
      };

      const result = validateLogging(state, expected);

      expect(result.passed).toBe(true);
    });

    it('should fail with missing required fields', () => {
      const state: SystemState = createMockSystemState({
        logs: [
          { signalId: 'signal-1', timestamp: Date.now() } as any
        ],
        engineADecisions: [
          createMockDecision('signal-1', 'BUY', 0.8, 'Bullish')
        ]
      });

      const expected: LoggingExpectation = {
        requiredFields: ['signalId', 'variant', 'executionLabel', 'confidence'],
        expectedVariant: 'A',
        expectedExecutionLabel: 'LIVE'
      };

      const result = validateLogging(state, expected);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Required fields validation failed');
    });

    it('should fail with incorrect variant attribution', () => {
      const state: SystemState = createMockSystemState({
        logs: [
          createMockLogEntry('signal-1', 'B', 'SHADOW', 0.8, ['ORB'])
        ]
      });

      const expected: LoggingExpectation = {
        requiredFields: ['signalId', 'variant', 'executionLabel'],
        expectedVariant: 'A',
        expectedExecutionLabel: 'LIVE'
      };

      const result = validateLogging(state, expected);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Attribution validation failed');
    });
  });

  describe('Frontend Validator', () => {
    it('should pass with consistent frontend-backend state', () => {
      const backendState: SystemState = createMockSystemState({
        logs: [
          createMockLogEntry('signal-1', 'A', 'LIVE', 0.8, ['ENGINE_A']),
          createMockLogEntry('signal-2', 'B', 'SHADOW', 0.75, ['ORB', 'RISK'])
        ]
      });

      const frontendState: FrontendState = {
        displayedSignals: [
          {
            signalId: 'signal-1',
            variant: 'A',
            agents: ['ENGINE_A'],
            confidence: 0.8,
            executionLabel: 'LIVE',
            action: 'BUY',
            timestamp: Date.now()
          },
          {
            signalId: 'signal-2',
            variant: 'B',
            agents: ['ORB', 'RISK'],
            confidence: 0.75,
            executionLabel: 'SHADOW',
            action: 'BUY',
            timestamp: Date.now()
          }
        ],
        capturedAt: Date.now()
      };

      const result = validateFrontend(frontendState, backendState);

      expect(result.passed).toBe(true);
    });

    it('should fail with variant mismatch', () => {
      const backendState: SystemState = createMockSystemState({
        logs: [
          createMockLogEntry('signal-1', 'A', 'LIVE', 0.8, ['ENGINE_A'])
        ]
      });

      const frontendState: FrontendState = {
        displayedSignals: [
          {
            signalId: 'signal-1',
            variant: 'B',
            agents: ['ENGINE_A'],
            confidence: 0.8,
            executionLabel: 'LIVE',
            action: 'BUY',
            timestamp: Date.now()
          }
        ],
        capturedAt: Date.now()
      };

      const result = validateFrontend(frontendState, backendState);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Frontend-backend consistency validation failed');
    });
  });

  describe('Determinism Validator', () => {
    it('should pass with identical runs', () => {
      const decision1 = createMockDecision('signal-1', 'BUY', 0.8, 'Bullish');
      const decision2 = createMockDecision('signal-2', 'HOLD', 0.5, 'Neutral');

      const state1: SystemState = createMockSystemState({
        engineADecisions: [decision1, decision2],
        routerDecisions: [
          createMockVariantAssignment('signal-1', 'A'),
          createMockVariantAssignment('signal-2', 'A')
        ]
      });

      const state2: SystemState = createMockSystemState({
        engineADecisions: [decision1, decision2],
        routerDecisions: [
          createMockVariantAssignment('signal-1', 'A'),
          createMockVariantAssignment('signal-2', 'A')
        ]
      });

      const result = validateDeterminism([state1, state2]);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('passed across 2 runs');
    });

    it('should fail with non-deterministic Engine A decisions', () => {
      const state1: SystemState = createMockSystemState({
        engineADecisions: [
          createMockDecision('signal-1', 'BUY', 0.8, 'Bullish')
        ]
      });

      const state2: SystemState = createMockSystemState({
        engineADecisions: [
          createMockDecision('signal-1', 'SELL', 0.8, 'Bearish')
        ]
      });

      const result = validateDeterminism([state1, state2]);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Engine A determinism validation failed');
    });

    it('should fail with non-deterministic routing', () => {
      const state1: SystemState = createMockSystemState({
        routerDecisions: [
          createMockVariantAssignment('signal-1', 'A')
        ]
      });

      const state2: SystemState = createMockSystemState({
        routerDecisions: [
          createMockVariantAssignment('signal-1', 'B')
        ]
      });

      const result = validateDeterminism([state1, state2]);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Routing determinism validation failed');
    });

    it('should require at least 2 runs', () => {
      const state: SystemState = createMockSystemState({});

      const result = validateDeterminism([state]);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('requires at least 2 test runs');
    });
  });
});

// Helper functions to create mock data

function createMockSystemState(overrides: Partial<SystemState> = {}): SystemState {
  return {
    timestamp: Date.now(),
    webhookProcessingCount: 0,
    enrichmentCallCount: 0,
    routerDecisions: [],
    engineADecisions: [],
    engineBDecisions: [],
    agentActivations: [],
    liveExecutions: [],
    shadowExecutions: [],
    logs: [],
    externalAPICalls: {},
    ...overrides
  };
}

function createMockDecision(
  signalId: string,
  action: 'BUY' | 'SELL' | 'HOLD' | 'CLOSE',
  confidence: number,
  reasoning: string
): Decision {
  return {
    signalId,
    engine: 'A',
    action,
    confidence,
    reasoning,
    decidedAt: Date.now()
  };
}

function createMockVariantAssignment(
  signalId: string,
  variant: 'A' | 'B'
): VariantAssignment {
  return {
    signalId,
    variant,
    reason: 'Test assignment',
    featureFlags: { engineB: variant === 'B' },
    assignedAt: Date.now()
  };
}

function createMockAgentActivation(
  signalId: string,
  agentName: string,
  activated: boolean
): AgentActivation {
  return {
    signalId,
    agentName: agentName as any,
    activated,
    input: {
      webhook: {
        symbol: 'SPY',
        timeframe: '5m',
        timestamp: Date.now(),
        open: 450,
        high: 451,
        low: 449,
        close: 450.5,
        volume: 1000000
      },
      marketData: {
        currentPrice: 450.5,
        bid: 450.4,
        ask: 450.6,
        spread: 0.2,
        dayHigh: 452,
        dayLow: 448,
        dayVolume: 50000000
      },
      gexData: {
        total_gex: 1000000,
        call_gex: 600000,
        put_gex: 400000,
        net_gex: 200000,
        gamma_flip_level: 445,
        regime: 'POSITIVE'
      },
      technicalIndicators: {
        orbHigh: 451,
        orbLow: 449,
        ttmSqueeze: false,
        trendDirection: 'UP'
      },
      enrichedAt: Date.now()
    },
    output: {
      recommendation: activated ? 'BUY' : 'HOLD',
      confidence: activated ? 0.7 : 0.5,
      reasoning: `${agentName} reasoning`
    },
    activatedAt: Date.now()
  };
}

function createMockExecution(
  signalId: string,
  _engine: 'A' | 'B',
  mode: 'LIVE' | 'SHADOW'
): ShadowTrade | LiveTrade {
  if (mode === 'SHADOW') {
    return {
      signalId,
      engine: 'B',
      action: 'BUY',
      quantity: 100,
      price: 450.5,
      simulatedPnL: 0,
      executedAt: Date.now(),
      brokerAPICalled: false
    } as ShadowTrade;
  } else {
    return {
      signalId,
      engine: 'A',
      action: 'BUY',
      quantity: 100,
      price: 450.5,
      orderId: 'order-123',
      executedAt: Date.now(),
      brokerAPICalled: true
    } as LiveTrade;
  }
}

function createMockLogEntry(
  signalId: string,
  variant: 'A' | 'B',
  executionLabel: 'LIVE' | 'SHADOW',
  confidence: number,
  agents: string[]
): LogEntry {
  return {
    signalId,
    variant,
    executionLabel,
    confidence,
    agents,
    timestamp: Date.now(),
    level: 'INFO',
    phase: 'execution',
    message: 'Test log entry',
    metadata: {}
  };
}
