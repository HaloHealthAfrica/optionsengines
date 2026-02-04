/**
 * Phase 8: GEX Regime Tests
 * 
 * Tests agent behavior under different GEX (Gamma Exposure) regimes including:
 * - Positive GEX regime (pinning behavior)
 * - Negative GEX regime (trending behavior)
 * - Gamma flip near price (increased caution)
 * - Neutral GEX regime (baseline confidence)
 * - GEX attribution logging
 * 
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 */

import * as fc from 'fast-check';
import { DefaultWebhookGenerator } from '../generators/webhook-generator-impl';
import { DefaultGEXGenerator } from '../generators/gex-generator-impl';
import { TestOrchestratorImpl } from '../orchestration/test-orchestrator-impl';
import { validateGEXRegime } from '../validation/logging-validator';
import { GEXRegimeExpectation } from '../validation/validation-framework';

describe('Phase 8: GEX Regime Tests', () => {
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

  describe('17.1 GEX Regime Test Suite Setup', () => {
    it('should initialize test fixtures with various GEX regimes', () => {
      // Positive GEX regime
      const positiveGEX = gexGenerator.generateGEX({
        type: 'POSITIVE',
        symbol: 'SPY',
        spotPrice: 450.00
      });

      expect(positiveGEX).toBeDefined();
      expect(positiveGEX.metadata.synthetic).toBe(true);
      expect(positiveGEX.data.total_gex).toBeGreaterThan(0);

      // Negative GEX regime
      const negativeGEX = gexGenerator.generateGEX({
        type: 'NEGATIVE',
        symbol: 'SPY',
        spotPrice: 450.00
      });

      expect(negativeGEX).toBeDefined();
      expect(negativeGEX.metadata.synthetic).toBe(true);
      expect(negativeGEX.data.total_gex).toBeLessThan(0);

      // Gamma flip near price
      const gammaFlipGEX = gexGenerator.generateGEX({
        type: 'GAMMA_FLIP_NEAR',
        symbol: 'SPY',
        spotPrice: 450.00,
        gammaFlipLevel: 451.00
      });

      expect(gammaFlipGEX).toBeDefined();
      expect(gammaFlipGEX.metadata.synthetic).toBe(true);
      expect(gammaFlipGEX.data.gamma_flip_level).toBeDefined();

      // Neutral GEX regime
      const neutralGEX = gexGenerator.generateGEX({
        type: 'NEUTRAL',
        symbol: 'SPY',
        spotPrice: 450.00
      });

      expect(neutralGEX).toBeDefined();
      expect(neutralGEX.metadata.synthetic).toBe(true);
      expect(Math.abs(neutralGEX.data.total_gex)).toBeLessThan(1000);
    });

    it('should set up test orchestrator for GEX tests', async () => {
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

  describe('17.2 Property Test: GEX Regime Sensitivity', () => {
    /**
     * Property 20: GEX Regime Sensitivity
     * 
     * For any Engine_B decision with GEX data, agent confidence adjustments must 
     * reflect the GEX regime:
     * - Positive GEX (pinning) adjusts for mean reversion
     * - Negative GEX (trending) adjusts for momentum
     * - Gamma flip near price increases caution
     * - Neutral GEX uses baseline confidence
     * 
     * Validates: Requirements 10.1, 10.2, 10.3, 10.4
     */
    it('should adjust agent behavior based on GEX regime', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            regimeType: fc.constantFrom('POSITIVE', 'NEGATIVE', 'GAMMA_FLIP_NEAR', 'NEUTRAL'),
            symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
            timeframe: fc.constantFrom('1m', '5m', '15m'),
            pattern: fc.constantFrom('ORB_BREAKOUT', 'TREND_CONTINUATION', 'VOL_EXPANSION')
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
              // Generate GEX data for the regime
              const priceMap: Record<string, number> = { SPY: 450.00, QQQ: 380.00, SPX: 4500.00 };
              const spotPrice = priceMap[scenario.symbol as keyof typeof priceMap];
              
              const gexData = gexGenerator.generateGEX({
                type: scenario.regimeType as 'POSITIVE' | 'NEGATIVE' | 'GAMMA_FLIP_NEAR' | 'NEUTRAL',
                symbol: scenario.symbol,
                spotPrice: spotPrice,
                gammaFlipLevel: scenario.regimeType === 'GAMMA_FLIP_NEAR' 
                  ? spotPrice + (spotPrice * 0.005) // Within 0.5%
                  : undefined
              });

              // Generate webhook
              const webhook = webhookGenerator.generateWebhook({
                symbol: scenario.symbol as 'SPY' | 'QQQ' | 'SPX',
                timeframe: scenario.timeframe as '1m' | '5m' | '15m',
                session: 'RTH_OPEN',
                pattern: scenario.pattern as any,
                price: spotPrice,
                volume: 1000000,
                timestamp: Date.now()
              });

              // Inject GEX data and webhook
              await orchestrator.injectGEX(context, gexData);
              await orchestrator.injectWebhook(context, webhook);

              // Wait for processing
              await new Promise(resolve => setTimeout(resolve, 150));

              // Capture state
              const state = await orchestrator.captureState(context);

              // Validate GEX regime sensitivity
              const expectation: GEXRegimeExpectation = {
                expectedRegime: scenario.regimeType as any,
                expectedConfidenceAdjustment: getExpectedConfidenceAdjustment(scenario.regimeType),
                expectedGEXAttribution: true
              };

              const result = validateGEXRegime(state, expectation);

              // Property assertion
              expect(result.passed).toBe(true);
              if (!result.passed) {
                console.error('GEX regime sensitivity violation:', result.message);
                console.error('Regime type:', scenario.regimeType);
                console.error('Details:', result.details);
              }
            } finally {
              await orchestrator.teardownTest(context);
            }
          }
        ),
        { numRuns: 100, seed: 110 }
      );
    });
  });

  describe('17.3 Property Test: GEX Attribution Logging', () => {
    /**
     * Property 21: GEX Attribution Logging
     * 
     * For any confidence adjustment based on GEX data, the log entry must include 
     * the GEX regime type and attribution showing which agent made the adjustment.
     * 
     * Validates: Requirements 10.5
     */
    it('should log GEX regime and attribution for confidence adjustments', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            regimeType: fc.constantFrom('POSITIVE', 'NEGATIVE', 'GAMMA_FLIP_NEAR', 'NEUTRAL'),
            symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
            pattern: fc.constantFrom('ORB_BREAKOUT', 'TREND_CONTINUATION', 'VOL_COMPRESSION')
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
              // Generate GEX data
              const priceMap: Record<string, number> = { SPY: 450.00, QQQ: 380.00, SPX: 4500.00 };
              const spotPrice = priceMap[scenario.symbol as keyof typeof priceMap];
              
              const gexData = gexGenerator.generateGEX({
                type: scenario.regimeType as 'POSITIVE' | 'NEGATIVE' | 'GAMMA_FLIP_NEAR' | 'NEUTRAL',
                symbol: scenario.symbol,
                spotPrice: spotPrice,
                gammaFlipLevel: scenario.regimeType === 'GAMMA_FLIP_NEAR' 
                  ? spotPrice + (spotPrice * 0.008)
                  : undefined
              });

              // Generate webhook
              const webhook = webhookGenerator.generateWebhook({
                symbol: scenario.symbol as 'SPY' | 'QQQ' | 'SPX',
                timeframe: '5m',
                session: 'MID_DAY',
                pattern: scenario.pattern as any,
                price: spotPrice,
                volume: 1000000,
                timestamp: Date.now()
              });

              // Inject data
              await orchestrator.injectGEX(context, gexData);
              await orchestrator.injectWebhook(context, webhook);

              // Wait for processing
              await new Promise(resolve => setTimeout(resolve, 150));

              // Capture state
              const state = await orchestrator.captureState(context);

              // Validate GEX attribution in logs
              const expectation: GEXRegimeExpectation = {
                expectedRegime: scenario.regimeType as any,
                expectedConfidenceAdjustment: getExpectedConfidenceAdjustment(scenario.regimeType),
                expectedGEXAttribution: true
              };

              const result = validateGEXRegime(state, expectation);

              // Property assertion: Logs must contain GEX regime and attribution
              expect(result.passed).toBe(true);
              if (!result.passed) {
                console.error('GEX attribution logging violation:', result.message);
                console.error('Details:', result.details);
              }

              // Additional check: Verify logs contain GEX regime
              const logsWithGEX = state.logs.filter((log: any) => 
                log.gexRegime !== undefined
              );
              expect(logsWithGEX.length).toBeGreaterThan(0);
            } finally {
              await orchestrator.teardownTest(context);
            }
          }
        ),
        { numRuns: 100, seed: 111 }
      );
    });
  });

  describe('17.4 Unit Tests: Specific GEX Scenarios', () => {
    it('should adjust for pinning behavior in positive GEX regime', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      try {
        // Generate positive GEX data
        const gexData = gexGenerator.generateGEX({
          type: 'POSITIVE',
          symbol: 'SPY',
          spotPrice: 450.00
        });

        // Generate breakout webhook (momentum play)
        const webhook = webhookGenerator.generateWebhook({
          symbol: 'SPY',
          timeframe: '5m',
          session: 'RTH_OPEN',
          pattern: 'ORB_BREAKOUT',
          price: 450.00,
          volume: 1000000,
          timestamp: Date.now()
        });

        await orchestrator.injectGEX(context, gexData);
        await orchestrator.injectWebhook(context, webhook);
        await new Promise(resolve => setTimeout(resolve, 150));

        const state = await orchestrator.captureState(context);

        // Verify positive GEX regime detected
        expect(gexData.data.total_gex).toBeGreaterThan(0);

        // Verify agents adjusted for pinning (mean reversion)
        // In positive GEX, breakouts may be less reliable due to pinning
        if (state.engineBDecisions.length > 0) {
          const decision = state.engineBDecisions[0];
          // Confidence should be adjusted for pinning behavior
          expect(decision.reasoning).toContain('GEX');
        }

        // Verify GEX regime logged
        const logsWithGEX = state.logs.filter((log: any) => 
          log.gexRegime === 'POSITIVE'
        );
        expect(logsWithGEX.length).toBeGreaterThan(0);
      } finally {
        await orchestrator.teardownTest(context);
      }
    });

    it('should adjust for trending behavior in negative GEX regime', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      try {
        // Generate negative GEX data
        const gexData = gexGenerator.generateGEX({
          type: 'NEGATIVE',
          symbol: 'SPY',
          spotPrice: 450.00
        });

        // Generate trend continuation webhook
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

        // Verify negative GEX regime detected
        expect(gexData.data.total_gex).toBeLessThan(0);

        // Verify agents adjusted for trending behavior
        // In negative GEX, trends may be more reliable
        if (state.engineBDecisions.length > 0) {
          const decision = state.engineBDecisions[0];
          // Confidence should be adjusted for trending behavior
          expect(decision.confidence).toBeGreaterThan(0.5);
        }

        // Verify GEX regime logged
        const logsWithGEX = state.logs.filter((log: any) => 
          log.gexRegime === 'NEGATIVE'
        );
        expect(logsWithGEX.length).toBeGreaterThan(0);
      } finally {
        await orchestrator.teardownTest(context);
      }
    });

    it('should increase caution when gamma flip is near price', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      try {
        const spotPrice = 450.00;
        const gammaFlipLevel = 450.50; // Very close to spot

        // Generate gamma flip near data
        const gexData = gexGenerator.generateGEX({
          type: 'GAMMA_FLIP_NEAR',
          symbol: 'SPY',
          spotPrice: spotPrice,
          gammaFlipLevel: gammaFlipLevel
        });

        // Generate webhook
        const webhook = webhookGenerator.generateWebhook({
          symbol: 'SPY',
          timeframe: '5m',
          session: 'POWER_HOUR',
          pattern: 'ORB_BREAKOUT',
          price: spotPrice,
          volume: 1000000,
          timestamp: Date.now()
        });

        await orchestrator.injectGEX(context, gexData);
        await orchestrator.injectWebhook(context, webhook);
        await new Promise(resolve => setTimeout(resolve, 150));

        const state = await orchestrator.captureState(context);

        // Verify gamma flip level is close to spot price
        expect(gexData.data.gamma_flip_level).toBeDefined();
        const distance = Math.abs(spotPrice - gexData.data.gamma_flip_level!);
        const percentDistance = (distance / spotPrice) * 100;
        expect(percentDistance).toBeLessThan(1); // Within 1%

        // Verify increased caution in decision
        if (state.engineBDecisions.length > 0) {
          const decision = state.engineBDecisions[0];
          // Confidence should be reduced due to uncertainty near gamma flip
          expect(decision.reasoning).toContain('gamma');
        }

        // Verify GEX regime logged
        const logsWithGEX = state.logs.filter((log: any) => 
          log.gexRegime === 'GAMMA_FLIP_NEAR'
        );
        expect(logsWithGEX.length).toBeGreaterThan(0);
      } finally {
        await orchestrator.teardownTest(context);
      }
    });

    it('should use baseline confidence in neutral GEX regime', async () => {
      const context = await orchestrator.setupTest({
        isolatedEnvironment: true,
        featureFlags: { engineB: true },
        mockExternalAPIs: true,
        captureAllLogs: true
      });

      try {
        // Generate neutral GEX data
        const gexData = gexGenerator.generateGEX({
          type: 'NEUTRAL',
          symbol: 'SPY',
          spotPrice: 450.00
        });

        // Generate webhook
        const webhook = webhookGenerator.generateWebhook({
          symbol: 'SPY',
          timeframe: '5m',
          session: 'RTH_OPEN',
          pattern: 'TREND_CONTINUATION',
          price: 450.00,
          volume: 1000000,
          timestamp: Date.now()
        });

        await orchestrator.injectGEX(context, gexData);
        await orchestrator.injectWebhook(context, webhook);
        await new Promise(resolve => setTimeout(resolve, 150));

        const state = await orchestrator.captureState(context);

        // Verify neutral GEX regime
        expect(Math.abs(gexData.data.total_gex)).toBeLessThan(1000);

        // Verify baseline confidence used (no significant GEX adjustment)
        if (state.engineBDecisions.length > 0) {
          const decision = state.engineBDecisions[0];
          // Confidence should be in normal range
          expect(decision.confidence).toBeGreaterThanOrEqual(0.3);
          expect(decision.confidence).toBeLessThanOrEqual(0.9);
        }

        // Verify GEX regime logged
        const logsWithGEX = state.logs.filter((log: any) => 
          log.gexRegime === 'NEUTRAL'
        );
        expect(logsWithGEX.length).toBeGreaterThan(0);
      } finally {
        await orchestrator.teardownTest(context);
      }
    });
  });
});

/**
 * Helper function to get expected confidence adjustment for GEX regime
 */
function getExpectedConfidenceAdjustment(regimeType: string): 'INCREASE' | 'DECREASE' | 'NEUTRAL' {
  switch (regimeType) {
    case 'POSITIVE':
      return 'DECREASE'; // Pinning reduces momentum confidence
    case 'NEGATIVE':
      return 'INCREASE'; // Trending increases momentum confidence
    case 'GAMMA_FLIP_NEAR':
      return 'DECREASE'; // Uncertainty near flip reduces confidence
    case 'NEUTRAL':
      return 'NEUTRAL'; // No significant adjustment
    default:
      return 'NEUTRAL';
  }
}
