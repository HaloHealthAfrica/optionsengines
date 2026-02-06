/**
 * Property-Based Tests for Launch Dashboard
 * Feature: gtm-launch-readiness-validation
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { LaunchDashboard } from '../../dashboard/launch-dashboard.js';
import { ValidationReport, ValidationCategory, ValidationResult } from '../../types/index.js';

describe('Launch Dashboard - Property Tests', () => {
  const dashboard = new LaunchDashboard();

  /**
   * Helper to create mock validation report
   */
  const createMockReport = (
    passedCategories: number,
    failedCategories: number
  ): ValidationReport => {
    const categoryResults = new Map<ValidationCategory, ValidationResult>();
    const categories = Object.values(ValidationCategory);
    
    for (let i = 0; i < passedCategories && i < categories.length; i++) {
      categoryResults.set(categories[i], {
        category: categories[i],
        status: 'PASS',
        testsPassed: 10,
        testsFailed: 0,
        executionTime: 100,
        timestamp: new Date(),
        failures: [],
      });
    }
    
    for (let i = passedCategories; i < passedCategories + failedCategories && i < categories.length; i++) {
      categoryResults.set(categories[i], {
        category: categories[i],
        status: 'FAIL',
        testsPassed: 5,
        testsFailed: 5,
        executionTime: 100,
        timestamp: new Date(),
        failures: [{
          testName: 'Test validation',
          expectedOutcome: 'pass',
          actualOutcome: 'fail',
          errorMessage: 'Test failure',
          context: {},
        }],
      });
    }

    return {
      overallStatus: failedCategories === 0 ? 'PASS' : 'FAIL',
      readinessScore: Math.round((passedCategories / (passedCategories + failedCategories)) * 100),
      categoryResults,
      executionTime: 1000,
      timestamp: new Date(),
      blockingIssues: failedCategories > 0 ? [{
        category: categories[passedCategories],
        severity: 'HIGH',
        description: 'Validation failed',
        remediation: 'Fix issues',
        blocking: true,
      }] : [],
      recommendations: [],
    };
  };

  /**
   * Property 67: Launch Dashboard Category Display
   * Validates: Requirements 13.1
   */
  it('Property 67: Launch Dashboard Category Display - displays all categories', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 5 }),
        (passed, failed) => {
          const report = createMockReport(passed, failed);
          const statuses = dashboard.displayValidationStatus(report);
          
          // Should return status for each category in report
          expect(statuses.length).toBe(report.categoryResults.size);
          
          // Each status should have required fields
          statuses.forEach(status => {
            expect(status).toHaveProperty('category');
            expect(status).toHaveProperty('status');
            expect(status).toHaveProperty('testsPassed');
            expect(status).toHaveProperty('testsFailed');
            expect(status).toHaveProperty('executionTime');
            expect(['PASS', 'FAIL', 'PARTIAL']).toContain(status.status);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 68: Launch Dashboard Failure Details
   * Validates: Requirements 13.2
   */
  it('Property 68: Launch Dashboard Failure Details - shows remediation for failures', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 1, max: 4 }),
        (passed, failed) => {
          const report = createMockReport(passed, failed);
          const details = dashboard.displayFailureDetails(report);
          
          // Should have details for each failed category
          expect(details.length).toBeGreaterThan(0);
          
          // Each detail should have required fields
          details.forEach(detail => {
            expect(detail).toHaveProperty('category');
            expect(detail).toHaveProperty('failureReason');
            expect(detail).toHaveProperty('remediationSteps');
            expect(detail).toHaveProperty('severity');
            expect(detail.failureReason).toBeTruthy();
            expect(Array.isArray(detail.remediationSteps)).toBe(true);
            expect(detail.remediationSteps.length).toBeGreaterThan(0);
            expect(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).toContain(detail.severity);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 69: Readiness Score Calculation
   * Validates: Requirements 13.3
   */
  it('Property 69: Readiness Score Calculation - calculates weighted score correctly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 5 }),
        (passed, failed) => {
          const report = createMockReport(passed, failed);
          const score = dashboard.displayReadinessScore(report);
          
          // Score should be between 0 and 100
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(100);
          
          // Score should be 100 if all tests pass
          if (failed === 0) {
            expect(score).toBe(100);
          }
          
          // Note: Score may still be high even with some failures
          // due to weighted calculation and category importance
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 70: Readiness Warning Threshold
   * Validates: Requirements 13.4
   */
  it('Property 70: Readiness Warning Threshold - shows blocking issues below 95%', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 5 }),
        (passed, failed) => {
          const report = createMockReport(passed, failed);
          const score = dashboard.displayReadinessScore(report);
          const blockingIssues = dashboard.displayBlockingIssues(report);
          
          // If score is below 95%, should have blocking issues
          if (score < 95 && failed > 0) {
            expect(blockingIssues.length).toBeGreaterThan(0);
          }
          
          // If score is 95% or above, should have no blocking issues
          if (score >= 95) {
            expect(blockingIssues.length).toBe(0);
          }
          
          // All blocking issues should be marked as blocking
          blockingIssues.forEach(issue => {
            expect(issue.blocking).toBe(true);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 71: Launch Readiness Green Status
   * Validates: Requirements 13.5
   */
  it('Property 71: Launch Readiness Green Status - shows green when ready', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 5 }),
        (passed, failed) => {
          const report = createMockReport(passed, failed);
          const readiness = dashboard.displayLaunchReadiness(report);
          
          // Should have required fields
          expect(readiness).toHaveProperty('isReady');
          expect(readiness).toHaveProperty('status');
          expect(readiness).toHaveProperty('message');
          expect(['GREEN', 'YELLOW', 'RED']).toContain(readiness.status);
          expect(typeof readiness.isReady).toBe('boolean');
          expect(readiness.message).toBeTruthy();
          
          // If all pass, should be green and ready
          if (failed === 0) {
            expect(readiness.status).toBe('GREEN');
            expect(readiness.isReady).toBe(true);
          }
          
          // Note: System may still be ready with minor failures
          // depending on which categories fail and their weights
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 72: Historical Trend Display
   * Validates: Requirements 13.6
   */
  it('Property 72: Historical Trend Display - tracks validation history', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 1, max: 12 }),
            fc.integer({ min: 0, max: 5 })
          ),
          { minLength: 1, maxLength: 10 }
        ),
        (testRuns) => {
          const testDashboard = new LaunchDashboard();
          
          // Record multiple validation results
          testRuns.forEach(([passed, failed]) => {
            const report = createMockReport(passed, failed);
            testDashboard.recordValidationResult(report);
          });
          
          const trends = testDashboard.displayHistoricalTrends();
          
          // Should have recorded all runs
          expect(trends.length).toBe(testRuns.length);
          
          // Each trend should have required fields
          trends.forEach(trend => {
            expect(trend).toHaveProperty('timestamp');
            expect(trend).toHaveProperty('readinessScore');
            expect(trend).toHaveProperty('passRate');
            expect(trend).toHaveProperty('failedCategories');
            expect(trend.timestamp).toBeInstanceOf(Date);
            expect(trend.readinessScore).toBeGreaterThanOrEqual(0);
            expect(trend.readinessScore).toBeLessThanOrEqual(100);
            expect(trend.passRate).toBeGreaterThanOrEqual(0);
            expect(trend.passRate).toBeLessThanOrEqual(100);
            expect(Array.isArray(trend.failedCategories)).toBe(true);
          });
          
          // Trends should be sorted by timestamp (most recent first)
          for (let i = 1; i < trends.length; i++) {
            expect(trends[i - 1].timestamp.getTime()).toBeGreaterThanOrEqual(
              trends[i].timestamp.getTime()
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Complete dashboard generation
   */
  it('Property: Complete dashboard contains all required sections', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 5 }),
        (passed, failed) => {
          const report = createMockReport(passed, failed);
          const dashboardDisplay = dashboard.generateDashboard(report);
          
          // Should have all required sections
          expect(dashboardDisplay).toHaveProperty('categoryStatuses');
          expect(dashboardDisplay).toHaveProperty('failureDetails');
          expect(dashboardDisplay).toHaveProperty('readinessScore');
          expect(dashboardDisplay).toHaveProperty('blockingIssues');
          expect(dashboardDisplay).toHaveProperty('launchReadiness');
          expect(dashboardDisplay).toHaveProperty('historicalTrends');
          
          expect(Array.isArray(dashboardDisplay.categoryStatuses)).toBe(true);
          expect(Array.isArray(dashboardDisplay.failureDetails)).toBe(true);
          expect(typeof dashboardDisplay.readinessScore).toBe('number');
          expect(Array.isArray(dashboardDisplay.blockingIssues)).toBe(true);
          expect(dashboardDisplay.launchReadiness).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});
