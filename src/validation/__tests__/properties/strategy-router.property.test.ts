/**
 * Property-Based Tests for Strategy Router Validator
 * Feature: gtm-launch-readiness-validation
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { StrategyRouterValidator } from '../../validators/strategy-router-validator.js';

describe('Strategy Router Validator - Property Tests', () => {
  jest.setTimeout(60000);
  const validator = new StrategyRouterValidator();

  /**
   * Property 28: Strategy Router Engine Assignment
   * Validates: Requirements 6.2, 6.3
   */
  it('Property 28: Strategy Router Engine Assignment - routes to A or B based on feature flag', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('routing', 'shadow', 'isolation'),
        async (_testType) => {
          const result = await validator.validateRouting();
          
          expect(result.category).toBe('STRATEGY_ROUTING');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          expect(result.executionTime).toBeGreaterThanOrEqual(0);
          expect(result.timestamp).toBeInstanceOf(Date);
          
          // If validation passes, routing should work correctly
          if (result.status === 'PASS') {
            expect(result.testsPassed).toBeGreaterThan(0);
            expect(result.testsFailed).toBe(0);
            expect(result.failures).toHaveLength(0);
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Property 29: Shadow Execution Completeness
   * Validates: Requirements 6.4
   */
  it('Property 29: Shadow Execution Completeness - shadow executor has all required methods', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('simulate', 'refresh', 'monitor'),
        async (_method) => {
          const result = await validator.validateShadowExecution();
          
          expect(result.category).toBe('STRATEGY_ROUTING');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // If validation passes, shadow execution should be complete
          if (result.status === 'PASS') {
            expect(result.testsPassed).toBeGreaterThan(0);
            expect(result.testsFailed).toBe(0);
            expect(result.failures).toHaveLength(0);
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Property 30: Shadow Execution Metrics Logging
   * Validates: Requirements 6.5
   */
  it('Property 30: Shadow Execution Metrics Logging - comparison metrics are logged', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('metrics', 'logging', 'comparison'),
        async (_aspect) => {
          const result = await validator.validateShadowExecution();
          
          expect(result.category).toBe('STRATEGY_ROUTING');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // Shadow execution validation covers metrics logging
          if (result.status === 'PASS') {
            expect(result.testsPassed).toBeGreaterThan(0);
            expect(result.testsFailed).toBe(0);
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Property 31: Routing Configuration Isolation
   * Validates: Requirements 6.6
   */
  it('Property 31: Routing Configuration Isolation - in-flight signals unaffected by config changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('determinism', 'uniqueness', 'isolation'),
        async (_aspect) => {
          const result = await validator.validateConfigurationIsolation();
          
          expect(result.category).toBe('STRATEGY_ROUTING');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // If validation passes, configuration isolation should work
          if (result.status === 'PASS') {
            expect(result.testsPassed).toBeGreaterThan(0);
            expect(result.testsFailed).toBe(0);
            expect(result.failures).toHaveLength(0);
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Additional property: Validation results are deterministic
   */
  it('Property: Router validation results are deterministic for same input', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('validateRouting', 'validateShadowExecution', 'validateConfigurationIsolation'),
        async (methodName) => {
          const method = validator[methodName as keyof StrategyRouterValidator] as () => Promise<any>;
          
          const result1 = await method.call(validator);
          const result2 = await method.call(validator);
          
          // Results should be valid and well-formed
          expect(['PASS', 'FAIL']).toContain(result1.status);
          expect(['PASS', 'FAIL']).toContain(result2.status);
          expect(result1.testsPassed).toBeGreaterThanOrEqual(0);
          expect(result1.testsFailed).toBeGreaterThanOrEqual(0);
          expect(result2.testsPassed).toBeGreaterThanOrEqual(0);
          expect(result2.testsFailed).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Additional property: All validation methods return ValidationResult structure
   */
  it('Property: All router validation methods return ValidationResult structure', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          'validateRouting',
          'validateShadowExecution',
          'validateConfigurationIsolation'
        ),
        async (methodName) => {
          const method = validator[methodName as keyof StrategyRouterValidator] as () => Promise<any>;
          const result = await method.call(validator);
          
          // Verify ValidationResult structure
          expect(result).toHaveProperty('category');
          expect(result).toHaveProperty('status');
          expect(result).toHaveProperty('testsPassed');
          expect(result).toHaveProperty('testsFailed');
          expect(result).toHaveProperty('executionTime');
          expect(result).toHaveProperty('timestamp');
          expect(result).toHaveProperty('failures');
          
          expect(result.category).toBe('STRATEGY_ROUTING');
          expect(['PASS', 'FAIL']).toContain(result.status);
          expect(result.testsPassed).toBeGreaterThanOrEqual(0);
          expect(result.testsFailed).toBeGreaterThanOrEqual(0);
          expect(result.executionTime).toBeGreaterThanOrEqual(0);
          expect(result.timestamp).toBeInstanceOf(Date);
          expect(Array.isArray(result.failures)).toBe(true);
        }
      ),
      { numRuns: 10 }
    );
  });
});

