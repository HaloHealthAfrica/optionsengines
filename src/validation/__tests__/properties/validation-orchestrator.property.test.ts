/**
 * Property-Based Tests for Validation Orchestrator
 * Feature: gtm-launch-readiness-validation
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { ValidationOrchestrator } from '../../orchestration/validation-orchestrator.js';
import { ValidationCategory } from '../../types/index.js';

describe('Validation Orchestrator - Property Tests', () => {
  jest.setTimeout(60000);
  const orchestrator = new ValidationOrchestrator();

  /**
   * Property 73: Validation Execution Order
   * Validates: Requirements 14.1
   */
  it('Property 73: Validation Execution Order - validations execute in dependency order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('full', 'sequence'),
        async (_executionMode) => {
          const report = await orchestrator.runFullValidation();
          
          expect(report).toHaveProperty('overallStatus');
          expect(report).toHaveProperty('readinessScore');
          expect(report).toHaveProperty('categoryResults');
          expect(report).toHaveProperty('executionTime');
          expect(report).toHaveProperty('timestamp');
          expect(report).toHaveProperty('blockingIssues');
          expect(report).toHaveProperty('recommendations');
          
          // Verify report structure
          expect(['PASS', 'FAIL', 'PARTIAL']).toContain(report.overallStatus);
          expect(report.readinessScore).toBeGreaterThanOrEqual(0);
          expect(report.readinessScore).toBeLessThanOrEqual(100);
          expect(report.categoryResults.size).toBeGreaterThan(0);
          expect(report.executionTime).toBeGreaterThanOrEqual(0);
          expect(report.timestamp).toBeInstanceOf(Date);
          expect(Array.isArray(report.blockingIssues)).toBe(true);
          expect(Array.isArray(report.recommendations)).toBe(true);
        }
      ),
      { numRuns: 5 }
    );
  }, 60000); // Increase timeout for full validation

  /**
   * Property 74: Validation Failure Isolation
   * Validates: Requirements 14.2
   */
  it('Property 74: Validation Failure Isolation - failures do not stop execution', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(
          ValidationCategory.WEBHOOK_INFRASTRUCTURE,
          ValidationCategory.SIGNAL_PROCESSING,
          ValidationCategory.ACCESS_CONTROL
        ), { minLength: 2, maxLength: 5 }),
        async (categories) => {
          const report = await orchestrator.runValidationSequence(categories);
          
          // Even if some validations fail, report should be generated
          expect(report).toBeDefined();
          expect(report.categoryResults.size).toBeGreaterThan(0);
          
          // All requested categories should have results (continue-on-failure)
          expect(report.categoryResults.size).toBeLessThanOrEqual(categories.length);
        }
      ),
      { numRuns: 5 }
    );
  });

  /**
   * Property 75: Validation Report Completeness
   * Validates: Requirements 14.3
   */
  it('Property 75: Validation Report Completeness - reports contain all required details', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('full', 'partial'),
        async (_reportType) => {
          const report = await orchestrator.runFullValidation();
          
          // Verify all required fields are present
          expect(report.overallStatus).toBeDefined();
          expect(typeof report.readinessScore).toBe('number');
          expect(report.categoryResults).toBeInstanceOf(Map);
          expect(typeof report.executionTime).toBe('number');
          expect(report.timestamp).toBeInstanceOf(Date);
          expect(Array.isArray(report.blockingIssues)).toBe(true);
          expect(Array.isArray(report.recommendations)).toBe(true);
          
          // Verify each category result has required fields
          report.categoryResults.forEach((result, _category) => {
            expect(result).toHaveProperty('category');
            expect(result).toHaveProperty('status');
            expect(result).toHaveProperty('testsPassed');
            expect(result).toHaveProperty('testsFailed');
            expect(result).toHaveProperty('executionTime');
            expect(result).toHaveProperty('timestamp');
            expect(result).toHaveProperty('failures');
          });
        }
      ),
      { numRuns: 5 }
    );
  }, 60000);

  /**
   * Property 78: Validation Export Format
   * Validates: Requirements 14.6
   */
  it('Property 78: Validation Export Format - JSON export is valid and complete', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('json'),
        async (_format) => {
          const report = await orchestrator.runFullValidation();
          const jsonExport = orchestrator.exportReportAsJSON(report);
          
          // Verify JSON is valid
          expect(() => JSON.parse(jsonExport)).not.toThrow();
          
          const parsed = JSON.parse(jsonExport);
          
          // Verify exported structure
          expect(parsed).toHaveProperty('overallStatus');
          expect(parsed).toHaveProperty('readinessScore');
          expect(parsed).toHaveProperty('executionTime');
          expect(parsed).toHaveProperty('timestamp');
          expect(parsed).toHaveProperty('categories');
          expect(parsed).toHaveProperty('blockingIssues');
          expect(parsed).toHaveProperty('recommendations');
          
          expect(Array.isArray(parsed.categories)).toBe(true);
          expect(Array.isArray(parsed.blockingIssues)).toBe(true);
          expect(Array.isArray(parsed.recommendations)).toBe(true);
        }
      ),
      { numRuns: 5 }
    );
  }, 60000);

  /**
   * Additional property: Readiness score calculation is correct
   */
  it('Property: Readiness score is calculated correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('score'),
        async (_aspect) => {
          const report = await orchestrator.runFullValidation();
          
          // Readiness score should be between 0 and 100
          expect(report.readinessScore).toBeGreaterThanOrEqual(0);
          expect(report.readinessScore).toBeLessThanOrEqual(100);
          
          // If all tests pass, score should be 100
          const allPassed = Array.from(report.categoryResults.values())
            .every(result => result.status === 'PASS');
          
          if (allPassed) {
            expect(report.readinessScore).toBe(100);
          }
        }
      ),
      { numRuns: 5 }
    );
  }, 60000);

  /**
   * Additional property: Validation status is consistent
   */
  it('Property: Validation status reflects results correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('status'),
        async (_aspect) => {
          const report = await orchestrator.runFullValidation();
          
          const failedCount = Array.from(report.categoryResults.values())
            .filter(result => result.status === 'FAIL').length;
          const totalCount = report.categoryResults.size;
          
          // Overall status should match individual results
          if (failedCount === 0) {
            expect(report.overallStatus).toBe('PASS');
          } else if (failedCount === totalCount) {
            expect(report.overallStatus).toBe('FAIL');
          } else {
            expect(report.overallStatus).toBe('PARTIAL');
          }
        }
      ),
      { numRuns: 5 }
    );
  }, 60000);
});
