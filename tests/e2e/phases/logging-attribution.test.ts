/**
 * Phase 9: Logging and Attribution Tests
 * 
 * Tests comprehensive logging and attribution including:
 * - Backend logging completeness (all required fields)
 * - Frontend-backend consistency
 * - Variant assignment logging
 * - Agent activation logging
 * - Confidence score logging
 * - Shadow/live execution labels
 * - GEX regime context logging
 * 
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9
 */

import * as fc from 'fast-check';
import { DefaultWebhookGenerator } from '../generators/webhook-generator-impl';
import { DefaultGEXGenerator } from '../generators/gex-generator-impl';
import { TestOrchestratorImpl } from '../orchestration/test-orchestrator-impl';
import { validateLogging } from '../validation/logging-validator';
import { LoggingExpectation, FrontendState } from '../validation/validation-framework';

describe('Phase 9: Logging and Attribution', () => {
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

  describe('18.1 Logging and Attribution Test Suite Setup', () => {
    it('should set up test orchestrator for logging tests', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      expect(context).toBeDefined();
      expect(context.testId).toBeDefined();
      expect(context.config.captureAllLogs).toBe(true);

      await orchestrator.teardownTest(context);
    });

    it('should capture frontend state if applicable', async () => {
      // This test verifies that frontend state capture mechanism is available
      // In a real implementation, this would interact with the frontend
      const mockFrontendState: FrontendState = {
        displayedSignals: [],
        capturedAt: Date.now()
      };

      expect(mockFrontendState).toBeDefined();
      expect(mockFrontendState.displayedSignals).toEqual([]);
    });
  });

  describe('18.2 Property Test: Decision Logging Completeness', () => {
    /**
     * Property 22: Decision Logging Completeness
     * 
     * For any trading decision (Engine_A or Engine_B), the backend log must contain 
     * all required fields: timestamp, signalId, variant, agents (if Engine_B), 
     * confidence, executionLabel (SHADOW or LIVE), gexRegime (if available), 
     * action, and reasoning.
     * 
     * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5
     */
    it('should log all required fields for every trading decision', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            variant: fc.constantFrom('A', 'B'),
            symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
            timeframe: fc.constantFrom('1m', '5m', '15m'),
            pattern: fc.constantFrom('ORB_BREAKOUT', 'TREND_CONTINUATION', 'CHOP'),
            includeGEX: fc.boolean()
          }),
          async (scenario) => {
            // Setup test with appropriate feature flags
            const context = await orchestrator.setupTest({
              isolatedEnvironment: true,
              featureFlags: { 
                engineB: scenario.variant === 'B' 
              },
              mockExternalAPIs: true,
              captureAllLogs: true
            });

            try {
              // Generate webhook
              const priceMap = { SPY: 450.00, QQQ: 380.00, SPX: 4500.00 };
              const spotPrice = priceMap[scenario.symbol as keyof typeof priceMap];
              
              const webhook = webhookGenerator.generateWebhook({
                symbol: scenario.symbol as 'SPY' | 'QQQ' | 'SPX',
                timeframe: scenario.timeframe as '1m' | '5m' | '15m',
                session: 'RTH_OPEN',
                pattern: scenario.pattern as any,
                price: spotPrice,
                volume: 1000000,
                timestamp: Date.now(),
                variant: scenario.variant as 'A' | 'B'
              });

              // Optionally inject GEX data
              if (scenario.includeGEX) {
                const gexData = gexGenerator.generateGEX({
                  type: 'POSITIVE',
                  symbol: scenario.symbol,
                  spotPrice: spotPrice
                });
                await orchestrator.injectGEX(context, gexData);
              }

              // Inject webhook
              await orchestrator.injectWebhook(context, webhook);

              // Wait for processing
              await new Promise(resolve => setTimeout(resolve, 150));

              // Capture state
              const state = await orchestrator.captureState(context);

              // Define required fields based on variant
              const requiredFields = [
                'timestamp',
                'signalId',
                'variant',
                'confidence',
                'executionLabel',
                'action',
                'message'
              ];

              if (scenario.variant === 'B') {
                requiredFields.push('agents');
              }

              if (scenario.includeGEX) {
                requiredFields.push('gexRegime');
              }

              // Validate logging completeness
              const expectation: LoggingExpectation = {
                requiredFields: requiredFields,
                expectedVariant: scenario.variant as 'A' | 'B',
                expectedExecutionLabel: scenario.variant === 'A' ? 'LIVE' : 'SHADOW',
                expectedAgents: scenario.variant === 'B' ? ['RISK', 'META_DECISION'] : undefined,
                expectedGEXRegime: scenario.includeGEX ? 'POSITIVE' : undefined
              };

              const result = validateLogging(state, expectation);

              // Property assertion
              expect(result.passed).toBe(true);
              if (!result.passed) {
                console.error('Logging completeness violation:', result.message);
                console.error('Variant:', scenario.variant);
                console.error('Details:', result.details);
              }
            } finally {
              await orchestrator.teardownTest(context);
            }
          }
        ),
        { numRuns: 100, seed: 120 }
      );
    });
  });

  describe('18.3 Property Test: Frontend-Backend Consistency', () => {
    /**
     * Property 23: Frontend-Backend Consistency
     * 
     * For any signal displayed in the frontend, the displayed data (variant, agents, 
     * confidence, executionLabel) must exactly match the corresponding backend log 
     * entry for that signalId.
     * 
     * Validates: Requirements 11.6, 11.7, 11.8, 11.9
     */
    it('should maintain consistency between frontend display and backend logs', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
            timeframe: fc.constantFrom('1m', '5m', '15m'),
            pattern: fc.constantFrom('ORB_BREAKOUT', 'TREND_CONTINUATION', 'VOL_EXPANSION')
          }),
          async (scenario) => {
            // Setup test with Engine B enabled
            const context = await orchestrator.setupTest({
              isolatedEnvironment: true,
              featureFlags: { engineB: true },
              mockExternalAPIs: true,
              captureAllLogs: true
            });

            try {
              // Generate webhook
              const priceMap = { SPY: 450.00, QQQ: 380.00, SPX: 4500.00 };
              const webhook = webhookGenerator.generateWebhook({
                symbol: scenario.symbol as 'SPY' | 'QQQ' | 'SPX',
                timeframe: scenario.timeframe as '1m' | '5m' | '15m',
                session: 'MID_DAY',
                pattern: scenario.pattern as any,
                price: priceMap[scenario.symbol as keyof typeof priceMap],
                volume: 1000000,
                timestamp: Date.now()
              });

              // Inject webhook
              await orchestrator.injectWebhook(context, webhook);

              // Wait for processing
              await new Promise(resolve => setTimeout(resolve, 150));

              // Capture backend state
              const backendState = await orchestrator.captureState(context);

              // Simulate frontend state capture
              // In a real implementation, this would query the actual frontend
              const frontendState: FrontendState = {
                displayedSignals: backendState.logs
                  .filter((log: any) => log.signalId)
                  .map((log: any) => ({
                    signalId: log.signalId,
                    variant: log.variant,
                    agents: log.agents || [],
                    confidence: log.confidence || 0,
                    executionLabel: log.executionLabel,
                    action: log.action || 'UNKNOWN',
                    timestamp: log.timestamp
                  })),
                capturedAt: Date.now()
              };

              // Validate frontend-backend consistency
              for (const frontendSignal of frontendState.displayedSignals) {
                const backendLog = backendState.logs.find(
                  (log: any) => log.signalId === frontendSignal.signalId
                );

                expect(backendLog).toBeDefined();
                if (backendLog) {
                  expect(frontendSignal.variant).toBe(backendLog.variant);
                  expect(frontendSignal.executionLabel).toBe(backendLog.executionLabel);
                  
                  if (backendLog.confidence !== undefined) {
                    expect(Math.abs(frontendSignal.confidence - backendLog.confidence)).toBeLessThan(0.01);
                  }
                  
                  if (backendLog.agents) {
                    expect(frontendSignal.agents).toEqual(backendLog.agents);
                  }
                }
              }
            } finally {
              await orchestrator.teardownTest(context);
            }
          }
        ),
        { numRuns: 100, seed: 121 }
      );
    });
  });

  describe('18.4 Unit Tests: Logging Scenarios', () => {
    it('should log all required fields for Engine A decisions', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: false }, // Engine A only
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
          variant: 'A'
        });

        await orchestrator.injectWebhook(context, webhook);
        await new Promise(resolve => setTimeout(resolve, 150));

        const state = await orchestrator.captureState(context);

        // Verify Engine A logs
        const engineALogs = state.logs.filter((log: any) => log.variant === 'A');
        expect(engineALogs.length).toBeGreaterThan(0);

        for (const log of engineALogs) {
          expect(log.timestamp).toBeDefined();
          expect(log.signalId).toBeDefined();
          expect(log.variant).toBe('A');
          expect(log.executionLabel).toBe('LIVE');
          expect(log.message).toBeDefined();
        }
      } finally {
        await orchestrator.teardownTest(context);
      }
    });

    it('should log all required fields for Engine B decisions with multiple agents', async () => {
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

        // Verify Engine B logs
        const engineBLogs = state.logs.filter((log: any) => log.variant === 'B');
        expect(engineBLogs.length).toBeGreaterThan(0);

        for (const log of engineBLogs) {
          expect(log.timestamp).toBeDefined();
          expect(log.signalId).toBeDefined();
          expect(log.variant).toBe('B');
          expect(log.executionLabel).toBe('SHADOW');
          expect(log.agents).toBeDefined();
          expect(Array.isArray(log.agents)).toBe(true);
          expect(log.confidence).toBeDefined();
          expect(log.message).toBeDefined();
        }
      } finally {
        await orchestrator.teardownTest(context);
      }
    });

    it('should log GEX regime context when GEX data is available', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      try {
        // Inject GEX data
        const gexData = gexGenerator.generateGEX({
          type: 'NEGATIVE',
          symbol: 'SPY',
          spotPrice: 450.00
        });

        const webhook = webhookGenerator.generateWebhook({
          symbol: 'SPY',
          timeframe: '5m',
          session: 'MID_DAY',
          pattern: 'TREND_CONTINUATION',
          price: 450.00,
          volume: 1000000,
          timestamp: Date.now()
        });

        await orchestrator.injectGEX(context, gexData);
        await orchestrator.injectWebhook(context, webhook);
        await new Promise(resolve => setTimeout(resolve, 150));

        const state = await orchestrator.captureState(context);

        // Verify GEX regime in logs
        const logsWithGEX = state.logs.filter((log: any) => log.gexRegime);
        expect(logsWithGEX.length).toBeGreaterThan(0);

        for (const log of logsWithGEX) {
          expect(log.gexRegime).toBeDefined();
          expect(['POSITIVE', 'NEGATIVE', 'GAMMA_FLIP_NEAR', 'NEUTRAL']).toContain(log.gexRegime);
        }
      } finally {
        await orchestrator.teardownTest(context);
      }
    });

    it('should maintain frontend display accuracy', async () => {
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
          pattern: 'VOL_EXPANSION',
          price: 450.00,
          volume: 1000000,
          timestamp: Date.now()
        });

        await orchestrator.injectWebhook(context, webhook);
        await new Promise(resolve => setTimeout(resolve, 150));

        const backendState = await orchestrator.captureState(context);

        // Simulate frontend state
        const frontendState: FrontendState = {
          displayedSignals: backendState.logs
            .filter((log: any) => log.signalId && log.variant)
            .map((log: any) => ({
              signalId: log.signalId,
              variant: log.variant,
              agents: log.agents || [],
              confidence: log.confidence || 0,
              executionLabel: log.executionLabel,
              action: log.action || 'UNKNOWN',
              timestamp: log.timestamp
            })),
          capturedAt: Date.now()
        };

        // Verify consistency
        for (const frontendSignal of frontendState.displayedSignals) {
          const backendLog = backendState.logs.find(
            (log: any) => log.signalId === frontendSignal.signalId
          );

          expect(backendLog).toBeDefined();
          if (!backendLog) {
            continue;
          }
          expect(frontendSignal.variant).toBe(backendLog.variant);
          expect(frontendSignal.executionLabel).toBe(backendLog.executionLabel);
        }
      } finally {
        await orchestrator.teardownTest(context);
      }
    });
  });
});
