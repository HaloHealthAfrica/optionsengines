/**
 * Phase 6: Shadow Execution Tests
 * 
 * Tests shadow execution isolation including:
 * - Only shadow execution for Engine B
 * - No broker API calls
 * - Shadow PnL tracking
 * - Live state unchanged
 * 
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */

import * as fc from 'fast-check';
import { DefaultWebhookGenerator } from '../generators/webhook-generator-impl';
import { TestOrchestratorImpl } from '../orchestration/test-orchestrator-impl';
import { validateEngineB } from '../validation/engine-b-validator';
import { EngineBExpectation } from '../validation/validation-framework';

describe('Phase 6: Shadow Execution', () => {
  let orchestrator: TestOrchestratorImpl;
  let webhookGenerator: DefaultWebhookGenerator;

  beforeEach(() => {
    orchestrator = new TestOrchestratorImpl();
    webhookGenerator = new DefaultWebhookGenerator();
  });

  afterEach(async () => {
    // Cleanup any test contexts
  });

  describe('14.1 Shadow Execution Test Suite Setup', () => {
    it('should initialize test fixtures for Engine B decisions', () => {
      const webhook = webhookGenerator.generateWebhook({
        symbol: 'SPY',
        timeframe: '5m',
        session: 'RTH_OPEN',
        pattern: 'ORB_BREAKOUT',
        price: 450.00,
        volume: 1000000,
        timestamp: Date.now()
      });

      expect(webhook).toBeDefined();
      expect(webhook.metadata.synthetic).toBe(true);
    });

    it('should set up broker API mocking and call tracking', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      expect(context).toBeDefined();
      expect(context.config.mockExternalAPIs).toBe(true);

      await orchestrator.teardownTest(context);
    });

    it('should set up test orchestrator for shadow execution tests', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      expect(context).toBeDefined();
      await orchestrator.teardownTest(context);
    });
  });

  describe('14.2 Property Test: Shadow Execution Isolation', () => {
    /**
     * Property 18: Shadow Execution Isolation
     * 
     * For any Engine B decision D:
     * - D executes in SHADOW mode only
     * - No broker API calls are made
     * - Shadow PnL is tracked
     * - Live state remains unchanged
     * - Broker API called flag is false
     * 
     * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
     */
    it('should ensure shadow execution isolation for Engine B', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
            timeframe: fc.constantFrom('1m', '5m', '15m'),
            session: fc.constantFrom('RTH_OPEN', 'MID_DAY', 'POWER_HOUR'),
            pattern: fc.constantFrom('ORB_BREAKOUT', 'TREND_CONTINUATION', 'VOL_EXPANSION')
          }),
          async (scenario) => {
            const context = await orchestrator.setupTest({
              isolatedEnvironment: true,
              featureFlags: { engineB: true },
              mockExternalAPIs: true,
              captureAllLogs: true
            });

            try {
              // Generate webhook
              const priceMap: Record<string, number> = { SPY: 450.00, QQQ: 380.00, SPX: 4500.00 };
              const webhook = webhookGenerator.generateWebhook({
                ...scenario,
                price: priceMap[scenario.symbol],
                volume: 1000000,
                timestamp: Date.now()
              });

              // Inject webhook
              await orchestrator.injectWebhook(context, webhook);

              // Wait for processing
              await new Promise(resolve => setTimeout(resolve, 150));

              // Capture state
              const state = await orchestrator.captureState(context);

              // Validate shadow execution isolation
              const expected: EngineBExpectation = {
                expectedAgentActivations: ['RISK'], // At minimum
                expectedDataSource: 'SHARED_SNAPSHOT',
                expectedExecutionMode: 'SHADOW',
                expectedExternalAPICalls: 0
              };

              const result = validateEngineB(state, expected);

              // Property assertion
              expect(result.passed).toBe(true);
              if (!result.passed) {
                console.error('Shadow execution isolation violation:', result.message);
                console.error('Details:', result.details);
              }

              // Additional shadow execution checks
              // All Engine B shadow executions should have brokerAPICalled = false
              state.shadowExecutions.forEach((execution: { engine: string; brokerAPICalled: boolean }) => {
                if (execution.engine === 'B') {
                  expect(execution.brokerAPICalled).toBe(false);
                }
              });

              // No Engine B decisions should have live executions
              const engineBLiveExecutions = (state.liveExecutions as Array<{ engine: 'A' | 'B' }>).filter(
                e => e.engine === 'B'
              );
              expect(engineBLiveExecutions.length).toBe(0);

              // Shadow executions should track PnL
              state.shadowExecutions.forEach(execution => {
                expect(execution.simulatedPnL).toBeDefined();
                expect(typeof execution.simulatedPnL).toBe('number');
              });
            } finally {
              await orchestrator.teardownTest(context);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('14.3 Unit Tests: Shadow Execution Scenarios', () => {
    it('should track shadow PnL', async () => {
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
          session: 'RTH_OPEN',
          pattern: 'ORB_BREAKOUT',
          price: 450.00,
          volume: 1000000,
          timestamp: Date.now(),
          variant: 'B'
        });

        await orchestrator.injectWebhook(context, webhook);
        await new Promise(resolve => setTimeout(resolve, 150));

        const state = await orchestrator.captureState(context);

        // Shadow executions should have PnL tracking
        state.shadowExecutions.forEach((execution: { simulatedPnL: number }) => {
          expect(execution.simulatedPnL).toBeDefined();
          expect(typeof execution.simulatedPnL).toBe('number');
          
          // PnL should be reasonable (not NaN or Infinity)
          expect(isFinite(execution.simulatedPnL)).toBe(true);
        });
      } finally {
        await orchestrator.teardownTest(context);
      }
    });

    it('should preserve live state', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      try {
        // Capture initial state
        const initialState = await orchestrator.captureState(context);
        const initialLiveExecutions = initialState.liveExecutions.length;

        // Inject webhook that routes to Engine B
        const webhook = webhookGenerator.generateWebhook({
          symbol: 'SPY',
          timeframe: '5m',
          session: 'RTH_OPEN',
          pattern: 'ORB_BREAKOUT',
          price: 450.00,
          volume: 1000000,
          timestamp: Date.now(),
          variant: 'B'
        });

        await orchestrator.injectWebhook(context, webhook);
        await new Promise(resolve => setTimeout(resolve, 150));

        const finalState = await orchestrator.captureState(context);

        // Live executions should only come from Engine A
        const engineBLiveExecutions = (finalState.liveExecutions as Array<{ engine: 'A' | 'B' }>).filter(
          e => e.engine === 'B'
        );

        expect(engineBLiveExecutions.length).toBe(0);

        // Any new live executions should be from Engine A only
        const newLiveExecutions = finalState.liveExecutions.slice(initialLiveExecutions);
        newLiveExecutions.forEach((execution: { engine: string }) => {
          expect(execution.engine).toBe('A');
        });
      } finally {
        await orchestrator.teardownTest(context);
      }
    });

    it('should prevent broker API calls', async () => {
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
          session: 'RTH_OPEN',
          pattern: 'ORB_BREAKOUT',
          price: 450.00,
          volume: 1000000,
          timestamp: Date.now(),
          variant: 'B'
        });

        await orchestrator.injectWebhook(context, webhook);
        await new Promise(resolve => setTimeout(resolve, 150));

        const state = await orchestrator.captureState(context);

        // All shadow executions should have brokerAPICalled = false
        state.shadowExecutions.forEach((execution: { brokerAPICalled: boolean }) => {
          expect(execution.brokerAPICalled).toBe(false);
        });

        // Verify no broker API calls in logs
        const brokerAPILogs = state.logs.filter(
          log => log.message.toLowerCase().includes('broker') &&
                 log.message.toLowerCase().includes('api') &&
                 log.variant === 'B'
        );

        // If there are broker API logs for Engine B, they should indicate no actual call
        brokerAPILogs.forEach((log: { message: string }) => {
          expect(
            log.message.toLowerCase().includes('shadow') ||
            log.message.toLowerCase().includes('simulated') ||
            log.message.toLowerCase().includes('not called')
          ).toBe(true);
        });
      } finally {
        await orchestrator.teardownTest(context);
      }
    });

    it('should log shadow execution', async () => {
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
          session: 'RTH_OPEN',
          pattern: 'ORB_BREAKOUT',
          price: 450.00,
          volume: 1000000,
          timestamp: Date.now(),
          variant: 'B'
        });

        await orchestrator.injectWebhook(context, webhook);
        await new Promise(resolve => setTimeout(resolve, 150));

        const state = await orchestrator.captureState(context);

        // Should have logs for Engine B
        const engineBLogs = state.logs.filter(log => log.executionLabel === 'SHADOW');

        if (state.engineBDecisions.length > 0) {
          expect(engineBLogs.length).toBeGreaterThan(0);

          // Logs should indicate shadow execution
          const shadowLogs = engineBLogs.filter(
            log => log.executionLabel === 'SHADOW'
          );

          expect(shadowLogs.length).toBeGreaterThan(0);
        }
      } finally {
        await orchestrator.teardownTest(context);
      }
    });

    it('should handle multiple shadow executions', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      try {
        // Inject multiple webhooks
        const webhooks = Array(5).fill(null).map((_, i) =>
          webhookGenerator.generateWebhook({
            symbol: 'SPY',
            timeframe: '5m',
            session: 'RTH_OPEN',
            pattern: 'ORB_BREAKOUT',
            price: 450.00,
            volume: 1000000,
            timestamp: Date.now() + i
          })
        );

        for (const webhook of webhooks) {
          await orchestrator.injectWebhook(context, webhook);
        }

        await new Promise(resolve => setTimeout(resolve, 200));

        const state = await orchestrator.captureState(context);

        // All shadow executions should be isolated
        state.shadowExecutions.forEach((execution: { brokerAPICalled: boolean; simulatedPnL: number }) => {
          expect(execution.brokerAPICalled).toBe(false);
          expect(execution.simulatedPnL).toBeDefined();
        });

        // No Engine B live executions
        const engineBLiveExecutions = (state.liveExecutions as Array<{ engine: 'A' | 'B' }>).filter(
          e => e.engine === 'B'
        );

        expect(engineBLiveExecutions.length).toBe(0);
      } finally {
        await orchestrator.teardownTest(context);
      }
    });

    it('should maintain shadow execution consistency', async () => {
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
          session: 'RTH_OPEN',
          pattern: 'ORB_BREAKOUT',
          price: 450.00,
          volume: 1000000,
          timestamp: Date.now()
        });

        await orchestrator.injectWebhook(context, webhook);
        await new Promise(resolve => setTimeout(resolve, 150));

        const state = await orchestrator.captureState(context);

        // Each Engine B decision should have corresponding shadow execution
        state.engineBDecisions.forEach((decision: { action: string; signalId: string }) => {
          if (decision.action !== 'HOLD') {
            const shadowExecution = state.shadowExecutions.find(
              (e: { signalId: string }) => e.signalId === decision.signalId
            );

            expect(shadowExecution).toBeDefined();
            if (shadowExecution) {
              expect(shadowExecution.engine).toBe('B');
              expect(shadowExecution.brokerAPICalled).toBe(false);
            }
          }
        });
      } finally {
        await orchestrator.teardownTest(context);
      }
    });
  });
});
