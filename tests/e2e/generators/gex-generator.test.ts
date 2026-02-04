/**
 * Property-Based Tests for Synthetic GEX Generator
 * 
 * Tests universal properties that should hold across all GEX generation scenarios.
 */

import fc from 'fast-check';
import { createGEXGenerator } from './gex-generator-impl';
import { GEXRegime } from './gex-generator';

/**
 * Fast-check arbitrary for generating GEX regimes
 */
const gexRegimeArbitrary = (): fc.Arbitrary<GEXRegime> =>
  fc.record({
    type: fc.constantFrom(
      'POSITIVE' as const,
      'NEGATIVE' as const,
      'GAMMA_FLIP_NEAR' as const,
      'NEUTRAL' as const
    ),
    symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
    spotPrice: fc.double({ min: 100, max: 500, noNaN: true }),
    gammaFlipLevel: fc.option(fc.double({ min: 100, max: 500, noNaN: true }), { nil: undefined }),
  }) as fc.Arbitrary<GEXRegime>;

describe('GEX Generator Property Tests', () => {
  const generator = createGEXGenerator(54321);

  describe('Property 3: GEX Generator Completeness', () => {
    // Feature: e2e-testing-with-synthetic-data, Property 3: GEX Generator Completeness
    it('should generate valid GEX data with all required fields for any regime', () => {
      fc.assert(
        fc.property(gexRegimeArbitrary(), (regime: GEXRegime) => {
          const gex = generator.generateGEX(regime);

          // Verify data exists and has all required fields
          expect(gex.data).toBeDefined();
          expect(typeof gex.data.total_gex).toBe('number');
          expect(typeof gex.data.call_gex).toBe('number');
          expect(typeof gex.data.put_gex).toBe('number');
          expect(typeof gex.data.net_gex).toBe('number');
          expect(gex.data.gamma_flip_level === null || typeof gex.data.gamma_flip_level === 'number').toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should maintain mathematical consistency: call_gex + put_gex = total_gex', () => {
      fc.assert(
        fc.property(gexRegimeArbitrary(), (regime: GEXRegime) => {
          const gex = generator.generateGEX(regime);

          // Verify call_gex + put_gex = total_gex (with floating point tolerance)
          const calculated_total = gex.data.call_gex + gex.data.put_gex;
          const tolerance = 0.01; // Allow small floating point errors
          expect(Math.abs(calculated_total - gex.data.total_gex)).toBeLessThan(tolerance);
        }),
        { numRuns: 100 }
      );
    });

    it('should maintain mathematical consistency: net_gex = call_gex - put_gex', () => {
      fc.assert(
        fc.property(gexRegimeArbitrary(), (regime: GEXRegime) => {
          const gex = generator.generateGEX(regime);

          // Verify net_gex = call_gex - put_gex (with floating point tolerance)
          const calculated_net = gex.data.call_gex - gex.data.put_gex;
          const tolerance = 0.01; // Allow small floating point errors
          expect(Math.abs(calculated_net - gex.data.net_gex)).toBeLessThan(tolerance);
        }),
        { numRuns: 100 }
      );
    });

    it('should generate call_gex as positive value', () => {
      fc.assert(
        fc.property(gexRegimeArbitrary(), (regime: GEXRegime) => {
          const gex = generator.generateGEX(regime);

          // Call GEX should always be positive
          expect(gex.data.call_gex).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should generate put_gex as negative value', () => {
      fc.assert(
        fc.property(gexRegimeArbitrary(), (regime: GEXRegime) => {
          const gex = generator.generateGEX(regime);

          // Put GEX should always be negative
          expect(gex.data.put_gex).toBeLessThan(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should generate realistic GEX magnitudes', () => {
      fc.assert(
        fc.property(gexRegimeArbitrary(), (regime: GEXRegime) => {
          const gex = generator.generateGEX(regime);

          // GEX values should be in realistic ranges (millions)
          expect(Math.abs(gex.data.call_gex)).toBeGreaterThan(1_000_000);
          expect(Math.abs(gex.data.call_gex)).toBeLessThan(50_000_000);
          expect(Math.abs(gex.data.put_gex)).toBeGreaterThan(1_000_000);
          expect(Math.abs(gex.data.put_gex)).toBeLessThan(50_000_000);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 4: GEX Regime Characteristics', () => {
    // Feature: e2e-testing-with-synthetic-data, Property 4: GEX Regime Characteristics
    it('should generate positive total_gex for POSITIVE regime', () => {
      fc.assert(
        fc.property(
          fc.record({
            type: fc.constant('POSITIVE' as const),
            symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
            spotPrice: fc.double({ min: 100, max: 500, noNaN: true }),
            // Don't provide gammaFlipLevel for POSITIVE regime - let it be generated
          }),
          (regime: GEXRegime) => {
            const gex = generator.generateGEX(regime);

            // Positive regime should have total_gex > 0
            expect(gex.data.total_gex).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate negative total_gex for NEGATIVE regime', () => {
      fc.assert(
        fc.property(
          fc.record({
            type: fc.constant('NEGATIVE' as const),
            symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
            spotPrice: fc.double({ min: 100, max: 500, noNaN: true }),
            // Don't provide gammaFlipLevel for NEGATIVE regime - let it be generated
          }),
          (regime: GEXRegime) => {
            const gex = generator.generateGEX(regime);

            // Negative regime should have total_gex < 0
            expect(gex.data.total_gex).toBeLessThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate gamma_flip_level within 1% of spotPrice for GAMMA_FLIP_NEAR regime', () => {
      fc.assert(
        fc.property(
          fc.record({
            type: fc.constant('GAMMA_FLIP_NEAR' as const),
            symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
            spotPrice: fc.double({ min: 100, max: 500, noNaN: true }),
            // Don't provide gammaFlipLevel - let it be generated within 1%
          }),
          (regime: GEXRegime) => {
            const gex = generator.generateGEX(regime);

            // Gamma flip near should have flip level within 1% of spot price
            expect(gex.data.gamma_flip_level).not.toBeNull();
            if (gex.data.gamma_flip_level !== null) {
              const percentDiff = Math.abs(gex.data.gamma_flip_level - regime.spotPrice) / regime.spotPrice;
              expect(percentDiff).toBeLessThan(0.01); // Within 1%
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate total_gex near zero for NEUTRAL regime', () => {
      fc.assert(
        fc.property(
          fc.record({
            type: fc.constant('NEUTRAL' as const),
            symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
            spotPrice: fc.double({ min: 100, max: 500, noNaN: true }),
            // Don't provide gammaFlipLevel for NEUTRAL regime - let it be generated
          }),
          (regime: GEXRegime) => {
            const gex = generator.generateGEX(regime);

            // Neutral regime should have total_gex close to zero
            // Allow up to 20% of the average magnitude
            const avgMagnitude = (Math.abs(gex.data.call_gex) + Math.abs(gex.data.put_gex)) / 2;
            expect(Math.abs(gex.data.total_gex)).toBeLessThan(avgMagnitude * 0.2);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate gamma_flip_level below spotPrice for POSITIVE regime', () => {
      fc.assert(
        fc.property(
          fc.record({
            type: fc.constant('POSITIVE' as const),
            symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
            spotPrice: fc.double({ min: 100, max: 500, noNaN: true }),
            // Don't provide gammaFlipLevel for POSITIVE regime - let it be generated
          }),
          (regime: GEXRegime) => {
            const gex = generator.generateGEX(regime);

            // Positive regime should have flip level below spot price
            expect(gex.data.gamma_flip_level).not.toBeNull();
            if (gex.data.gamma_flip_level !== null) {
              expect(gex.data.gamma_flip_level).toBeLessThan(regime.spotPrice);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate gamma_flip_level above spotPrice for NEGATIVE regime', () => {
      fc.assert(
        fc.property(
          fc.record({
            type: fc.constant('NEGATIVE' as const),
            symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
            spotPrice: fc.double({ min: 100, max: 500, noNaN: true }),
            // Don't provide gammaFlipLevel for NEGATIVE regime - let it be generated
          }),
          (regime: GEXRegime) => {
            const gex = generator.generateGEX(regime);

            // Negative regime should have flip level above spot price
            expect(gex.data.gamma_flip_level).not.toBeNull();
            if (gex.data.gamma_flip_level !== null) {
              expect(gex.data.gamma_flip_level).toBeGreaterThan(regime.spotPrice);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should use provided gammaFlipLevel when specified for GAMMA_FLIP_NEAR', () => {
      fc.assert(
        fc.property(
          fc.record({
            type: fc.constant('GAMMA_FLIP_NEAR' as const),
            symbol: fc.constantFrom('SPY', 'QQQ', 'SPX'),
            spotPrice: fc.double({ min: 100, max: 500, noNaN: true }),
            gammaFlipLevel: fc.double({ min: 100, max: 500, noNaN: true }),
          }),
          (regime: GEXRegime & { gammaFlipLevel: number }) => {
            const gex = generator.generateGEX(regime);

            // Should use the provided gamma flip level
            expect(gex.data.gamma_flip_level).toBe(regime.gammaFlipLevel);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 3: Batch Generation', () => {
    it('should generate correct number of GEX data for batch', () => {
      fc.assert(
        fc.property(
          fc.array(gexRegimeArbitrary(), { minLength: 1, maxLength: 20 }),
          (regimes: GEXRegime[]) => {
            const gexBatch = generator.generateBatch(regimes);
            expect(gexBatch.length).toBe(regimes.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate valid GEX data for each regime in batch', () => {
      fc.assert(
        fc.property(
          fc.array(gexRegimeArbitrary(), { minLength: 1, maxLength: 10 }),
          (regimes: GEXRegime[]) => {
            const gexBatch = generator.generateBatch(regimes);

            gexBatch.forEach((gex, index) => {
              expect(gex.metadata.regime).toEqual(regimes[index]);
              
              // Verify mathematical consistency
              const calculated_total = gex.data.call_gex + gex.data.put_gex;
              expect(Math.abs(calculated_total - gex.data.total_gex)).toBeLessThan(0.01);
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 3: Determinism', () => {
    it('should generate identical GEX data for identical regimes', () => {
      fc.assert(
        fc.property(gexRegimeArbitrary(), (regime: GEXRegime) => {
          const gex1 = generator.generateGEX(regime);
          const gex2 = generator.generateGEX(regime);

          // Verify data is identical (excluding generatedAt timestamp)
          expect(gex1.data).toEqual(gex2.data);
          expect(gex1.metadata.regime).toEqual(gex2.metadata.regime);
          expect(gex1.metadata.synthetic).toBe(gex2.metadata.synthetic);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 1: Synthetic Data Marking (GEX)', () => {
    // Feature: e2e-testing-with-synthetic-data, Property 1: Synthetic Data Marking
    it('should mark all generated GEX data with synthetic: true', () => {
      fc.assert(
        fc.property(gexRegimeArbitrary(), (regime: GEXRegime) => {
          const gex = generator.generateGEX(regime);

          // Verify synthetic flag is present and true
          expect(gex.metadata).toBeDefined();
          expect(gex.metadata.synthetic).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should include regime metadata in all generated GEX data', () => {
      fc.assert(
        fc.property(gexRegimeArbitrary(), (regime: GEXRegime) => {
          const gex = generator.generateGEX(regime);

          // Verify regime metadata is present and matches input
          expect(gex.metadata.regime).toBeDefined();
          expect(gex.metadata.regime).toEqual(regime);
        }),
        { numRuns: 100 }
      );
    });

    it('should include generation timestamp in all generated GEX data', () => {
      fc.assert(
        fc.property(gexRegimeArbitrary(), (regime: GEXRegime) => {
          const beforeGeneration = Date.now();
          const gex = generator.generateGEX(regime);
          const afterGeneration = Date.now();

          // Verify generatedAt timestamp is present and reasonable
          expect(gex.metadata.generatedAt).toBeDefined();
          expect(typeof gex.metadata.generatedAt).toBe('number');
          expect(gex.metadata.generatedAt).toBeGreaterThanOrEqual(beforeGeneration);
          expect(gex.metadata.generatedAt).toBeLessThanOrEqual(afterGeneration);
        }),
        { numRuns: 100 }
      );
    });

    it('should mark all GEX data in batch with synthetic: true', () => {
      fc.assert(
        fc.property(
          fc.array(gexRegimeArbitrary(), { minLength: 1, maxLength: 10 }),
          (regimes: GEXRegime[]) => {
            const gexBatch = generator.generateBatch(regimes);

            // Verify all GEX data in batch are marked as synthetic
            gexBatch.forEach((gex) => {
              expect(gex.metadata.synthetic).toBe(true);
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
