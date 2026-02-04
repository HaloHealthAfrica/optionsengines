/**
 * Test Report Generator Tests
 * 
 * Tests the test reporting functionality including:
 * - Report completeness (all required fields)
 * - Failure reporting with reproduction steps
 * - Coverage metrics calculation
 * - Performance metrics calculation
 * 
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6
 */

import * as fc from 'fast-check';
import {
  TestReportGenerator,
  PhaseResult,
  FailureDetails,
  DeterminismResult
} from './test-report-generator';

describe('Test Report Generator', () => {
  let generator: TestReportGenerator;

  beforeEach(() => {
    generator = new TestReportGenerator();
  });

  describe('Property 29: Test Report Completeness', () => {
    /**
     * Property 29: Test Report Completeness
     * 
     * For any completed test run, the generated report must include:
     * - Pass/fail status for all test phases
     * - Coverage metrics for all requirements
     * - Performance metrics including latency measurements
     * - Determinism validation results (if multiple runs were performed)
     * 
     * Validates: Requirements 15.1, 15.2, 15.5, 15.6
     */
    it('should generate complete reports with all required fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            phaseCount: fc.integer({ min: 1, max: 12 }),
            hasFailures: fc.boolean(),
            hasDeterminismResults: fc.boolean(),
            latencyCount: fc.integer({ min: 0, max: 100 })
          }),
          async (scenario) => {
            const runGenerator = new TestReportGenerator();
            // Generate phase results
            for (let i = 0; i < scenario.phaseCount; i++) {
              const phaseResult: PhaseResult = {
                phase: `Phase ${i + 1}`,
                phaseNumber: i + 1,
                passed: !scenario.hasFailures || i % 2 === 0,
                totalTests: 10,
                passedTests: scenario.hasFailures && i % 2 === 1 ? 8 : 10,
                failedTests: scenario.hasFailures && i % 2 === 1 ? 2 : 0,
                skippedTests: 0,
                executionTime: 1000 + i * 100,
                validationResults: [
                  {
                    passed: true,
                    phase: `Phase ${i + 1}`,
                    requirement: `Property ${i + 1}`,
                    message: 'Validation passed',
                    details: {}
                  }
                ],
                requirementsCovered: [`${i + 1}`]
              };
              runGenerator.addPhaseResult(phaseResult);
            }

            // Add failures if needed
            if (scenario.hasFailures) {
              const failure: FailureDetails = {
                testName: 'Test Failure Example',
                phase: 'Phase 2',
                requirement: 'Property 5',
                message: 'Expected value did not match actual',
                expected: { value: 10 },
                actual: { value: 8 },
                reproductionSteps: [
                  'Generate webhook with scenario X',
                  'Inject webhook into system',
                  'Capture state',
                  'Validate result'
                ]
              };
              runGenerator.addFailure(failure);
            }

            // Add latency measurements
            for (let i = 0; i < scenario.latencyCount; i++) {
              runGenerator.addLatencyMeasurement(50 + i * 2);
            }

            // Add determinism results if needed
            if (scenario.hasDeterminismResults) {
              const determinismResult: DeterminismResult = {
                passed: true,
                runsCompared: 3,
                violations: []
              };
              runGenerator.addDeterminismResult(determinismResult);
            }

            // Generate report
            const report = runGenerator.generateReport();

            // Property assertions: Report must be complete
            expect(report).toBeDefined();
            expect(report.generatedAt).toBeGreaterThan(0);
            expect(report.overallPassed).toBeDefined();
            expect(report.totalTests).toBeGreaterThan(0);
            expect(report.totalPassed).toBeGreaterThanOrEqual(0);
            expect(report.totalFailed).toBeGreaterThanOrEqual(0);
            expect(report.totalSkipped).toBeGreaterThanOrEqual(0);

            // Phase results must be present
            expect(report.phaseResults).toBeDefined();
            expect(report.phaseResults.length).toBe(scenario.phaseCount);

            // Coverage metrics must be present
            expect(report.coverage).toBeDefined();
            expect(report.coverage.totalRequirements).toBe(15);
            expect(report.coverage.coveredRequirements).toBeGreaterThanOrEqual(0);
            expect(report.coverage.coveragePercentage).toBeGreaterThanOrEqual(0);
            expect(report.coverage.coveragePercentage).toBeLessThanOrEqual(100);
            expect(report.coverage.totalProperties).toBe(30);
            expect(report.coverage.testedProperties).toBeGreaterThanOrEqual(0);
            expect(report.coverage.propertyCoveragePercentage).toBeGreaterThanOrEqual(0);
            expect(report.coverage.propertyCoveragePercentage).toBeLessThanOrEqual(100);

            // Performance metrics must be present
            expect(report.performance).toBeDefined();
            expect(report.performance.averageLatency).toBeGreaterThanOrEqual(0);
            expect(report.performance.minLatency).toBeGreaterThanOrEqual(0);
            expect(report.performance.maxLatency).toBeGreaterThanOrEqual(0);
            expect(report.performance.totalExecutionTime).toBeGreaterThan(0);

            // Determinism results must be present
            expect(report.determinism).toBeDefined();
            expect(report.determinism.passed).toBeDefined();
            expect(report.determinism.runsCompared).toBeGreaterThanOrEqual(0);

            // Failures must be present if there were failures
            expect(report.failures).toBeDefined();
            if (scenario.hasFailures) {
              expect(report.failures.length).toBeGreaterThan(0);
            }

            // Summary must be present
            expect(report.summary).toBeDefined();
            expect(report.summary.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100, seed: 290 }
      );
    });
  });

  describe('Property 30: Test Failure Reporting', () => {
    /**
     * Property 30: Test Failure Reporting
     * 
     * For any test failure, the report must provide:
     * - Detailed failure information including expected vs actual behavior
     * - Reproduction steps using Synthetic_Data
     * - Failure context (phase, requirement, test name)
     * 
     * Validates: Requirements 15.3, 15.4
     */
    it('should provide detailed failure information with reproduction steps', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            failureCount: fc.integer({ min: 1, max: 10 }),
            includeStackTrace: fc.boolean(),
            includeSyntheticData: fc.boolean()
          }),
          async (scenario) => {
            const runGenerator = new TestReportGenerator();
            // Add a passing phase first
            const passingPhase: PhaseResult = {
              phase: 'Phase 1',
              phaseNumber: 1,
              passed: true,
              totalTests: 10,
              passedTests: 10,
              failedTests: 0,
              skippedTests: 0,
              executionTime: 1000,
              validationResults: [],
              requirementsCovered: ['1']
            };
            runGenerator.addPhaseResult(passingPhase);

            // Add failures
            for (let i = 0; i < scenario.failureCount; i++) {
              const failure: FailureDetails = {
                testName: `Test Failure ${i + 1}`,
                phase: `Phase ${(i % 12) + 1}`,
                requirement: `Property ${(i % 30) + 1}`,
                message: `Failure message ${i + 1}`,
                expected: { value: 100 + i },
                actual: { value: 90 + i },
                stackTrace: scenario.includeStackTrace ? `Error stack trace ${i}` : undefined,
                reproductionSteps: [
                  `Step 1: Setup test environment`,
                  `Step 2: Generate synthetic data with seed ${i}`,
                  `Step 3: Inject data into system`,
                  `Step 4: Capture state`,
                  `Step 5: Validate against expectation`
                ],
                syntheticData: scenario.includeSyntheticData ? {
                  webhook: { symbol: 'SPY', pattern: 'ORB_BREAKOUT' }
                } : undefined
              };
              runGenerator.addFailure(failure);
            }

            // Generate report
            const report = runGenerator.generateReport();

            // Property assertions: Failure reporting must be complete
            expect(report.failures).toBeDefined();
            expect(report.failures.length).toBe(scenario.failureCount);

            for (const failure of report.failures) {
              // Test name must be present
              expect(failure.testName).toBeDefined();
              expect(failure.testName.length).toBeGreaterThan(0);

              // Phase must be present
              expect(failure.phase).toBeDefined();
              expect(failure.phase.length).toBeGreaterThan(0);

              // Requirement must be present
              expect(failure.requirement).toBeDefined();
              expect(failure.requirement.length).toBeGreaterThan(0);

              // Failure message must be present
              expect(failure.message).toBeDefined();
              expect(failure.message.length).toBeGreaterThan(0);

              // Expected and actual values must be present
              expect(failure.expected).toBeDefined();
              expect(failure.actual).toBeDefined();

              // Reproduction steps must be present and non-empty
              expect(failure.reproductionSteps).toBeDefined();
              expect(failure.reproductionSteps.length).toBeGreaterThan(0);
              for (const step of failure.reproductionSteps) {
                expect(step.length).toBeGreaterThan(0);
              }

              // Stack trace should be present if included
              if (scenario.includeStackTrace) {
                expect(failure.stackTrace).toBeDefined();
              }

              // Synthetic data should be present if included
              if (scenario.includeSyntheticData) {
                expect(failure.syntheticData).toBeDefined();
              }
            }

            // Overall status should be failed
            expect(report.overallPassed).toBe(false);
            expect(report.totalFailed).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100, seed: 300 }
      );
    });
  });

  describe('Unit Tests: Report Generation Scenarios', () => {
    it('should generate report with all passing tests', () => {
      // Add multiple passing phases
      for (let i = 0; i < 5; i++) {
        const phase: PhaseResult = {
          phase: `Phase ${i + 1}`,
          phaseNumber: i + 1,
          passed: true,
          totalTests: 10,
          passedTests: 10,
          failedTests: 0,
          skippedTests: 0,
          executionTime: 1000,
          validationResults: [],
          requirementsCovered: [`${i + 1}`]
        };
        generator.addPhaseResult(phase);
      }

      const report = generator.generateReport();

      expect(report.overallPassed).toBe(true);
      expect(report.totalTests).toBe(50);
      expect(report.totalPassed).toBe(50);
      expect(report.totalFailed).toBe(0);
      expect(report.failures.length).toBe(0);
      expect(report.summary).toContain('All');
      expect(report.summary).toContain('passed');
    });

    it('should generate report with failures', () => {
      // Add passing phase
      const passingPhase: PhaseResult = {
        phase: 'Phase 1',
        phaseNumber: 1,
        passed: true,
        totalTests: 10,
        passedTests: 10,
        failedTests: 0,
        skippedTests: 0,
        executionTime: 1000,
        validationResults: [],
        requirementsCovered: ['1']
      };
      generator.addPhaseResult(passingPhase);

      // Add failing phase
      const failingPhase: PhaseResult = {
        phase: 'Phase 2',
        phaseNumber: 2,
        passed: false,
        totalTests: 10,
        passedTests: 8,
        failedTests: 2,
        skippedTests: 0,
        executionTime: 1000,
        validationResults: [],
        requirementsCovered: ['2']
      };
      generator.addPhaseResult(failingPhase);

      // Add failure details
      const failure: FailureDetails = {
        testName: 'Property Test Failure',
        phase: 'Phase 2',
        requirement: 'Property 5',
        message: 'Expected idempotency but found duplicate processing',
        expected: { processingCount: 1 },
        actual: { processingCount: 2 },
        reproductionSteps: [
          'Generate webhook with seed 42',
          'Send webhook twice',
          'Verify processing count'
        ]
      };
      generator.addFailure(failure);

      const report = generator.generateReport();

      expect(report.overallPassed).toBe(false);
      expect(report.totalTests).toBe(20);
      expect(report.totalPassed).toBe(18);
      expect(report.totalFailed).toBe(2);
      expect(report.failures.length).toBe(1);
      expect(report.summary).toContain('failed');
    });

    it('should calculate coverage metrics correctly', () => {
      // Add phases covering different requirements
      const requirements = ['1', '2', '3', '4', '5'];
      for (let i = 0; i < requirements.length; i++) {
        const phase: PhaseResult = {
          phase: `Phase ${i + 1}`,
          phaseNumber: i + 1,
          passed: true,
          totalTests: 10,
          passedTests: 10,
          failedTests: 0,
          skippedTests: 0,
          executionTime: 1000,
          validationResults: [
            {
              passed: true,
              phase: `Phase ${i + 1}`,
              requirement: `Property ${i + 1}`,
              message: 'Passed',
              details: {}
            }
          ],
          requirementsCovered: [requirements[i]]
        };
        generator.addPhaseResult(phase);
      }

      const report = generator.generateReport();

      expect(report.coverage.totalRequirements).toBe(15);
      expect(report.coverage.coveredRequirements).toBe(5);
      expect(report.coverage.coveragePercentage).toBeCloseTo(33.33, 1);
      expect(report.coverage.totalProperties).toBe(30);
      expect(report.coverage.testedProperties).toBe(5);
      expect(report.coverage.propertyCoveragePercentage).toBeCloseTo(16.67, 1);
    });

    it('should calculate performance metrics correctly', () => {
      // Add latency measurements
      const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      for (const latency of latencies) {
        generator.addLatencyMeasurement(latency);
      }

      // Add phase for execution time
      const phase: PhaseResult = {
        phase: 'Phase 1',
        phaseNumber: 1,
        passed: true,
        totalTests: 10,
        passedTests: 10,
        failedTests: 0,
        skippedTests: 0,
        executionTime: 5000,
        validationResults: [],
        requirementsCovered: ['1']
      };
      generator.addPhaseResult(phase);

      const report = generator.generateReport();

      expect(report.performance.averageLatency).toBe(55);
      expect(report.performance.minLatency).toBe(10);
      expect(report.performance.maxLatency).toBe(100);
      expect(report.performance.p50Latency).toBe(50);
      expect(report.performance.totalExecutionTime).toBe(5000);
      expect(report.performance.latencyMeasurements.length).toBe(10);
    });

    it('should format report as text correctly', () => {
      const phase: PhaseResult = {
        phase: 'Phase 1',
        phaseNumber: 1,
        passed: true,
        totalTests: 10,
        passedTests: 10,
        failedTests: 0,
        skippedTests: 0,
        executionTime: 1000,
        validationResults: [],
        requirementsCovered: ['1']
      };
      generator.addPhaseResult(phase);

      const report = generator.generateReport();
      const text = generator.formatAsText(report);

      expect(text).toContain('E2E TEST REPORT');
      expect(text).toContain('SUMMARY');
      expect(text).toContain('COVERAGE');
      expect(text).toContain('PERFORMANCE');
      expect(text).toContain('DETERMINISM');
      expect(text).toContain('PHASE RESULTS');
      expect(text).toContain('Phase 1');
    });

    it('should format report as JSON correctly', () => {
      const phase: PhaseResult = {
        phase: 'Phase 1',
        phaseNumber: 1,
        passed: true,
        totalTests: 10,
        passedTests: 10,
        failedTests: 0,
        skippedTests: 0,
        executionTime: 1000,
        validationResults: [],
        requirementsCovered: ['1']
      };
      generator.addPhaseResult(phase);

      const report = generator.generateReport();
      const json = generator.formatAsJSON(report);

      expect(json).toBeDefined();
      const parsed = JSON.parse(json);
      expect(parsed.overallPassed).toBe(true);
      expect(parsed.totalTests).toBe(10);
      expect(parsed.phaseResults.length).toBe(1);
    });

    it('should format report as HTML correctly', () => {
      const phase: PhaseResult = {
        phase: 'Phase 1',
        phaseNumber: 1,
        passed: true,
        totalTests: 10,
        passedTests: 10,
        failedTests: 0,
        skippedTests: 0,
        executionTime: 1000,
        validationResults: [],
        requirementsCovered: ['1']
      };
      generator.addPhaseResult(phase);

      const report = generator.generateReport();
      const html = generator.formatAsHTML(report);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>E2E Test Report</title>');
      expect(html).toContain('E2E Test Report');
      expect(html).toContain('PASSED');
      expect(html).toContain('Coverage');
      expect(html).toContain('Performance');
      expect(html).toContain('Phase 1');
    });
  });
});
