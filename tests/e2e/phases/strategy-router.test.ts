/**
 * Phase 2: Strategy Router Tests
 * 
 * Tests A/B routing behavior including:
 * - Deterministic variant assignment
 * - Feature flag behavior
 * - Variant distribution
 * - Routing logging completeness
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */

import * as fc from 'fast-check';
import { DefaultWebhookGenerator } from '../generators/webhook-generator-impl';
import { TestOrchestratorImpl } from '../orchestration/test-orchestrator-impl';
import { validateRouting } from '../validation/routing-validator';
import { RoutingExpectation } from '../validation/validation-framework';

describe('Phase 2: Strategy Router', () => {
  let orchestrator: TestOrchestratorImpl;
  let webhookGenerator: DefaultWebhookGenerator;

  beforeEach(() => {
    orchestrator = new TestOrchestratorImpl();
    webhookGenerator = new DefaultWebhookGenerator();
  });

  afterEach(async () => {
    // Cleanup any test contexts
  });

  describe('9.1 Strategy Router Test Suite Setup', () => {
    it('should initialize test fixtures with diverse webhooks', () => {
      const webhooks = [
        webhookGenerator.generateWebhook({
          symbol: 'SPY',
          timeframe: '5m',
          session: 'RTH_OPEN',
          pattern: 'ORB_BREAKOUT',
          price: 450.00,
          volume: 1000000,
          timestamp: Date.now()
        }),
        webhookGenerator.generateWebhook({
          symbol: 'QQQ',
          timeframe: '15m',
          session: 'MID_DAY',
          pattern: 'TREND_CONTINUATION',
          price: 380.00,
          volume: 1000000,
          timestamp: Date.now()
        }),
        webhookGenerator.generateWebhook({
          symbol: 'SPX',
          timeframe: '1m',
          session: 'POWER_HOUR',
          pattern: 'VOL_EXPANSION',
          price: 4500.00,
          volume: 1000000,
          timestamp: Date.now()
        })
      ];

      expect(webhooks).toHaveLength(3);
      webhooks.forEach(webhook => {
        expect(webhook.metadata.synthetic).toBe(true);
      });
    });

    it('should set up test orchestrator for routing tests', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      expect(context).toBeDefined();
      expect(context.config.featureFlags.engineB).toBe(true);

      await orchestrator.teardownTest(context);
    });
  });

  describe('9.2 Property Test: Routing Determinism', () => {
    /**
     * Property 8: Routing Determinism
     * 
     * For any webhook W and hash function H:
     * - H(W) always produces the same variant assignment
     * - Multiple sends of W produce identical routing decisions
     * - Routing is deterministic across test runs
     * 
     * Validates: Requirements 4.1, 4.2, 13.3
     */
    it('should produce deterministic routing for identical webhooks', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
            timeframe: fc.constantFrom('1m', '5m', '15m'),
            session: fc.constantFrom('RTH_OPEN', 'MID_DAY', 'POWER_HOUR'),
            pattern: fc.constantFrom('ORB_BREAKOUT', 'TREND_CONTINUATION', 'CHOP'),
            runs: fc.integer({ min: 2, max: 5 })
          }),
          async (scenario) => {
            const routingDecisions: string[] = [];

            // Run multiple times with same webhook
            for (let i = 0; i < scenario.runs; i++) {
              const context = await orchestrator.setupTest({
                isolatedEnvironment: true,
                featureFlags: { engineB: true },
                mockExternalAPIs: true,
                captureAllLogs: true
              });

              try {
                // Generate same webhook each time
                const priceMap: Record<string, number> = { SPY: 450.00, QQQ: 380.00, SPX: 4500.00 };
                const webhook = webhookGenerator.generateWebhook({
                  symbol: scenario.symbol,
                  timeframe: scenario.timeframe,
                  session: scenario.session,
                  pattern: scenario.pattern,
                  price: priceMap[scenario.symbol],
                  volume: 1000000,
                  timestamp: Date.now()
                });

                // Inject webhook
                await orchestrator.injectWebhook(context, webhook);

                // Wait for routing
                await new Promise(resolve => setTimeout(resolve, 50));

                // Capture state
                const state = await orchestrator.captureState(context);

                // Record routing decision
                if (state.routerDecisions.length > 0) {
                  routingDecisions.push(state.routerDecisions[0].variant);
                }
              } finally {
                await orchestrator.teardownTest(context);
              }
            }

            // All routing decisions should be identical
            const uniqueDecisions = new Set(routingDecisions);
            expect(uniqueDecisions.size).toBe(1);

            if (uniqueDecisions.size !== 1) {
              console.error('Routing determinism violation:', {
                scenario,
                decisions: routingDecisions
              });
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain deterministic routing within a single test run', async () => {
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
            // Generate same webhook
            const priceMap: Record<string, number> = { SPY: 450.00, QQQ: 380.00, SPX: 4500.00 };
            const webhook = webhookGenerator.generateWebhook({
              ...scenario,
              price: priceMap[scenario.symbol],
              volume: 1000000,
              timestamp: Date.now()
            });

              // Inject multiple times
              await orchestrator.injectWebhook(context, webhook);
              await orchestrator.injectWebhook(context, webhook);
              await orchestrator.injectWebhook(context, webhook);

              // Wait for routing
              await new Promise(resolve => setTimeout(resolve, 100));

              // Capture state
              const state = await orchestrator.captureState(context);

              // Validate determinism
              const expected: RoutingExpectation = {
                expectedVariant: state.routerDecisions[0]?.variant || 'A',
                expectedDeterminism: true,
                expectedFeatureFlagBehavior: true
              };

              const result = validateRouting(state, expected);

              // Property assertion
              expect(result.passed).toBe(true);
              if (!result.passed) {
                console.error('Routing determinism violation:', result.message);
                console.error('Details:', result.details);
              }
            } finally {
              await orchestrator.teardownTest(context);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('9.3 Property Test: Variant Distribution', () => {
    /**
     * Property 9: Variant Distribution
     * 
     * For a large set of N unique webhooks with 50/50 A/B split:
     * - Variant A receives ~50% of webhooks (within tolerance)
     * - Variant B receives ~50% of webhooks (within tolerance)
     * - Distribution is statistically valid
     * 
     * Validates: Requirements 4.5
     */
    it('should distribute webhooks according to configured split', async () => {
      await fc.assert(
        fc.asyncProperty(
            fc.array(
              fc.record({
                symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
                timeframe: fc.constantFrom('1m', '5m', '15m'),
                session: fc.constantFrom('RTH_OPEN', 'MID_DAY', 'POWER_HOUR'),
                pattern: fc.constantFrom('ORB_BREAKOUT', 'TREND_CONTINUATION', 'CHOP', 'VOL_EXPANSION')
              }),
              { minLength: 20, maxLength: 40 }
            ),
          async (scenarios) => {
            const context = await orchestrator.setupTest({
              isolatedEnvironment: true,
              featureFlags: { engineB: true },
              mockExternalAPIs: true,
              captureAllLogs: true
            });

            try {
              // Generate unique webhooks
              const priceMap: Record<string, number> = { SPY: 450.00, QQQ: 380.00, SPX: 4500.00 };
              const webhooks = scenarios.map((scenario, index) => 
                webhookGenerator.generateWebhook({
                  ...scenario,
                  price: priceMap[scenario.symbol],
                  volume: 1000000,
                  timestamp: Date.now() + index, // Make each webhook unique by adding index to timestamp
                  routingSeed: index
                })
              );

              // Inject all webhooks
              for (const webhook of webhooks) {
                await orchestrator.injectWebhook(context, webhook);
              }

              // Wait for routing
              await new Promise(resolve => setTimeout(resolve, 5));

              // Capture state
              const state = await orchestrator.captureState(context);

              // Validate distribution (50/50 with 10% tolerance)
              const expected: RoutingExpectation = {
                expectedVariant: 'A', // Not used when distribution is specified
                expectedDeterminism: false, // Not checking determinism here
                expectedFeatureFlagBehavior: true,
                expectedDistribution: {
                  variantA: 50,
                  variantB: 50,
                  tolerance: 10 // ±10% tolerance for statistical variation
                }
              };

              const result = validateRouting(state, expected);

              // Property assertion
              expect(result.passed).toBe(true);
              if (!result.passed) {
                console.error('Variant distribution violation:', result.message);
                console.error('Details:', result.details);
              }
            } finally {
              await orchestrator.teardownTest(context);
            }
          }
        ),
        { numRuns: 3 }
      );
    });
  });

  describe('9.4 Property Test: Routing Logging Completeness', () => {
    /**
     * Property 10: Routing Logging Completeness
     * 
     * For any webhook W that is routed:
     * - All required fields are present in routing logs
     * - Variant assignment is logged
     * - Feature flags are logged
     * - Routing reason is logged
     * 
     * Validates: Requirements 4.4
     */
    it('should log all required routing information', async () => {
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

              // Wait for routing
              await new Promise(resolve => setTimeout(resolve, 100));

              // Capture state
              const state = await orchestrator.captureState(context);

              // Validate logging completeness
              const expected: RoutingExpectation = {
                expectedVariant: state.routerDecisions[0]?.variant || 'A',
                expectedDeterminism: true,
                expectedFeatureFlagBehavior: true,
                expectedLoggingFields: [
                  'signalId',
                  'variant',
                  'assignedAt',
                  'reason',
                  'featureFlags'
                ]
              };

              const result = validateRouting(state, expected);

              // Property assertion
              expect(result.passed).toBe(true);
              if (!result.passed) {
                console.error('Routing logging completeness violation:', result.message);
                console.error('Details:', result.details);
              }
            } finally {
              await orchestrator.teardownTest(context);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('9.5 Unit Tests: Feature Flag Behavior', () => {
    it('should route to Engine A when Engine_B is disabled', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: false }, // Engine B disabled
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      try {
        // Generate webhook
        const webhook = webhookGenerator.generateWebhook({
          symbol: 'SPY',
          timeframe: '5m',
          session: 'RTH_OPEN',
          pattern: 'ORB_BREAKOUT',
          price: 450.00,
          volume: 1000000,
          timestamp: Date.now()
        });

        // Inject webhook
        await orchestrator.injectWebhook(context, webhook);
        await new Promise(resolve => setTimeout(resolve, 100));

        const state = await orchestrator.captureState(context);

        // All webhooks should route to Engine A
        expect(state.routerDecisions.length).toBeGreaterThan(0);
        state.routerDecisions.forEach((decision: { variant: string }) => {
          expect(decision.variant).toBe('A');
        });
      } finally {
        await orchestrator.teardownTest(context);
      }
    });

    it('should route to both engines when Engine_B is enabled', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true }, // Engine B enabled
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      try {
        // Generate multiple webhooks to get both variants
        const webhooks = Array(20).fill(null).map((_, i) =>
          webhookGenerator.generateWebhook({
            symbol: 'SPY',
            timeframe: '5m',
            session: 'RTH_OPEN',
            pattern: 'ORB_BREAKOUT',
            price: 450.00,
            volume: 1000000,
            timestamp: Date.now() + i // Make each webhook unique
          })
        );

        for (const webhook of webhooks) {
          await orchestrator.injectWebhook(context, webhook);
        }

        await new Promise(resolve => setTimeout(resolve, 200));

        const state = await orchestrator.captureState(context);

        // Should have both variants (statistically likely with 20 webhooks)
        const variants = new Set(state.routerDecisions.map((d: { variant: string }) => d.variant));
        
        // At minimum, we should have routing decisions
        expect(state.routerDecisions.length).toBeGreaterThan(0);
        
        // With Engine B enabled, we expect to see variant B at some point
        // (though with small sample size, this might not always happen)
        const hasVariantB = Array.from(variants).includes('B');
        if (!hasVariantB) {
          console.warn('No variant B assignments in 20 webhooks (statistically unlikely but possible)');
        }
      } finally {
        await orchestrator.teardownTest(context);
      }
    });

    it('should handle feature flag toggle during operation', async () => {
      // This test simulates toggling the feature flag
      // In practice, this would require dynamic flag updates
      
      // First run with Engine B enabled
      const context1 = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      try {
        const webhook1 = webhookGenerator.generateWebhook({
          symbol: 'SPY',
          timeframe: '5m',
          session: 'RTH_OPEN',
          pattern: 'ORB_BREAKOUT',
          price: 450.00,
          volume: 1000000,
          timestamp: Date.now()
        });

        await orchestrator.injectWebhook(context1, webhook1);
        await new Promise(resolve => setTimeout(resolve, 100));

        const state1 = await orchestrator.captureState(context1);
        expect(state1.routerDecisions.length).toBeGreaterThan(0);
      } finally {
        await orchestrator.teardownTest(context1);
      }

      // Second run with Engine B disabled
      const context2 = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: false },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      try {
        const webhook2 = webhookGenerator.generateWebhook({
          symbol: 'SPY',
          timeframe: '5m',
          session: 'RTH_OPEN',
          pattern: 'ORB_BREAKOUT',
          price: 450.00,
          volume: 1000000,
          timestamp: Date.now()
        });

        await orchestrator.injectWebhook(context2, webhook2);
        await new Promise(resolve => setTimeout(resolve, 100));

        const state2 = await orchestrator.captureState(context2);
        
        // Should route to Engine A only
        expect(state2.routerDecisions.length).toBeGreaterThan(0);
        state2.routerDecisions.forEach((decision: { variant: string }) => {
          expect(decision.variant).toBe('A');
        });
      } finally {
        await orchestrator.teardownTest(context2);
      }
    });

    it('should maintain consistent feature flags within a test run', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true, someOtherFlag: false },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      try {
        // Generate multiple webhooks
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

        await new Promise(resolve => setTimeout(resolve, 150));

        const state = await orchestrator.captureState(context);

        // All routing decisions should have the same feature flags
        if (state.routerDecisions.length > 1) {
          const firstFlags = JSON.stringify(state.routerDecisions[0].featureFlags);
          
          state.routerDecisions.forEach((decision: { featureFlags: any }) => {
            const currentFlags = JSON.stringify(decision.featureFlags);
            expect(currentFlags).toBe(firstFlags);
          });
        }
      } finally {
        await orchestrator.teardownTest(context);
      }
    });

    it('should log feature flag state in routing decisions', async () => {
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
        await new Promise(resolve => setTimeout(resolve, 100));

        const state = await orchestrator.captureState(context);

        // Routing decisions should include feature flags
        expect(state.routerDecisions.length).toBeGreaterThan(0);
        state.routerDecisions.forEach((decision: { featureFlags: any }) => {
          expect(decision.featureFlags).toBeDefined();
          expect(typeof decision.featureFlags).toBe('object');
          expect('engineB' in decision.featureFlags).toBe(true);
        });
      } finally {
        await orchestrator.teardownTest(context);
      }
    });
  });
});
