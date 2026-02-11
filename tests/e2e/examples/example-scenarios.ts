/**
 * Example Test Scenarios
 * 
 * This file provides example scenarios for debugging and learning.
 * These scenarios demonstrate how to use the E2E testing system.
 */

import { WebhookScenario } from '../generators/webhook-generator';
import { GEXScenario } from '../generators/gex-generator';

/**
 * Example Webhook Scenarios
 */
export const exampleWebhookScenarios: WebhookScenario[] = [
  // ORB Breakout - Bullish
  {
    symbol: 'SPY',
    timeframe: '5m',
    session: 'RTH_OPEN',
    pattern: 'ORB_BREAKOUT',
    price: 450.00,
    volume: 5000000,
    timestamp: Date.now()
  },

  // ORB Fakeout - Reversal
  {
    symbol: 'QQQ',
    timeframe: '5m',
    session: 'RTH_OPEN',
    pattern: 'ORB_FAKEOUT',
    price: 380.00,
    volume: 3000000,
    timestamp: Date.now()
  },

  // Trend Continuation - Mid Day
  {
    symbol: 'SPY',
    timeframe: '15m',
    session: 'MID_DAY',
    pattern: 'TREND_CONTINUATION',
    price: 451.50,
    volume: 2000000,
    timestamp: Date.now()
  },

  // Choppy Market - Low Conviction
  {
    symbol: 'SPX',
    timeframe: '1m',
    session: 'MID_DAY',
    pattern: 'CHOP',
    price: 4500.00,
    volume: 1000000,
    timestamp: Date.now()
  },

  // Volatility Compression - Pre-Breakout
  {
    symbol: 'SPY',
    timeframe: '5m',
    session: 'POWER_HOUR',
    pattern: 'VOL_COMPRESSION',
    price: 449.75,
    volume: 4000000,
    timestamp: Date.now()
  },

  // Volatility Expansion - High Movement
  {
    symbol: 'QQQ',
    timeframe: '5m',
    session: 'POWER_HOUR',
    pattern: 'VOL_EXPANSION',
    price: 382.50,
    volume: 8000000,
    timestamp: Date.now()
  }
];

/**
 * Example GEX Scenarios
 */
export const exampleGEXScenarios: GEXScenario[] = [
  // Positive GEX - Pinning Behavior
  {
    symbol: 'SPY',
    spotPrice: 450.00,
    regime: 'POSITIVE',
    total_gex: 5000000,
    call_gex: 3500000,
    put_gex: 1500000
  },

  // Negative GEX - Trending Behavior
  {
    symbol: 'QQQ',
    spotPrice: 380.00,
    regime: 'NEGATIVE',
    total_gex: -3000000,
    call_gex: 1000000,
    put_gex: 4000000
  },

  // Gamma Flip Near - High Sensitivity
  {
    symbol: 'SPY',
    spotPrice: 450.00,
    regime: 'GAMMA_FLIP_NEAR',
    total_gex: 500000,
    call_gex: 2500000,
    put_gex: 2000000,
    gamma_flip_level: 449.50
  },

  // Neutral GEX - Baseline Behavior
  {
    symbol: 'SPX',
    spotPrice: 4500.00,
    regime: 'NEUTRAL',
    total_gex: 100000,
    call_gex: 2000000,
    put_gex: 1900000
  }
];

/**
 * Example Multi-Agent Scenarios
 */
export const exampleMultiAgentScenarios = [
  {
    name: 'ORB + TTM Alignment',
    description: 'Both ORB and TTM agents activate and align, increasing confidence',
    webhook: {
      symbol: 'SPY' as const,
      timeframe: '5m' as const,
      session: 'RTH_OPEN' as const,
      pattern: 'ORB_BREAKOUT' as const,
      price: 450.00,
      volume: 5000000,
      timestamp: Date.now()
    },
    expectedAgents: ['ORB', 'TTM', 'RISK', 'META_DECISION'],
    expectedConfidenceAdjustment: 'INCREASE' as const
  },

  {
    name: 'Strat Continuation',
    description: 'Strat agent detects continuation pattern, increasing confidence',
    webhook: {
      symbol: 'SPY' as const,
      timeframe: '15m' as const,
      session: 'MID_DAY' as const,
      pattern: 'TREND_CONTINUATION' as const,
      price: 451.50,
      volume: 2000000,
      timestamp: Date.now()
    },
    expectedAgents: ['STRAT', 'RISK', 'META_DECISION'],
    expectedConfidenceAdjustment: 'INCREASE' as const
  },

  {
    name: 'Strat Reversal',
    description: 'Strat agent detects reversal pattern, decreasing confidence',
    webhook: {
      symbol: 'QQQ' as const,
      timeframe: '5m' as const,
      session: 'RTH_OPEN' as const,
      pattern: 'ORB_FAKEOUT' as const,
      price: 380.00,
      volume: 3000000,
      timestamp: Date.now()
    },
    expectedAgents: ['STRAT', 'RISK', 'META_DECISION'],
    expectedConfidenceAdjustment: 'DECREASE' as const
  },

  {
    name: 'Agent Disagreement',
    description: 'Multiple agents disagree, triggering Meta-Decision resolution',
    webhook: {
      symbol: 'SPX' as const,
      timeframe: '1m' as const,
      session: 'MID_DAY' as const,
      pattern: 'CHOP' as const,
      price: 4500.00,
      volume: 1000000,
      timestamp: Date.now()
    },
    expectedAgents: ['RISK', 'META_DECISION'],
    expectedConfidenceAdjustment: 'NEUTRAL' as const
  }
];

/**
 * Example Failure Scenarios for Debugging
 */
export const exampleFailureScenarios = [
  {
    name: 'Duplicate Webhook Processing',
    description: 'Tests idempotency by sending the same webhook multiple times',
    scenario: {
      symbol: 'SPY' as const,
      timeframe: '5m' as const,
      session: 'RTH_OPEN' as const,
      pattern: 'ORB_BREAKOUT' as const,
      price: 450.00,
      volume: 5000000,
      timestamp: Date.now()
    },
    duplicateCount: 3,
    expectedProcessingCount: 1,
    expectedEnrichmentCount: 1
  },

  {
    name: 'High Volatility Risk Veto',
    description: 'Tests risk veto with high volatility conditions',
    scenario: {
      symbol: 'SPY' as const,
      timeframe: '1m' as const,
      session: 'POWER_HOUR' as const,
      pattern: 'VOL_EXPANSION' as const,
      price: 450.00,
      volume: 10000000,
      timestamp: Date.now()
    },
    expectedVeto: true,
    expectedReason: 'HIGH_VOLATILITY'
  },

  {
    name: 'Shadow Execution Isolation',
    description: 'Tests that Engine B never makes live broker API calls',
    scenario: {
      symbol: 'QQQ' as const,
      timeframe: '5m' as const,
      session: 'RTH_OPEN' as const,
      pattern: 'ORB_BREAKOUT' as const,
      price: 380.00,
      volume: 3000000,
      timestamp: Date.now()
    },
    expectedShadowExecutions: 1,
    expectedLiveExecutions: 0,
    expectedBrokerAPICalls: 0
  },

  {
    name: 'Feature Flag Kill-Switch',
    description: 'Tests that disabling Engine_B routes all signals to Engine_A',
    scenario: {
      symbol: 'SPY' as const,
      timeframe: '5m' as const,
      session: 'RTH_OPEN' as const,
      pattern: 'ORB_BREAKOUT' as const,
      price: 450.00,
      volume: 5000000,
      timestamp: Date.now()
    },
    featureFlags: { engineB: false },
    expectedVariant: 'A' as const,
    expectedEngineADecisions: 1,
    expectedEngineBDecisions: 0
  }
];

/**
 * Example Test Execution
 * 
 * This demonstrates how to use the example scenarios in tests
 */
export const exampleTestExecution = `
import { TestOrchestratorImpl } from '../orchestration/test-orchestrator-impl';
import { DefaultWebhookGenerator } from '../generators/webhook-generator-impl';
import { exampleWebhookScenarios } from './example-scenarios';

describe('Example Test', () => {
  let orchestrator: TestOrchestratorImpl;
  let webhookGenerator: DefaultWebhookGenerator;

  beforeEach(() => {
    orchestrator = new TestOrchestratorImpl();
    webhookGenerator = new DefaultWebhookGenerator();
  });

  it('should process ORB breakout scenario', async () => {
    const context = await orchestrator.setupTest({
      isolatedEnvironment: true,
      featureFlags: { engineB: true },
      mockExternalAPIs: true,
      captureAllLogs: true
    });

    try {
      // Use example scenario
      const scenario = exampleWebhookScenarios[0]; // ORB Breakout
      const webhook = webhookGenerator.generateWebhook(scenario);

      // Inject and process
      await orchestrator.injectWebhook(context, webhook);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Capture and validate
      const state = await orchestrator.captureState(context);
      
      expect(state.webhookProcessingCount).toBe(1);
      expect(state.engineBDecisions.length).toBeGreaterThan(0);
    } finally {
      await orchestrator.teardownTest(context);
    }
  });
});
`;

/**
 * Example Property Test
 */
export const examplePropertyTest = `
import * as fc from 'fast-check';
import { webhookScenarioArbitrary } from '../arbitraries';

it('should validate property across all scenarios', async () => {
  await fc.assert(
    fc.asyncProperty(
      webhookScenarioArbitrary(),
      async (scenario) => {
        const context = await orchestrator.setupTest({
          isolatedEnvironment: true,
          featureFlags: { engineB: true },
          mockExternalAPIs: true,
          captureAllLogs: true
        });

        try {
          const webhook = webhookGenerator.generateWebhook(scenario);
          await orchestrator.injectWebhook(context, webhook);
          await new Promise(resolve => setTimeout(resolve, 100));

          const state = await orchestrator.captureState(context);
          
          // Property assertion
          expect(state.webhookProcessingCount).toBeGreaterThan(0);
        } finally {
          await orchestrator.teardownTest(context);
        }
      }
    ),
    { numRuns: 100, seed: 42 }
  );
});
`;

/**
 * Example Debugging Scenario
 */
export const exampleDebuggingScenario = `
// To debug a specific scenario, use a fixed seed and single run:

it('should debug specific scenario', async () => {
  const context = await orchestrator.setupTest({
    isolatedEnvironment: true,
    featureFlags: { engineB: true },
    mockExternalAPIs: true,
    captureAllLogs: true
  });

  try {
    // Use specific scenario that's failing
    const webhook = webhookGenerator.generateWebhook({
      symbol: 'SPY',
      timeframe: '5m',
      session: 'RTH_OPEN',
      pattern: 'ORB_BREAKOUT',
      price: 450.00,
      volume: 5000000,
      timestamp: 1234567890 // Fixed timestamp for reproducibility
    });

    await orchestrator.injectWebhook(context, webhook);
    await new Promise(resolve => setTimeout(resolve, 100));

    const state = await orchestrator.captureState(context);
    
    // Add detailed logging
    console.log('State:', JSON.stringify(state, null, 2));
    console.log('Decisions:', state.engineBDecisions);
    console.log('Agent Activations:', state.agentActivations);
    
    // Add assertions
    expect(state.webhookProcessingCount).toBe(1);
  } finally {
    await orchestrator.teardownTest(context);
  }
});
`;
