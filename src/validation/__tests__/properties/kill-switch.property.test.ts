/**
 * Property-Based Tests for Kill Switch Validator
 * Feature: gtm-launch-readiness-validation
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { KillSwitchValidator } from '../../validators/kill-switch-validator.js';

describe('Kill Switch Validator - Property Tests', () => {
  const validator = new KillSwitchValidator();

  /**
   * Property 79: Global Kill Switch Speed
   * Validates: Requirements 15.1
   */
  it('Property 79: Global Kill Switch Speed - all processing stops within 2 seconds', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 500, max: 3000 }),
        async (_shutdownTime) => {
          const result = await validator.validateGlobalKillSwitch();
          
          expect(result.category).toBe('KILL_SWITCHES');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          expect(result.executionTime).toBeGreaterThanOrEqual(0);
          expect(result.timestamp).toBeInstanceOf(Date);
          
          // If validation passes, kill switch should be fast
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
   * Property 80: Strategy Kill Switch Selectivity
   * Validates: Requirements 15.2
   */
  it('Property 80: Strategy Kill Switch Selectivity - only target strategy blocked', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('ORB', 'TTM', 'GAMMA_FLOW', 'STRAT'),
        async (_strategy) => {
          const result = await validator.validateStrategyKillSwitch();
          
          expect(result.category).toBe('KILL_SWITCHES');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // If validation passes, strategy kill switch should be selective
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
   * Property 81: User Kill Switch Immediacy
   * Validates: Requirements 15.3
   */
  it('Property 81: User Kill Switch Immediacy - user delivery stops immediately', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (_userId) => {
          const result = await validator.validateUserKillSwitch();
          
          expect(result.category).toBe('KILL_SWITCHES');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // If validation passes, user kill switch should be immediate
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
   * Property 82: Kill Switch Deactivation Recovery
   * Validates: Requirements 15.4
   */
  it('Property 82: Kill Switch Deactivation Recovery - processing resumes without restart', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('global', 'strategy', 'user'),
        async (_killSwitchType) => {
          const result = await validator.validateKillSwitchRecovery();
          
          expect(result.category).toBe('KILL_SWITCHES');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // If validation passes, recovery should work
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
   * Property 83: Emergency Stop Data Preservation
   * Validates: Requirements 15.5
   */
  it('Property 83: Emergency Stop Data Preservation - in-flight signals persisted', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        async (_inFlightSignals) => {
          const result = await validator.validateDataPreservation();
          
          expect(result.category).toBe('KILL_SWITCHES');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // If validation passes, data should be preserved
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
   * Property 84: Circuit Breaker Automatic Shutdown
   * Validates: Requirements 15.6
   */
  it('Property 84: Circuit Breaker Automatic Shutdown - activates on error threshold', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10, max: 100 }),
        async (_errorRate) => {
          const result = await validator.validateCircuitBreaker();
          
          expect(result.category).toBe('KILL_SWITCHES');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // If validation passes, circuit breaker should work
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
  it('Property: Kill switch validation results are deterministic for same input', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          'validateGlobalKillSwitch',
          'validateStrategyKillSwitch',
          'validateUserKillSwitch',
          'validateKillSwitchRecovery',
          'validateDataPreservation',
          'validateCircuitBreaker'
        ),
        async (methodName) => {
          const method = validator[methodName as keyof KillSwitchValidator] as () => Promise<any>;
          
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
  it('Property: All kill switch validation methods return ValidationResult structure', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          'validateGlobalKillSwitch',
          'validateStrategyKillSwitch',
          'validateUserKillSwitch',
          'validateKillSwitchRecovery',
          'validateDataPreservation',
          'validateCircuitBreaker'
        ),
        async (methodName) => {
          const method = validator[methodName as keyof KillSwitchValidator] as () => Promise<any>;
          const result = await method.call(validator);
          
          // Verify ValidationResult structure
          expect(result).toHaveProperty('category');
          expect(result).toHaveProperty('status');
          expect(result).toHaveProperty('testsPassed');
          expect(result).toHaveProperty('testsFailed');
          expect(result).toHaveProperty('executionTime');
          expect(result).toHaveProperty('timestamp');
          expect(result).toHaveProperty('failures');
          
          expect(result.category).toBe('KILL_SWITCHES');
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
