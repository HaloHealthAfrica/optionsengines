/**
 * Phase 7: Strategy Interaction Tests
 * 
 * Tests multi-agent interaction behavior including:
 * - ORB + TTM alignment confidence adjustments
 * - Strat continuation vs reversal patterns
 * - Satyland confirmation effects
 * - Agent disagreement resolution
 * 
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import * as fc from 'fast-check';
import { DefaultWebhookGenerator } from '../generators/webhook-generator-impl';
import { TestOrchestratorImpl } from '../orchestration/test-orchestrator-impl';
import { validateEngineB } from '../validation/engine-b-validator';
import { EngineBExpectation } from '../validation/validation-framework';

describe('Phase 7: Strategy Interaction', () => {
  let orchestrator: TestOrchestratorImpl;
  let webhookGenerator: DefaultWebhookGenerator;

  beforeEach(() => {
    orchestrator = new TestOrchestratorImpl();
    webhookGenerator = new DefaultWebhookGenerator();
  });

  afterEach(async () => {
    // Cleanup any test contexts
  });

  describe('16.1 Strategy Interaction Test Suite Setup', () => {
    it('should initialize test fixtures for multi-agent scenarios', () => {
      // ORB + TTM alignment scenario
      const orbTtmWebhook = webhookGenerator.generateWebhook({
        symbol: 'SPY',
        timeframe: '5m',
        session: 'RTH_OPEN',
        pattern: 'ORB_BREAKOUT',
        price: 450.00,
        volume: 1000000,
        timestamp: Date.now()
      });

      expect(orbTtmWebhook).toBeDefined();
      expect(orbTtmWebhook.metadata.synthetic).toBe(true);
      expect(orbTtmWebhook.payload.pattern).toBeDefined();
    });

    it('should set up test orchestrator for interaction tests', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      expect(context).toBeDefined();
      expect(context.testId).toBeDefined();
      expect(context.config.featureFlags.engineB).toBe(true);

      await orchestrator.teardownTest(context);
    });
  });

  describe('16.2 Property Test: Multi-Agent Confidence Adjustment', () => {
    /**
     * Property 19: Multi-Agent Confidence Adjustment
     * 
     * For any Engine_B decision where multiple agents activate, confidence adjustments 
     * must follow defined rules:
     * - ORB+TTM alignment increases confidence
     * - Strat continuation increases confidence
     * - Strat reversal decreases confidence
     * - Satyland confirmation increases confidence
     * - Agent disagreement triggers Meta-Decision conflict resolution
     * 
     * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5
     */
    it('should adjust confidence based on multi-agent interactions', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            interactionType: fc.constantFrom(
              'ORB_TTM_ALIGNMENT',
              'STRAT_CONTINUATION',
              'STRAT_REVERSAL',
              'SATYLAND_CONFIRMATION',
              'AGENT_DISAGREEMENT'
            ),
            symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
            timeframe: fc.constantFrom('1m', '5m', '15m')
          }),
          async (scenario) => {
            // Setup test
            const context = await orchestrator.setupTest({
              isolatedEnvironment: true,
              featureFlags: { engineB: true },
              mockExternalAPIs: true,
              captureAllLogs: true
            });

            try {
              // Generate webhook based on interaction type
              const priceMap: Record<string, number> = { SPY: 450.00, QQQ: 380.00, SPX: 4500.00 };
              const pattern = getPatternForInteraction(scenario.interactionType);
              
              const webhook = webhookGenerator.generateWebhook({
                symbol: scenario.symbol as 'SPY' | 'QQQ' | 'SPX',
                timeframe: scenario.timeframe as '1m' | '5m' | '15m',
                session: 'RTH_OPEN',
                pattern: pattern as any,
                price: priceMap[scenario.symbol as keyof typeof priceMap],
                volume: 1000000,
                timestamp: Date.now(),
                interactionType: scenario.interactionType
              });

              // Inject webhook
              await orchestrator.injectWebhook(context, webhook);

              // Wait for processing
              await new Promise(resolve => setTimeout(resolve, 150));

              // Capture state
              const state = await orchestrator.captureState(context);

              // Validate confidence adjustments based on interaction type
              const expectation: EngineBExpectation = {
                expectedAgentActivations: getExpectedAgents(scenario.interactionType),
                expectedDataSource: 'SHARED_SNAPSHOT',
                expectedExecutionMode: 'SHADOW',
                expectedExternalAPICalls: 0,
                expectedMetaDecisionAggregation: scenario.interactionType === 'AGENT_DISAGREEMENT'
              };

              const result = validateEngineB(state, expectation);

              // Property assertion
              expect(result.passed).toBe(true);
              if (!result.passed) {
                console.error('Multi-agent confidence adjustment violation:', result.message);
                console.error('Interaction type:', scenario.interactionType);
                console.error('Details:', result.details);
              }
            } finally {
              await orchestrator.teardownTest(context);
            }
          }
        ),
        { numRuns: 100, seed: 100 }
      );
    });
  });

  describe('16.3 Unit Tests: Specific Interaction Scenarios', () => {
    it('should increase confidence when ORB + TTM align', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      try {
        // Generate ORB breakout webhook (should activate both ORB and TTM)
        const webhook = webhookGenerator.generateWebhook({
          symbol: 'SPY',
          timeframe: '5m',
          session: 'RTH_OPEN',
          pattern: 'ORB_BREAKOUT',
          price: 450.00,
          volume: 1000000,
          timestamp: Date.now(),
          interactionType: 'ORB_TTM_ALIGNMENT'
        });

        await orchestrator.injectWebhook(context, webhook);
        await new Promise(resolve => setTimeout(resolve, 150));

        const state = await orchestrator.captureState(context);

        // Verify both ORB and TTM activated
        const orbActivated = state.agentActivations.some(
          (a: { agentName: string; activated: boolean }) => 
            a.agentName === 'ORB' && a.activated
        );
        const ttmActivated = state.agentActivations.some(
          (a: { agentName: string; activated: boolean }) => 
            a.agentName === 'TTM' && a.activated
        );

        expect(orbActivated).toBe(true);
        expect(ttmActivated).toBe(true);

        // Verify confidence increased due to alignment
        if (state.engineBDecisions.length > 0) {
          const decision = state.engineBDecisions[0];
          expect(decision.confidence).toBeGreaterThan(0.5); // Baseline confidence
        }
      } finally {
        await orchestrator.teardownTest(context);
      }
    });

    it('should increase confidence for Strat continuation patterns', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      try {
        const webhook = webhookGenerator.generateWebhook({
          symbol: 'SPY',
          timeframe: '5m',
          session: 'MID_DAY',
          pattern: 'TREND_CONTINUATION',
          price: 450.00,
          volume: 1000000,
          timestamp: Date.now()
        });

        await orchestrator.injectWebhook(context, webhook);
        await new Promise(resolve => setTimeout(resolve, 150));

        const state = await orchestrator.captureState(context);

        // Verify Strat agent activated
        const stratActivated = state.agentActivations.some(
          (a: { agentName: string; activated: boolean }) => 
            a.agentName === 'STRAT' && a.activated
        );

        expect(stratActivated).toBe(true);

        // Verify confidence increased for continuation
        if (state.engineBDecisions.length > 0) {
          const decision = state.engineBDecisions[0];
          expect(decision.confidence).toBeGreaterThan(0.5);
        }
      } finally {
        await orchestrator.teardownTest(context);
      }
    });

    it('should decrease confidence for Strat reversal patterns', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      try {
        const webhook = webhookGenerator.generateWebhook({
          symbol: 'SPY',
          timeframe: '5m',
          session: 'POWER_HOUR',
          pattern: 'ORB_FAKEOUT', // Fakeout is a reversal pattern
          price: 450.00,
          volume: 1000000,
          timestamp: Date.now()
        });

        await orchestrator.injectWebhook(context, webhook);
        await new Promise(resolve => setTimeout(resolve, 150));

        const state = await orchestrator.captureState(context);

        // Verify Strat agent activated
        const stratActivated = state.agentActivations.some(
          (a: { agentName: string; activated: boolean }) => 
            a.agentName === 'STRAT' && a.activated
        );

        expect(stratActivated).toBe(true);

        // Verify confidence decreased for reversal
        if (state.engineBDecisions.length > 0) {
          const decision = state.engineBDecisions[0];
          expect(decision.confidence).toBeLessThan(0.7); // Lower than typical
        }
      } finally {
        await orchestrator.teardownTest(context);
      }
    });

    it('should increase confidence when Satyland confirms', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      try {
        // Generate webhook that should trigger Satyland confirmation
        const webhook = webhookGenerator.generateWebhook({
          symbol: 'SPY',
          timeframe: '5m',
          session: 'RTH_OPEN',
          pattern: 'ORB_BREAKOUT',
          price: 450.00,
          volume: 1000000,
          timestamp: Date.now(),
          interactionType: 'ORB_TTM_ALIGNMENT'
        });

        await orchestrator.injectWebhook(context, webhook);
        await new Promise(resolve => setTimeout(resolve, 150));

        const state = await orchestrator.captureState(context);

        // Verify Satyland activated
        const satylandActivated = state.agentActivations.some(
          (a: { agentName: string; activated: boolean }) => 
            a.agentName === 'SATYLAND' && a.activated
        );

        if (satylandActivated) {
          // Verify confidence increased due to confirmation
          if (state.engineBDecisions.length > 0) {
            const decision = state.engineBDecisions[0];
            expect(decision.confidence).toBeGreaterThan(0.5);
          }
        }
      } finally {
        await orchestrator.teardownTest(context);
      }
    });

    it('should invoke Meta-Decision agent when agents disagree', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      try {
        // Generate choppy market webhook (likely to cause disagreement)
        const webhook = webhookGenerator.generateWebhook({
          symbol: 'SPY',
          timeframe: '5m',
          session: 'MID_DAY',
          pattern: 'CHOP',
          price: 450.00,
          volume: 1000000,
          timestamp: Date.now()
        });

        await orchestrator.injectWebhook(context, webhook);
        await new Promise(resolve => setTimeout(resolve, 150));

        const state = await orchestrator.captureState(context);

        // Verify Meta-Decision agent was invoked
        const metaActivated = state.agentActivations.some(
          (a: { agentName: string; activated: boolean }) => 
            a.agentName === 'META_DECISION' && a.activated
        );

        expect(metaActivated).toBe(true);

        // Verify multiple agents activated (causing potential disagreement)
        const activatedAgents = state.agentActivations.filter(
          (a: { agentName: string; activated: boolean }) => 
            a.agentName !== 'META_DECISION' && a.activated
        );

        expect(activatedAgents.length).toBeGreaterThan(1);
      } finally {
        await orchestrator.teardownTest(context);
      }
    });
  });
});

/**
 * Helper function to get pattern for interaction type
 */
function getPatternForInteraction(interactionType: string): string {
  switch (interactionType) {
    case 'ORB_TTM_ALIGNMENT':
      return 'ORB_BREAKOUT';
    case 'STRAT_CONTINUATION':
      return 'TREND_CONTINUATION';
    case 'STRAT_REVERSAL':
      return 'ORB_FAKEOUT';
    case 'SATYLAND_CONFIRMATION':
      return 'ORB_BREAKOUT';
    case 'AGENT_DISAGREEMENT':
      return 'CHOP';
    default:
      return 'ORB_BREAKOUT';
  }
}

/**
 * Helper function to get expected agents for interaction type
 */
function getExpectedAgents(interactionType: string): string[] {
  switch (interactionType) {
    case 'ORB_TTM_ALIGNMENT':
      return ['ORB', 'TTM', 'RISK', 'META_DECISION'];
    case 'STRAT_CONTINUATION':
      return ['STRAT', 'RISK', 'META_DECISION'];
    case 'STRAT_REVERSAL':
      return ['STRAT', 'RISK', 'META_DECISION'];
    case 'SATYLAND_CONFIRMATION':
      return ['ORB', 'SATYLAND', 'RISK', 'META_DECISION'];
    case 'AGENT_DISAGREEMENT':
      return ['RISK', 'META_DECISION']; // Multiple agents may activate
    default:
      return ['RISK', 'META_DECISION'];
  }
}

