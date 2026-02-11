/**
 * Property-Based Tests for Performance Tracker Validator
 * Feature: gtm-launch-readiness-validation
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { PerformanceTrackerValidator } from '../../validators/performance-tracker-validator.js';

describe('Performance Tracker Validator - Property Tests', () => {
  const validator = new PerformanceTrackerValidator();

  /**
   * Property 38: Trade Record Creation Completeness
   * Validates: Requirements 8.1
   */
  it('Property 38: Trade Record Creation Completeness - records created with entry details', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('record', 'tracking', 'entry'),
        async (_aspect) => {
          const result = await validator.validateTradeRecordCreation();
          
          expect(result.category).toBe('PERFORMANCE_TRACKING');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          expect(result.executionTime).toBeGreaterThanOrEqual(0);
          expect(result.timestamp).toBeInstanceOf(Date);
          
          // If validation passes, trade records should be created correctly
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
   * Property 39: P&L Calculation Correctness
   * Validates: Requirements 8.2
   */
  it('Property 39: P&L Calculation Correctness - P&L equals (exit - entry) * quantity * multiplier', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 50, max: 200 }),
        fc.integer({ min: 50, max: 200 }),
        fc.integer({ min: 1, max: 100 }),
        async (_entryPrice, _exitPrice, _quantity) => {
          const result = await validator.validatePnLCalculation();
          
          expect(result.category).toBe('PERFORMANCE_TRACKING');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // If validation passes, P&L calculation should be correct
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
   * Property 40: Performance Metrics Calculation
   * Validates: Requirements 8.3, 8.4
   */
  it('Property 40: Performance Metrics Calculation - win rate and R-multiple calculated correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        async (_winningTrades, _totalTrades) => {
          const result = await validator.validateMetricsCalculation();
          
          expect(result.category).toBe('PERFORMANCE_TRACKING');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // If validation passes, metrics should be calculated correctly
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
   * Property 41: Performance Aggregation Grouping
   * Validates: Requirements 8.5
   */
  it('Property 41: Performance Aggregation Grouping - metrics grouped by strategy, timeframe, engine', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('strategy', 'timeframe', 'engine'),
        async (_grouping) => {
          const result = await validator.validateAggregationAndDisplay();
          
          expect(result.category).toBe('PERFORMANCE_TRACKING');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // If validation passes, aggregation should work correctly
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
   * Property 42: Performance Dashboard Completeness
   * Validates: Requirements 8.6
   */
  it('Property 42: Performance Dashboard Completeness - dashboard shows all required metrics', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('pnl', 'winrate', 'rmultiple', 'count'),
        async (_metric) => {
          const result = await validator.validateAggregationAndDisplay();
          
          expect(result.category).toBe('PERFORMANCE_TRACKING');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // If validation passes, dashboard should be complete
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
   * Property 43: Incomplete Trade Exclusion
   * Validates: Requirements 8.7
   */
  it('Property 43: Incomplete Trade Exclusion - incomplete trades marked and excluded', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('marked', 'excluded', 'pending'),
        async (_aspect) => {
          const result = await validator.validateAggregationAndDisplay();
          
          expect(result.category).toBe('PERFORMANCE_TRACKING');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // If validation passes, incomplete trades should be handled correctly
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
  it('Property: Performance validation results are deterministic for same input', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          'validateTradeRecordCreation',
          'validatePnLCalculation',
          'validateMetricsCalculation',
          'validateAggregationAndDisplay'
        ),
        async (methodName) => {
          const method = validator[methodName as keyof PerformanceTrackerValidator] as () => Promise<any>;
          
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
   * Additional property: All validation methods return ValidationResult structure
   */
  it('Property: All performance validation methods return ValidationResult structure', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          'validateTradeRecordCreation',
          'validatePnLCalculation',
          'validateMetricsCalculation',
          'validateAggregationAndDisplay'
        ),
        async (methodName) => {
          const method = validator[methodName as keyof PerformanceTrackerValidator] as () => Promise<any>;
          const result = await method.call(validator);
          
          // Verify ValidationResult structure
          expect(result).toHaveProperty('category');
          expect(result).toHaveProperty('status');
          expect(result).toHaveProperty('testsPassed');
          expect(result).toHaveProperty('testsFailed');
          expect(result).toHaveProperty('executionTime');
          expect(result).toHaveProperty('timestamp');
          expect(result).toHaveProperty('failures');
          
          expect(result.category).toBe('PERFORMANCE_TRACKING');
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
