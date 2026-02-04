/**
 * Test Report Generator
 * 
 * Generates comprehensive test reports including:
 * - Pass/fail status for all test phases
 * - Coverage metrics for all requirements
 * - Performance metrics including latency measurements
 * - Determinism validation results
 * - Detailed failure information with reproduction steps
 * 
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6
 */

import { ValidationResult } from '../validation/validation-framework';

/**
 * Test phase result
 */
export interface PhaseResult {
  /** Phase name */
  phase: string;
  
  /** Phase number */
  phaseNumber: number;
  
  /** Pass/fail status */
  passed: boolean;
  
  /** Total tests in phase */
  totalTests: number;
  
  /** Passed tests */
  passedTests: number;
  
  /** Failed tests */
  failedTests: number;
  
  /** Skipped tests */
  skippedTests: number;
  
  /** Execution time in milliseconds */
  executionTime: number;
  
  /** Validation results */
  validationResults: ValidationResult[];
  
  /** Requirements covered */
  requirementsCovered: string[];
}

/**
 * Coverage metrics
 */
export interface CoverageMetrics {
  /** Total requirements */
  totalRequirements: number;
  
  /** Covered requirements */
  coveredRequirements: number;
  
  /** Coverage percentage */
  coveragePercentage: number;
  
  /** Requirements by status */
  requirementsByStatus: {
    requirement: string;
    covered: boolean;
    testCount: number;
  }[];
  
  /** Total properties */
  totalProperties: number;
  
  /** Tested properties */
  testedProperties: number;
  
  /** Property coverage percentage */
  propertyCoveragePercentage: number;
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  /** Average latency in milliseconds */
  averageLatency: number;
  
  /** Minimum latency in milliseconds */
  minLatency: number;
  
  /** Maximum latency in milliseconds */
  maxLatency: number;
  
  /** P50 latency in milliseconds */
  p50Latency: number;
  
  /** P95 latency in milliseconds */
  p95Latency: number;
  
  /** P99 latency in milliseconds */
  p99Latency: number;
  
  /** Total test execution time in milliseconds */
  totalExecutionTime: number;
  
  /** Latency measurements */
  latencyMeasurements: number[];
}

/**
 * Determinism validation result
 */
export interface DeterminismResult {
  /** Whether determinism validation passed */
  passed: boolean;
  
  /** Number of runs compared */
  runsCompared: number;
  
  /** Determinism violations found */
  violations: {
    component: string;
    description: string;
    run1Value: any;
    run2Value: any;
  }[];
}

/**
 * Test failure details
 */
export interface FailureDetails {
  /** Test name */
  testName: string;
  
  /** Phase */
  phase: string;
  
  /** Requirement being validated */
  requirement: string;
  
  /** Failure message */
  message: string;
  
  /** Expected value */
  expected: any;
  
  /** Actual value */
  actual: any;
  
  /** Stack trace */
  stackTrace?: string;
  
  /** Reproduction steps */
  reproductionSteps: string[];
  
  /** Synthetic data used */
  syntheticData?: any;
}

/**
 * Complete test report
 */
export interface TestReport {
  /** Report generation timestamp */
  generatedAt: number;
  
  /** Overall pass/fail status */
  overallPassed: boolean;
  
  /** Total tests executed */
  totalTests: number;
  
  /** Total passed tests */
  totalPassed: number;
  
  /** Total failed tests */
  totalFailed: number;
  
  /** Total skipped tests */
  totalSkipped: number;
  
  /** Phase results */
  phaseResults: PhaseResult[];
  
  /** Coverage metrics */
  coverage: CoverageMetrics;
  
  /** Performance metrics */
  performance: PerformanceMetrics;
  
  /** Determinism results */
  determinism: DeterminismResult;
  
  /** Failure details */
  failures: FailureDetails[];
  
  /** Summary message */
  summary: string;
}

/**
 * Test Report Generator
 */
export class TestReportGenerator {
  private phaseResults: PhaseResult[] = [];
  private failures: FailureDetails[] = [];
  private latencyMeasurements: number[] = [];
  private determinismResults: DeterminismResult[] = [];

  /**
   * Add phase result
   */
  addPhaseResult(result: PhaseResult): void {
    this.phaseResults.push(result);
  }

  /**
   * Add failure
   */
  addFailure(failure: FailureDetails): void {
    this.failures.push(failure);
  }

  /**
   * Add latency measurement
   */
  addLatencyMeasurement(latency: number): void {
    this.latencyMeasurements.push(latency);
  }

  /**
   * Add determinism result
   */
  addDeterminismResult(result: DeterminismResult): void {
    this.determinismResults.push(result);
  }

  /**
   * Generate complete test report
   */
  generateReport(): TestReport {
    const totalTests = this.phaseResults.reduce((sum, phase) => sum + phase.totalTests, 0);
    const totalPassed = this.phaseResults.reduce((sum, phase) => sum + phase.passedTests, 0);
    const phaseFailed = this.phaseResults.reduce((sum, phase) => sum + phase.failedTests, 0);
    const totalFailed = Math.max(phaseFailed, this.failures.length);
    const totalSkipped = this.phaseResults.reduce((sum, phase) => sum + phase.skippedTests, 0);
    const overallPassed = totalFailed === 0 && this.failures.length === 0;

    const coverage = this.calculateCoverage();
    const performance = this.calculatePerformance();
    const determinism = this.aggregateDeterminism();

    const summary = this.generateSummary(overallPassed, totalTests, totalPassed, totalFailed, coverage);

    return {
      generatedAt: Date.now(),
      overallPassed,
      totalTests,
      totalPassed,
      totalFailed,
      totalSkipped,
      phaseResults: this.phaseResults,
      coverage,
      performance,
      determinism,
      failures: this.failures,
      summary
    };
  }

  /**
   * Calculate coverage metrics
   */
  private calculateCoverage(): CoverageMetrics {
    // All 15 requirements from the spec
    const allRequirements = [
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
      '11', '12', '13', '14', '15'
    ];

    // Extract covered requirements from phase results
    const coveredRequirementsSet = new Set<string>();
    const requirementTestCount = new Map<string, number>();

    for (const phase of this.phaseResults) {
      for (const req of phase.requirementsCovered) {
        coveredRequirementsSet.add(req);
        requirementTestCount.set(req, (requirementTestCount.get(req) || 0) + 1);
      }
    }

    const requirementsByStatus = allRequirements.map(req => ({
      requirement: req,
      covered: coveredRequirementsSet.has(req),
      testCount: requirementTestCount.get(req) || 0
    }));

    const totalRequirements = allRequirements.length;
    const coveredRequirements = coveredRequirementsSet.size;
    const coveragePercentage = (coveredRequirements / totalRequirements) * 100;

    // All 30 properties from the spec
    const totalProperties = 30;
    const testedProperties = this.countTestedProperties();
    const propertyCoveragePercentage = (testedProperties / totalProperties) * 100;

    return {
      totalRequirements,
      coveredRequirements,
      coveragePercentage,
      requirementsByStatus,
      totalProperties,
      testedProperties,
      propertyCoveragePercentage
    };
  }

  /**
   * Count tested properties
   */
  private countTestedProperties(): number {
    // Count unique properties tested based on validation results
    const testedProperties = new Set<string>();

    for (const phase of this.phaseResults) {
      for (const validation of phase.validationResults) {
        // Extract property number from requirement string
        const match = validation.requirement.match(/Property (\d+)/);
        if (match) {
          testedProperties.add(match[1]);
        }
      }
    }

    return testedProperties.size;
  }

  /**
   * Calculate performance metrics
   */
  private calculatePerformance(): PerformanceMetrics {
    if (this.latencyMeasurements.length === 0) {
      const totalExecutionTime = this.phaseResults.reduce((sum, phase) => sum + phase.executionTime, 0);
      return {
        averageLatency: 0,
        minLatency: 0,
        maxLatency: 0,
        p50Latency: 0,
        p95Latency: 0,
        p99Latency: 0,
        totalExecutionTime,
        latencyMeasurements: []
      };
    }

    const sorted = [...this.latencyMeasurements].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, val) => acc + val, 0);
    const averageLatency = sum / sorted.length;
    const minLatency = sorted[0];
    const maxLatency = sorted[sorted.length - 1];

    const p50Index = Math.floor((sorted.length - 1) * 0.5);
    const p95Index = Math.floor((sorted.length - 1) * 0.95);
    const p99Index = Math.floor((sorted.length - 1) * 0.99);

    const p50Latency = sorted[p50Index];
    const p95Latency = sorted[p95Index];
    const p99Latency = sorted[p99Index];

    const totalExecutionTime = this.phaseResults.reduce((sum, phase) => sum + phase.executionTime, 0);

    return {
      averageLatency,
      minLatency,
      maxLatency,
      p50Latency,
      p95Latency,
      p99Latency,
      totalExecutionTime,
      latencyMeasurements: this.latencyMeasurements
    };
  }

  /**
   * Aggregate determinism results
   */
  private aggregateDeterminism(): DeterminismResult {
    if (this.determinismResults.length === 0) {
      return {
        passed: true,
        runsCompared: 0,
        violations: []
      };
    }

    const allPassed = this.determinismResults.every(r => r.passed);
    const totalRuns = this.determinismResults.reduce((sum, r) => sum + r.runsCompared, 0);
    const allViolations = this.determinismResults.flatMap(r => r.violations);

    return {
      passed: allPassed,
      runsCompared: totalRuns,
      violations: allViolations
    };
  }

  /**
   * Generate summary message
   */
  private generateSummary(
    overallPassed: boolean,
    totalTests: number,
    totalPassed: number,
    totalFailed: number,
    coverage: CoverageMetrics
  ): string {
    if (overallPassed) {
      return `✓ All ${totalTests} tests passed. ` +
        `Coverage: ${coverage.coveragePercentage.toFixed(1)}% requirements, ` +
        `${coverage.propertyCoveragePercentage.toFixed(1)}% properties.`;
    } else {
      return `✗ ${totalFailed} of ${totalTests} tests failed. ` +
        `${totalPassed} tests passed. ` +
        `Coverage: ${coverage.coveragePercentage.toFixed(1)}% requirements, ` +
        `${coverage.propertyCoveragePercentage.toFixed(1)}% properties.`;
    }
  }

  /**
   * Format report as text
   */
  formatAsText(report: TestReport): string {
    const lines: string[] = [];

    lines.push('='.repeat(80));
    lines.push('E2E TEST REPORT');
    lines.push('='.repeat(80));
    lines.push('');
    lines.push(`Generated: ${new Date(report.generatedAt).toISOString()}`);
    lines.push(`Status: ${report.overallPassed ? '✓ PASSED' : '✗ FAILED'}`);
    lines.push('');

    // Summary
    lines.push('SUMMARY');
    lines.push('-'.repeat(80));
    lines.push(report.summary);
    lines.push(`Total Tests: ${report.totalTests}`);
    lines.push(`Passed: ${report.totalPassed}`);
    lines.push(`Failed: ${report.totalFailed}`);
    lines.push(`Skipped: ${report.totalSkipped}`);
    lines.push('');

    // Coverage
    lines.push('COVERAGE');
    lines.push('-'.repeat(80));
    lines.push(`Requirements: ${report.coverage.coveredRequirements}/${report.coverage.totalRequirements} (${report.coverage.coveragePercentage.toFixed(1)}%)`);
    lines.push(`Properties: ${report.coverage.testedProperties}/${report.coverage.totalProperties} (${report.coverage.propertyCoveragePercentage.toFixed(1)}%)`);
    lines.push('');

    // Performance
    lines.push('PERFORMANCE');
    lines.push('-'.repeat(80));
    lines.push(`Average Latency: ${report.performance.averageLatency.toFixed(2)}ms`);
    lines.push(`P50 Latency: ${report.performance.p50Latency.toFixed(2)}ms`);
    lines.push(`P95 Latency: ${report.performance.p95Latency.toFixed(2)}ms`);
    lines.push(`P99 Latency: ${report.performance.p99Latency.toFixed(2)}ms`);
    lines.push(`Total Execution Time: ${(report.performance.totalExecutionTime / 1000).toFixed(2)}s`);
    lines.push('');

    // Determinism
    lines.push('DETERMINISM');
    lines.push('-'.repeat(80));
    lines.push(`Status: ${report.determinism.passed ? '✓ PASSED' : '✗ FAILED'}`);
    lines.push(`Runs Compared: ${report.determinism.runsCompared}`);
    lines.push(`Violations: ${report.determinism.violations.length}`);
    lines.push('');

    // Phase Results
    lines.push('PHASE RESULTS');
    lines.push('-'.repeat(80));
    for (const phase of report.phaseResults) {
      const status = phase.passed ? '✓' : '✗';
      lines.push(`${status} Phase ${phase.phaseNumber}: ${phase.phase}`);
      lines.push(`  Tests: ${phase.passedTests}/${phase.totalTests} passed`);
      lines.push(`  Time: ${(phase.executionTime / 1000).toFixed(2)}s`);
      lines.push(`  Requirements: ${phase.requirementsCovered.join(', ')}`);
      lines.push('');
    }

    // Failures
    if (report.failures.length > 0) {
      lines.push('FAILURES');
      lines.push('-'.repeat(80));
      for (const failure of report.failures) {
        lines.push(`✗ ${failure.testName}`);
        lines.push(`  Phase: ${failure.phase}`);
        lines.push(`  Requirement: ${failure.requirement}`);
        lines.push(`  Message: ${failure.message}`);
        lines.push(`  Expected: ${JSON.stringify(failure.expected)}`);
        lines.push(`  Actual: ${JSON.stringify(failure.actual)}`);
        lines.push('  Reproduction Steps:');
        for (const step of failure.reproductionSteps) {
          lines.push(`    - ${step}`);
        }
        lines.push('');
      }
    }

    lines.push('='.repeat(80));

    return lines.join('\n');
  }

  /**
   * Format report as JSON
   */
  formatAsJSON(report: TestReport): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * Format report as HTML
   */
  formatAsHTML(report: TestReport): string {
    const statusClass = report.overallPassed ? 'passed' : 'failed';
    const statusIcon = report.overallPassed ? '✓' : '✗';

    return `
<!DOCTYPE html>
<html>
<head>
  <title>E2E Test Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    .passed { color: green; }
    .failed { color: red; }
    .summary { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; }
    .metric { margin: 10px 0; }
    .phase { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
    .failure { background: #ffe6e6; padding: 10px; margin: 10px 0; border-radius: 5px; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; }
  </style>
</head>
<body>
  <h1>E2E Test Report</h1>
  <div class="summary">
    <h2 class="${statusClass}">${statusIcon} ${report.overallPassed ? 'PASSED' : 'FAILED'}</h2>
    <p>${report.summary}</p>
    <div class="metric">Generated: ${new Date(report.generatedAt).toISOString()}</div>
    <div class="metric">Total Tests: ${report.totalTests}</div>
    <div class="metric">Passed: ${report.totalPassed}</div>
    <div class="metric">Failed: ${report.totalFailed}</div>
  </div>

  <h2>Coverage</h2>
  <div class="metric">Requirements: ${report.coverage.coveredRequirements}/${report.coverage.totalRequirements} (${report.coverage.coveragePercentage.toFixed(1)}%)</div>
  <div class="metric">Properties: ${report.coverage.testedProperties}/${report.coverage.totalProperties} (${report.coverage.propertyCoveragePercentage.toFixed(1)}%)</div>

  <h2>Performance</h2>
  <div class="metric">Average Latency: ${report.performance.averageLatency.toFixed(2)}ms</div>
  <div class="metric">P95 Latency: ${report.performance.p95Latency.toFixed(2)}ms</div>
  <div class="metric">Total Execution Time: ${(report.performance.totalExecutionTime / 1000).toFixed(2)}s</div>

  <h2>Phase Results</h2>
  ${report.phaseResults.map(phase => `
    <div class="phase">
      <h3 class="${phase.passed ? 'passed' : 'failed'}">${phase.passed ? '✓' : '✗'} Phase ${phase.phaseNumber}: ${phase.phase}</h3>
      <div>Tests: ${phase.passedTests}/${phase.totalTests} passed</div>
      <div>Time: ${(phase.executionTime / 1000).toFixed(2)}s</div>
      <div>Requirements: ${phase.requirementsCovered.join(', ')}</div>
    </div>
  `).join('')}

  ${report.failures.length > 0 ? `
    <h2>Failures</h2>
    ${report.failures.map(failure => `
      <div class="failure">
        <h3>✗ ${failure.testName}</h3>
        <div><strong>Phase:</strong> ${failure.phase}</div>
        <div><strong>Requirement:</strong> ${failure.requirement}</div>
        <div><strong>Message:</strong> ${failure.message}</div>
        <div><strong>Expected:</strong> <code>${JSON.stringify(failure.expected)}</code></div>
        <div><strong>Actual:</strong> <code>${JSON.stringify(failure.actual)}</code></div>
        <div><strong>Reproduction Steps:</strong></div>
        <ol>
          ${failure.reproductionSteps.map(step => `<li>${step}</li>`).join('')}
        </ol>
      </div>
    `).join('')}
  ` : ''}
</body>
</html>
    `.trim();
  }
}
