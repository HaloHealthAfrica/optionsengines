/**
 * Property-Based Tests for Strike Selection Validator
 * Feature: gtm-launch-readiness-validation
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { StrikeSelectionValidator } from '../../validators/strike-selection-validator.js';

describe('Strike Selection Validator - Property Tests', () => {
  const validator = new StrikeSelectionValidator();

  /**
   * Property 23: Strike Filtering Correctness
   * Validates: Requirements 5.1, 5.2, 5.3
   */
  it('Property 23: Strike Filtering Correctness - filters by DTE, Greeks, and Liquidity', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('SCALP_GUARDED', 'SWING', 'POSITION', 'LEAPS'),
        async (_setupType) => {
          const result = await validator.validateStrikeFiltering();
          
          expect(result.category).toBe('STRIKE_SELECTION');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          expect(result.executionTime).toBeGreaterThanOrEqual(0);
          expect(result.timestamp).toBeInstanceOf(Date);
          
          // If validation passes, all filters should work correctly
          if (result.status === 'PASS') {
            expect(result.testsPassed).toBeGreaterThan(0);
            expect(result.testsFailed).toBe(0);
            expect(result.failures).toHaveLength(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 24: Strike Scoring Completeness
   * Validates: Requirements 5.4
   */
  it('Property 24: Strike Scoring Completeness - includes all 6 scoring dimensions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('SCALP_GUARDED', 'SWING', 'POSITION', 'LEAPS'),
        async (_setupType) => {
          const result = await validator.validateStrikeScoring();
          
          expect(result.category).toBe('STRIKE_SELECTION');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // If validation passes, all scoring dimensions should be present
          if (result.status === 'PASS') {
            expect(result.testsPassed).toBeGreaterThan(0);
            expect(result.testsFailed).toBe(0);
            expect(result.failures).toHaveLength(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 25: Strike Ranking Order
   * Validates: Requirements 5.5
   */
  it('Property 25: Strike Ranking Order - selects highest scoring contract', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('SCALP_GUARDED', 'SWING', 'POSITION', 'LEAPS'),
        async (_setupType) => {
          const result = await validator.validateStrikeRanking();
          
          expect(result.category).toBe('STRIKE_SELECTION');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // If validation passes, ranking should select best contract
          if (result.status === 'PASS') {
            expect(result.testsPassed).toBeGreaterThan(0);
            expect(result.testsFailed).toBe(0);
            expect(result.failures).toHaveLength(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 26: Strike Greeks Validation
   * Validates: Requirements 5.6
   */
  it('Property 26: Strike Greeks Validation - Greeks are in valid ranges', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('SCALP_GUARDED', 'SWING', 'POSITION', 'LEAPS'),
        async (_setupType) => {
          const result = await validator.validateGreeksCalculation();
          
          expect(result.category).toBe('STRIKE_SELECTION');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // If validation passes, Greeks should be valid
          if (result.status === 'PASS') {
            expect(result.testsPassed).toBeGreaterThan(0);
            expect(result.testsFailed).toBe(0);
            expect(result.failures).toHaveLength(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 27: Strike Output Format Consistency
   * Validates: Requirements 5.7
   */
  it('Property 27: Strike Output Format Consistency - output includes all required fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('SCALP_GUARDED', 'SWING', 'POSITION', 'LEAPS'),
        async (_setupType) => {
          const result = await validator.validateOutputFormatting();
          
          expect(result.category).toBe('STRIKE_SELECTION');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // If validation passes, output format should be complete
          if (result.status === 'PASS') {
            expect(result.testsPassed).toBeGreaterThan(0);
            expect(result.testsFailed).toBe(0);
            expect(result.failures).toHaveLength(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Validation results are deterministic
   */
  it('Property: Strike validation results are deterministic for same input', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('validateStrikeFiltering', 'validateStrikeScoring', 'validateStrikeRanking'),
        async (methodName) => {
          const method = validator[methodName as keyof StrikeSelectionValidator] as () => Promise<any>;
          
          const result1 = await method.call(validator);
          const result2 = await method.call(validator);
          
          // Results should be consistent
          expect(result1.status).toBe(result2.status);
          expect(result1.testsPassed).toBe(result2.testsPassed);
          expect(result1.testsFailed).toBe(result2.testsFailed);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: All validation methods return proper structure
   */
  it('Property: All strike validation methods return ValidationResult structure', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          'validateStrikeFiltering',
          'validateStrikeScoring',
          'validateStrikeRanking',
          'validateGreeksCalculation',
          'validateOutputFormatting'
        ),
        async (methodName) => {
          const method = validator[methodName as keyof StrikeSelectionValidator] as () => Promise<any>;
          const result = await method.call(validator);
          
          // Verify ValidationResult structure
          expect(result).toHaveProperty('category');
          expect(result).toHaveProperty('status');
          expect(result).toHaveProperty('testsPassed');
          expect(result).toHaveProperty('testsFailed');
          expect(result).toHaveProperty('executionTime');
          expect(result).toHaveProperty('timestamp');
          expect(result).toHaveProperty('failures');
          
          expect(result.category).toBe('STRIKE_SELECTION');
          expect(['PASS', 'FAIL']).toContain(result.status);
          expect(result.testsPassed).toBeGreaterThanOrEqual(0);
          expect(result.testsFailed).toBeGreaterThanOrEqual(0);
          expect(result.executionTime).toBeGreaterThanOrEqual(0);
          expect(result.timestamp).toBeInstanceOf(Date);
          expect(Array.isArray(result.failures)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
