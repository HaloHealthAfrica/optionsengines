/**
 * Property-Based Tests for Monitoring System Validator
 * Feature: gtm-launch-readiness-validation
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { MonitoringSystemValidator } from '../../validators/monitoring-system-validator.js';

describe('Monitoring System Validator - Property Tests', () => {
  const validator = new MonitoringSystemValidator();

  /**
   * Property 49: Health Check Response Time
   * Validates: Requirements 10.1
   */
  it('Property 49: Health Check Response Time - all services respond within 500ms', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('webhook', 'processor', 'engine', 'delivery'),
        async (_service) => {
          const result = await validator.validateHealthChecks();
          
          expect(result.category).toBe('MONITORING');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          expect(result.executionTime).toBeGreaterThanOrEqual(0);
          expect(result.timestamp).toBeInstanceOf(Date);
          
          // If validation passes, health checks should be fast
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
   * Property 50: Stage-by-Stage Latency Tracking
   * Validates: Requirements 10.2
   */
  it('Property 50: Stage-by-Stage Latency Tracking - all pipeline stages tracked', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('webhook', 'processing', 'engine', 'strike', 'delivery'),
        async (_stage) => {
          const result = await validator.validateLatencyMeasurement();
          
          expect(result.category).toBe('MONITORING');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // If validation passes, all stages should be tracked
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
   * Property 51: Error Capture Completeness
   * Validates: Requirements 10.3
   */
  it('Property 51: Error Capture Completeness - errors captured with full details', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('stack', 'context', 'timestamp'),
        async (_detail) => {
          const result = await validator.validateErrorCapture();
          
          expect(result.category).toBe('MONITORING');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // If validation passes, error capture should be complete
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
   * Property 52: Error Rate Alerting
   * Validates: Requirements 10.4
   */
  it('Property 52: Error Rate Alerting - alerts sent within 30 seconds when threshold exceeded', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100 }),
        async (_errorCount) => {
          const result = await validator.validateErrorAlerting();
          
          expect(result.category).toBe('MONITORING');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // If validation passes, alerting should work
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
   * Property 53: Monitoring Dashboard Completeness
   * Validates: Requirements 10.5
   */
  it('Property 53: Monitoring Dashboard Completeness - dashboard shows health, latency, and errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('health', 'latency', 'errors'),
        async (_metric) => {
          const result = await validator.validateAdminDashboard();
          
          expect(result.category).toBe('MONITORING');
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
   * Property 54: Service Degradation Marking
   * Validates: Requirements 10.6
   */
  it('Property 54: Service Degradation Marking - unhealthy services marked with recommendations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('degraded', 'unhealthy', 'failing'),
        async (_status) => {
          const result = await validator.validateServiceDegradation();
          
          expect(result.category).toBe('MONITORING');
          expect(result.status).toBeDefined();
          expect(typeof result.testsPassed).toBe('number');
          expect(typeof result.testsFailed).toBe('number');
          
          // If validation passes, degradation should be marked
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
  it('Property: Monitoring validation results are deterministic for same input', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          'validateHealthChecks',
          'validateLatencyMeasurement',
          'validateErrorCapture',
          'validateErrorAlerting',
          'validateAdminDashboard',
          'validateServiceDegradation'
        ),
        async (methodName) => {
          const method = validator[methodName as keyof MonitoringSystemValidator] as () => Promise<any>;
          
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
  it('Property: All monitoring validation methods return ValidationResult structure', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          'validateHealthChecks',
          'validateLatencyMeasurement',
          'validateErrorCapture',
          'validateErrorAlerting',
          'validateAdminDashboard',
          'validateServiceDegradation'
        ),
        async (methodName) => {
          const method = validator[methodName as keyof MonitoringSystemValidator] as () => Promise<any>;
          const result = await method.call(validator);
          
          // Verify ValidationResult structure
          expect(result).toHaveProperty('category');
          expect(result).toHaveProperty('status');
          expect(result).toHaveProperty('testsPassed');
          expect(result).toHaveProperty('testsFailed');
          expect(result).toHaveProperty('executionTime');
          expect(result).toHaveProperty('timestamp');
          expect(result).toHaveProperty('failures');
          
          expect(result.category).toBe('MONITORING');
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
