/**
 * Phase 11: Determinism and Replay Tests
 * 
 * Tests deterministic behavior and replay functionality including:
 * - Engine A produces identical outputs for identical inputs
 * - Engine B produces identical outputs for identical inputs
 * - Strategy Router produces identical variant assignments
 * - Specialist agent activations are identical across runs
 * - Test replay produces identical results
 * 
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5
 */

import * as fc from 'fast-check';
import { DefaultWebhookGenerator } from '../generators/webhook-generator-impl';
import { DefaultGEXGenerator } from '../generators/gex-generator-impl';
import { TestOrchestratorImpl } from '../orchestration/test-orchestrator-impl';
import { validateDeterminism } from '../validation/determinism-validator';
import { SystemState } from '../orchestration/test-orchestrator';

describe('Phase 11: Determinism and Replay', () => {
  let orchestrator: TestOrchestratorImpl;
  let webhookGenerator: DefaultWebhookGenerator;
  let gexGenerator: DefaultGEXGenerator;

  beforeEach(() => {
    orchestrator = new TestOrchestratorImpl();
    webhookGenerator = new DefaultWebhookGenerator();
    gexGenerator = new DefaultGEXGenerator();
  });

  afterEach(async () => {
    // Cleanup any test contexts
  });

  describe('21.1 Determinism Test Suite Setup', () => {
    it('should set up test orchestrator for multi-run tests', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      expect(context).toBeDefined();
      expect(context.testId).toBeDefined();

      await orchestrator.teardownTest(context);
    });

    it('should set up replay test infrastructure', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      try {
        // Generate and inject test data
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
        await new Promise(resolve => setTimeout(resolve, 100));

        // Capture state for replay
        const state = await orchestrator.captureState(context);
        expect(state).toBeDefined();
        expect(context.injectedData.length).toBeGreaterThan(0);

        // Verify replay capability
        await orchestrator.replayTest(context);
        const replayState = await orchestrator.captureState(context);
        expect(replayState).toBeDefined();
      } finally {
        await orchestrator.teardownTest(context);
      }
    });
  });

  describe('21.2 Property Test: Engine A Determinism', () => {
    /**
     * Property 25: Engine A Determinism
     * 
     * For any synthetic data, running Engine_A multiple times with identical inputs 
     * and system state should produce identical decisions across all runs (same action, 
     * confidence, reasoning, timing).
     * 
     * Validates: Requirements 13.1
     */
    it('should produce identical Engine A decisions across multiple runs', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
            timeframe: fc.constantFrom('1m', '5m', '15m'),
            pattern: fc.constantFrom('ORB_BREAKOUT', 'TREND_CONTINUATION', 'CHOP')
          }),
          async (scenario) => {
            const states: SystemState[] = [];
            const numRuns = 3;

            // Run the same test multiple times
            for (let run = 0; run < numRuns; run++) {
              const context = await orchestrator.setupTest({
                isolatedEnvironment: true,
                featureFlags: { engineB: false }, // Engine A only
                mockExternalAPIs: true,
                captureAllLogs: true
              });

              try {
                // Generate identical webhook for each run
                const priceMap = { SPY: 450.00, QQQ: 380.00, SPX: 4500.00 };
                const webhook = webhookGenerator.generateWebhook({
                  symbol: scenario.symbol as 'SPY' | 'QQQ' | 'SPX',
                  timeframe: scenario.timeframe as '1m' | '5m' | '15m',
                  session: 'RTH_OPEN',
                  pattern: scenario.pattern as any,
                  price: priceMap[scenario.symbol as keyof typeof priceMap],
                  volume: 1000000,
                  timestamp: 1700000000000 // Fixed timestamp for determinism
                });

                await orchestrator.injectWebhook(context, webhook);
                await new Promise(resolve => setTimeout(resolve, 150));

                const state = await orchestrator.captureState(context);
                states.push(state);
              } finally {
                await orchestrator.teardownTest(context);
              }
            }

            // Validate determinism across all runs
            const result = validateDeterminism(states);

            expect(result.passed).toBe(true);
            if (!result.passed) {
              console.error('Engine A determinism violation:', result.message);
              console.error('Details:', result.details);
            }

            // Additional checks for Engine A decisions
            if (states.length >= 2 && states[0].engineADecisions.length > 0) {
              for (let i = 1; i < states.length; i++) {
                expect(states[i].engineADecisions.length).toBe(states[0].engineADecisions.length);
                
                for (let j = 0; j < states[0].engineADecisions.length; j++) {
                  const decision0 = states[0].engineADecisions[j];
                  const decisionI = states[i].engineADecisions[j];
                  
                  expect(decisionI.action).toBe(decision0.action);
                  expect(decisionI.confidence).toBeCloseTo(decision0.confidence, 5);
                  expect(decisionI.reasoning).toBe(decision0.reasoning);
                }
              }
            }
          }
        ),
        { numRuns: 50, seed: 130 }
      );
    });
  });

  describe('21.3 Property Test: Engine B Determinism', () => {
    /**
     * Property 26: Engine B Determinism
     * 
     * For any synthetic data, running Engine_B multiple times with identical inputs 
     * and system state should produce identical decisions across all runs (same agent 
     * activations, same confidence adjustments, same final decision).
     * 
     * Validates: Requirements 13.2, 13.4
     */
    it('should produce identical Engine B decisions across multiple runs', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
            timeframe: fc.constantFrom('1m', '5m', '15m'),
            pattern: fc.constantFrom('ORB_BREAKOUT', 'TREND_CONTINUATION', 'VOL_EXPANSION')
          }),
          async (scenario) => {
            const states: SystemState[] = [];
            const numRuns = 3;

            // Run the same test multiple times
            for (let run = 0; run < numRuns; run++) {
              const context = await orchestrator.setupTest({
                isolatedEnvironment: true,
                featureFlags: { engineB: true },
                mockExternalAPIs: true,
                captureAllLogs: true
              });

              try {
                // Generate identical webhook and GEX data for each run
                const priceMap = { SPY: 450.00, QQQ: 380.00, SPX: 4500.00 };
                const spotPrice = priceMap[scenario.symbol as keyof typeof priceMap];
                
                const gexData = gexGenerator.generateGEX({
                  type: 'POSITIVE',
                  symbol: scenario.symbol,
                  spotPrice: spotPrice
                });

                const webhook = webhookGenerator.generateWebhook({
                  symbol: scenario.symbol as 'SPY' | 'QQQ' | 'SPX',
                  timeframe: scenario.timeframe as '1m' | '5m' | '15m',
                  session: 'RTH_OPEN',
                  pattern: scenario.pattern as any,
                  price: spotPrice,
                  volume: 1000000,
                  timestamp: 1700000000000 // Fixed timestamp
                });

                await orchestrator.injectGEX(context, gexData);
                await orchestrator.injectWebhook(context, webhook);
                await new Promise(resolve => setTimeout(resolve, 150));

                const state = await orchestrator.captureState(context);
                states.push(state);
              } finally {
                await orchestrator.teardownTest(context);
              }
            }

            // Validate determinism across all runs
            const result = validateDeterminism(states);

            expect(result.passed).toBe(true);
            if (!result.passed) {
              console.error('Engine B determinism violation:', result.message);
              console.error('Details:', result.details);
            }

            // Additional checks for Engine B decisions and agent activations
            if (states.length >= 2 && states[0].engineBDecisions.length > 0) {
              for (let i = 1; i < states.length; i++) {
                // Check decision count
                expect(states[i].engineBDecisions.length).toBe(states[0].engineBDecisions.length);
                
                // Check agent activation count
                expect(states[i].agentActivations.length).toBe(states[0].agentActivations.length);
                
                // Check decisions match
                for (let j = 0; j < states[0].engineBDecisions.length; j++) {
                  const decision0 = states[0].engineBDecisions[j];
                  const decisionI = states[i].engineBDecisions[j];
                  
                  expect(decisionI.action).toBe(decision0.action);
                  expect(decisionI.confidence).toBeCloseTo(decision0.confidence, 5);
                }
                
                // Check agent activations match
                for (let j = 0; j < states[0].agentActivations.length; j++) {
                  const activation0 = states[0].agentActivations[j];
                  const activationI = states[i].agentActivations[j];
                  
                  expect(activationI.agentName).toBe(activation0.agentName);
                  expect(activationI.activated).toBe(activation0.activated);
                }
              }
            }
          }
        ),
        { numRuns: 50, seed: 131 }
      );
    });
  });

  describe('21.4 Property Test: Test Replay Determinism', () => {
    /**
     * Property 27: Test Replay Determinism
     * 
     * For any captured test scenario, replaying it through the Test_System should 
     * produce identical system state, decisions, and outcomes as the original test run.
     * 
     * Validates: Requirements 13.5
     */
    it('should produce identical results when replaying captured test scenarios', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
            pattern: fc.constantFrom('ORB_BREAKOUT', 'TREND_CONTINUATION', 'CHOP')
          }),
          async (scenario) => {
            // Initial test run
            const context = await orchestrator.setupTest({
              isolatedEnvironment: true,
              featureFlags: { engineB: true },
              mockExternalAPIs: true,
              captureAllLogs: true
            });

            try {
              // Generate test data
              const priceMap = { SPY: 450.00, QQQ: 380.00, SPX: 4500.00 };
              const webhook = webhookGenerator.generateWebhook({
                symbol: scenario.symbol as 'SPY' | 'QQQ' | 'SPX',
                timeframe: '5m',
                session: 'RTH_OPEN',
                pattern: scenario.pattern as any,
                price: priceMap[scenario.symbol as keyof typeof priceMap],
                volume: 1000000,
                timestamp: 1700000000000
              });

              await orchestrator.injectWebhook(context, webhook);
              await new Promise(resolve => setTimeout(resolve, 150));

              // Capture original state
              const originalState = await orchestrator.captureState(context);

              // Replay the test
              await orchestrator.replayTest(context);
              await new Promise(resolve => setTimeout(resolve, 150));

              // Capture replay state
              const replayState = await orchestrator.captureState(context);

              // Validate replay determinism
              const result = validateDeterminism([originalState, replayState]);

              expect(result.passed).toBe(true);
              if (!result.passed) {
                console.error('Replay determinism violation:', result.message);
                console.error('Details:', result.details);
              }

              // Additional checks
              expect(replayState.webhookProcessingCount).toBe(originalState.webhookProcessingCount);
              expect(replayState.engineADecisions.length).toBe(originalState.engineADecisions.length);
              expect(replayState.engineBDecisions.length).toBe(originalState.engineBDecisions.length);
            } finally {
              await orchestrator.teardownTest(context);
            }
          }
        ),
        { numRuns: 50, seed: 132 }
      );
    });
  });

  describe('21.5 Unit Tests: Determinism Scenarios', () => {
    it('should produce identical results across multiple runs with identical inputs', async () => {
      const states: SystemState[] = [];
      const numRuns = 3;

      for (let run = 0; run < numRuns; run++) {
        const context = await orchestrator.setupTest({
          isolatedEnvironment: true,
          featureFlags: { engineB: true },
          mockExternalAPIs: true,
          captureAllLogs: true
        });

        try {
          // Use fixed seed and parameters
          const webhook = webhookGenerator.generateWebhook({
            symbol: 'SPY',
            timeframe: '5m',
            session: 'RTH_OPEN',
            pattern: 'ORB_BREAKOUT',
            price: 450.00,
            volume: 1000000,
            timestamp: 1700000000000
          });

          await orchestrator.injectWebhook(context, webhook);
          await new Promise(resolve => setTimeout(resolve, 150));

          const state = await orchestrator.captureState(context);
          states.push(state);
        } finally {
          await orchestrator.teardownTest(context);
        }
      }

      // Verify all states are identical
      expect(states.length).toBe(numRuns);
      
      for (let i = 1; i < states.length; i++) {
        expect(states[i].webhookProcessingCount).toBe(states[0].webhookProcessingCount);
        expect(states[i].enrichmentCallCount).toBe(states[0].enrichmentCallCount);
        expect(states[i].routerDecisions.length).toBe(states[0].routerDecisions.length);
      }
    });

    it('should support replay functionality for debugging', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      try {
        // Initial run
        const webhook = webhookGenerator.generateWebhook({
          symbol: 'QQQ',
          timeframe: '15m',
          session: 'MID_DAY',
          pattern: 'TREND_CONTINUATION',
          price: 380.00,
          volume: 500000,
          timestamp: 1700000000000
        });

        await orchestrator.injectWebhook(context, webhook);
        await new Promise(resolve => setTimeout(resolve, 150));

        const originalState = await orchestrator.captureState(context);

        // Replay
        await orchestrator.replayTest(context);
        await new Promise(resolve => setTimeout(resolve, 150));

        const replayState = await orchestrator.captureState(context);

        // Verify replay matches original
        expect(replayState.webhookProcessingCount).toBe(originalState.webhookProcessingCount);
        expect(replayState.routerDecisions.length).toBe(originalState.routerDecisions.length);
      } finally {
        await orchestrator.teardownTest(context);
      }
    });

    it('should use fixed seeds for reproducibility', async () => {
      // This test verifies that using the same seed produces the same results
      const seed = 12345;
      const states: SystemState[] = [];

      for (let run = 0; run < 2; run++) {
        const context = await orchestrator.setupTest({
          isolatedEnvironment: true,
          featureFlags: { engineB: true },
          mockExternalAPIs: true,
          captureAllLogs: true,
          seed: seed // Use same seed
        });

        try {
          const webhook = webhookGenerator.generateWebhook({
            symbol: 'SPX',
            timeframe: '1m',
            session: 'POWER_HOUR',
            pattern: 'VOL_EXPANSION',
            price: 4500.00,
            volume: 2000000,
            timestamp: 1700000000000
          });

          await orchestrator.injectWebhook(context, webhook);
          await new Promise(resolve => setTimeout(resolve, 150));

          const state = await orchestrator.captureState(context);
          states.push(state);
        } finally {
          await orchestrator.teardownTest(context);
        }
      }

      // Verify determinism with same seed
      expect(states.length).toBe(2);
      expect(states[1].webhookProcessingCount).toBe(states[0].webhookProcessingCount);
    });
  });
});
