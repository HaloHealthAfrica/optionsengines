/**
 * Property-based tests for Market Context Generator
 * 
 * Feature: gtm-launch-readiness-validation
 * Property 56: Synthetic Market Context Realism
 * Validates: Requirements 11.2
 */

import * as fc from 'fast-check';
import { MarketContextGenerator } from '../../generators/market-context-generator.js';
import { MarketParams, VolatilityLevel, LiquidityLevel } from '../../types/index.js';
import { PROPERTY_TEST_ITERATIONS } from '../setup.js';

describe('Market Context Generator Property Tests', () => {
  let generator: MarketContextGenerator;

  beforeEach(() => {
    generator = new MarketContextGenerator();
  });

  describe('Property 56: Synthetic Market Context Realism', () => {
    // Feature: gtm-launch-readiness-validation, Property 56: Synthetic Market Context Realism
    
    it('should generate realistic market context with all required fields', () => {
      fc.assert(
        fc.property(
          fc.record({
            volatility: fc.constantFrom<VolatilityLevel>('LOW', 'MEDIUM', 'HIGH', 'EXTREME'),
            liquidity: fc.constantFrom<LiquidityLevel>('LOW', 'MEDIUM', 'HIGH'),
            gexLevel: fc.integer({ min: -10000, max: 20000 }),
            marketHours: fc.boolean(),
          }),
          (params: MarketParams) => {
            const context = generator.generateMarketContext(params);

            // Verify all required fields are present
            expect(context).toBeDefined();
            expect(typeof context.gexLevel).toBe('number');
            expect(typeof context.volatilityIndex).toBe('number');
            expect(typeof context.liquidityScore).toBe('number');
            expect(context.marketRegime).toBeDefined();
            expect(typeof context.marketHours).toBe('boolean');
            expect(context.timestamp).toBeInstanceOf(Date);

            // Verify GEX level matches input
            expect(context.gexLevel).toBe(params.gexLevel);

            // Verify market hours matches input
            expect(context.marketHours).toBe(params.marketHours);

            // Verify market regime is valid
            expect(['BULLISH', 'BEARISH', 'NEUTRAL', 'VOLATILE']).toContain(context.marketRegime);
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should generate volatility index within realistic ranges', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<VolatilityLevel>('LOW', 'MEDIUM', 'HIGH', 'EXTREME'),
          (volatility: VolatilityLevel) => {
            const params: MarketParams = {
              volatility,
              liquidity: 'MEDIUM',
              gexLevel: 0,
              marketHours: true,
            };

            const context = generator.generateMarketContext(params);

            // Verify volatility index is in expected range
            const ranges = {
              LOW: [10, 15],
              MEDIUM: [15, 25],
              HIGH: [25, 40],
              EXTREME: [40, 80],
            };

            const [min, max] = ranges[volatility];
            expect(context.volatilityIndex).toBeGreaterThanOrEqual(min);
            expect(context.volatilityIndex).toBeLessThanOrEqual(max);
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should generate liquidity score within realistic ranges', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<LiquidityLevel>('LOW', 'MEDIUM', 'HIGH'),
          (liquidity: LiquidityLevel) => {
            const params: MarketParams = {
              volatility: 'MEDIUM',
              liquidity,
              gexLevel: 0,
              marketHours: true,
            };

            const context = generator.generateMarketContext(params);

            // Verify liquidity score is in expected range
            const ranges = {
              LOW: [20, 40],
              MEDIUM: [40, 70],
              HIGH: [70, 95],
            };

            const [min, max] = ranges[liquidity];
            expect(context.liquidityScore).toBeGreaterThanOrEqual(min);
            expect(context.liquidityScore).toBeLessThanOrEqual(max);
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should determine market regime based on volatility and GEX', () => {
      fc.assert(
        fc.property(
          fc.record({
            volatility: fc.constantFrom<VolatilityLevel>('LOW', 'MEDIUM', 'HIGH', 'EXTREME'),
            gexLevel: fc.integer({ min: -10000, max: 20000 }),
          }),
          (params) => {
            const fullParams: MarketParams = {
              ...params,
              liquidity: 'MEDIUM',
              marketHours: true,
            };

            const context = generator.generateMarketContext(fullParams);

            // Verify regime logic
            if (params.volatility === 'EXTREME' || params.gexLevel < -5000) {
              expect(context.marketRegime).toBe('VOLATILE');
            } else if (params.gexLevel < 0) {
              expect(context.marketRegime).toBe('BEARISH');
            } else if (params.gexLevel > 5000 && params.volatility === 'LOW') {
              expect(context.marketRegime).toBe('BULLISH');
            } else {
              expect(context.marketRegime).toBe('NEUTRAL');
            }
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should generate extreme volatility context correctly', () => {
      for (let i = 0; i < PROPERTY_TEST_ITERATIONS; i++) {
        const context = generator.generateExtremeVolatility();

        // Verify extreme volatility characteristics
        expect(context.volatilityIndex).toBeGreaterThanOrEqual(40);
        expect(context.volatilityIndex).toBeLessThanOrEqual(80);
        expect(context.gexLevel).toBeLessThan(-1000);
        expect(context.marketRegime).toBe('VOLATILE');
        expect(context.marketHours).toBe(true);
      }
    });

    it('should generate low liquidity context correctly', () => {
      for (let i = 0; i < PROPERTY_TEST_ITERATIONS; i++) {
        const context = generator.generateLowLiquidity();

        // Verify low liquidity characteristics
        expect(context.liquidityScore).toBeGreaterThanOrEqual(20);
        expect(context.liquidityScore).toBeLessThanOrEqual(40);
        expect(context.marketHours).toBe(false); // After hours
      }
    });

    it('should generate calm market context correctly', () => {
      for (let i = 0; i < PROPERTY_TEST_ITERATIONS; i++) {
        const context = generator.generateCalmMarket();

        // Verify calm market characteristics
        expect(context.volatilityIndex).toBeGreaterThanOrEqual(10);
        expect(context.volatilityIndex).toBeLessThanOrEqual(15);
        expect(context.gexLevel).toBeGreaterThanOrEqual(5000);
        expect(context.liquidityScore).toBeGreaterThanOrEqual(70);
        expect(context.marketHours).toBe(true);
      }
    });

    it('should generate volatile market context correctly', () => {
      for (let i = 0; i < PROPERTY_TEST_ITERATIONS; i++) {
        const context = generator.generateVolatileMarket();

        // Verify volatile market characteristics
        expect(context.volatilityIndex).toBeGreaterThanOrEqual(25);
        expect(context.volatilityIndex).toBeLessThanOrEqual(40);
        expect(context.gexLevel).toBeLessThan(-2000);
        expect(context.marketHours).toBe(true);
      }
    });

    it('should generate batch of market contexts with consistent structure', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              volatility: fc.constantFrom<VolatilityLevel>('LOW', 'MEDIUM', 'HIGH', 'EXTREME'),
              liquidity: fc.constantFrom<LiquidityLevel>('LOW', 'MEDIUM', 'HIGH'),
              gexLevel: fc.integer({ min: -10000, max: 20000 }),
              marketHours: fc.boolean(),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (paramsList: MarketParams[]) => {
            const contexts = generator.generateBatch(paramsList);

            // Should generate same number of contexts as params
            expect(contexts.length).toBe(paramsList.length);

            // All contexts should have valid structure
            contexts.forEach((context, index) => {
              expect(context.gexLevel).toBe(paramsList[index].gexLevel);
              expect(context.marketHours).toBe(paramsList[index].marketHours);
              expect(context.timestamp).toBeInstanceOf(Date);
              expect(['BULLISH', 'BEARISH', 'NEUTRAL', 'VOLATILE']).toContain(context.marketRegime);
            });
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });

    it('should generate different contexts for different parameters', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.record({
              volatility: fc.constantFrom<VolatilityLevel>('LOW', 'MEDIUM', 'HIGH', 'EXTREME'),
              liquidity: fc.constantFrom<LiquidityLevel>('LOW', 'MEDIUM', 'HIGH'),
              gexLevel: fc.integer({ min: -10000, max: 20000 }),
              marketHours: fc.boolean(),
            }),
            fc.record({
              volatility: fc.constantFrom<VolatilityLevel>('LOW', 'MEDIUM', 'HIGH', 'EXTREME'),
              liquidity: fc.constantFrom<LiquidityLevel>('LOW', 'MEDIUM', 'HIGH'),
              gexLevel: fc.integer({ min: -10000, max: 20000 }),
              marketHours: fc.boolean(),
            })
          ),
          ([params1, params2]) => {
            const context1 = generator.generateMarketContext(params1);
            const context2 = generator.generateMarketContext(params2);

            // If parameters are different, at least some context fields should differ
            if (JSON.stringify(params1) !== JSON.stringify(params2)) {
              const isDifferent = 
                context1.gexLevel !== context2.gexLevel ||
                context1.marketHours !== context2.marketHours ||
                context1.marketRegime !== context2.marketRegime;
              
              expect(isDifferent).toBe(true);
            }
          }
        ),
        { numRuns: PROPERTY_TEST_ITERATIONS }
      );
    });
  });
});
