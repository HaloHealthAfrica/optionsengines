/**
 * Tests for validation framework types
 * 
 * Verifies that core types are properly defined and exported
 */

import {
  ValidationCategory,
  ValidationStatus,
  ValidationResult,
  ValidationReport,
  Issue,
} from '../types/index.js';

describe('Validation Framework Types', () => {
  describe('ValidationCategory enum', () => {
    it('should have all required validation categories', () => {
      const categories = Object.values(ValidationCategory);
      
      expect(categories).toContain('WEBHOOK_INFRASTRUCTURE');
      expect(categories).toContain('SIGNAL_PROCESSING');
      expect(categories).toContain('ENGINE_A');
      expect(categories).toContain('ENGINE_B');
      expect(categories).toContain('STRIKE_SELECTION');
      expect(categories).toContain('STRATEGY_ROUTING');
      expect(categories).toContain('SIGNAL_DELIVERY');
      expect(categories).toContain('PERFORMANCE_TRACKING');
      expect(categories).toContain('ACCESS_CONTROL');
      expect(categories).toContain('MONITORING');
      expect(categories).toContain('END_TO_END');
      expect(categories).toContain('KILL_SWITCHES');
    });

    it('should have exactly 12 validation categories', () => {
      const categories = Object.values(ValidationCategory);
      expect(categories).toHaveLength(12);
    });
  });

  describe('ValidationResult interface', () => {
    it('should create a valid validation result', () => {
      const result: ValidationResult = {
        category: ValidationCategory.WEBHOOK_INFRASTRUCTURE,
        status: 'PASS',
        testsPassed: 10,
        testsFailed: 0,
        executionTime: 1000,
        timestamp: new Date(),
        failures: [],
      };

      expect(result.category).toBe(ValidationCategory.WEBHOOK_INFRASTRUCTURE);
      expect(result.status).toBe('PASS');
      expect(result.testsPassed).toBe(10);
      expect(result.testsFailed).toBe(0);
    });

    it('should support failure status with failure details', () => {
      const result: ValidationResult = {
        category: ValidationCategory.SIGNAL_PROCESSING,
        status: 'FAIL',
        testsPassed: 5,
        testsFailed: 2,
        executionTime: 2000,
        timestamp: new Date(),
        failures: [
          {
            testName: 'field-extraction',
            expectedOutcome: 'all fields extracted',
            actualOutcome: 'missing confidence field',
            errorMessage: 'Confidence field not found',
            context: { payload: {} },
          },
        ],
      };

      expect(result.status).toBe('FAIL');
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].testName).toBe('field-extraction');
    });
  });

  describe('ValidationReport interface', () => {
    it('should create a valid validation report', () => {
      const report: ValidationReport = {
        overallStatus: 'PASS',
        readinessScore: 95,
        categoryResults: new Map(),
        executionTime: 5000,
        timestamp: new Date(),
        blockingIssues: [],
        recommendations: [],
      };

      expect(report.overallStatus).toBe('PASS');
      expect(report.readinessScore).toBe(95);
      expect(report.categoryResults).toBeInstanceOf(Map);
    });

    it('should support blocking issues', () => {
      const issue: Issue = {
        category: ValidationCategory.WEBHOOK_INFRASTRUCTURE,
        severity: 'CRITICAL',
        description: 'Webhook URL not configured',
        remediation: 'Configure production webhook URL in environment variables',
        blocking: true,
      };

      const report: ValidationReport = {
        overallStatus: 'FAIL',
        readinessScore: 60,
        categoryResults: new Map(),
        executionTime: 5000,
        timestamp: new Date(),
        blockingIssues: [issue],
        recommendations: ['Fix webhook configuration before launch'],
      };

      expect(report.blockingIssues).toHaveLength(1);
      expect(report.blockingIssues[0].blocking).toBe(true);
      expect(report.blockingIssues[0].severity).toBe('CRITICAL');
    });
  });

  describe('Type safety', () => {
    it('should enforce valid status values', () => {
      const validStatuses: ValidationStatus[] = ['PASS', 'FAIL', 'PARTIAL', 'RUNNING'];
      
      validStatuses.forEach(status => {
        expect(['PASS', 'FAIL', 'PARTIAL', 'RUNNING']).toContain(status);
      });
    });

    it('should enforce valid severity levels', () => {
      const issue: Issue = {
        category: ValidationCategory.MONITORING,
        severity: 'HIGH',
        description: 'Test issue',
        remediation: 'Test remediation',
        blocking: false,
      };

      expect(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).toContain(issue.severity);
    });
  });
});
