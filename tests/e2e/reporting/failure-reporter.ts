/**
 * Failure Reporter
 * 
 * Captures and reports detailed failure information including:
 * - Expected vs actual values
 * - Reproduction steps using synthetic data
 * - Stack traces
 * - Context for debugging
 * 
 * Requirements: 15.3, 15.4
 */

import { ValidationResult } from '../validation/validation-framework';
import { SystemState } from '../orchestration/test-orchestrator';
import { SyntheticWebhook } from '../generators/webhook-generator';
import { SyntheticGEX } from '../generators/gex-generator';

/**
 * Failure context
 */
export interface FailureContext {
  /** Test name */
  testName: string;
  
  /** Phase */
  phase: string;
  
  /** Requirement being validated */
  requirement: string;
  
  /** Validation result */
  validationResult: ValidationResult;
  
  /** System state at failure */
  systemState?: SystemState;
  
  /** Synthetic webhooks used */
  syntheticWebhooks?: SyntheticWebhook[];
  
  /** Synthetic GEX data used */
  syntheticGEX?: SyntheticGEX[];
  
  /** Test configuration */
  testConfig?: any;
  
  /** Stack trace */
  stackTrace?: string;
}

/**
 * Reproduction step
 */
export interface ReproductionStep {
  /** Step number */
  step: number;
  
  /** Step description */
  description: string;
  
  /** Code snippet */
  code?: string;
  
  /** Data used */
  data?: any;
}

/**
 * Failure report
 */
export interface FailureReport {
  /** Failure ID */
  id: string;
  
  /** Timestamp */
  timestamp: number;
  
  /** Test name */
  testName: string;
  
  /** Phase */
  phase: string;
  
  /** Requirement */
  requirement: string;
  
  /** Failure message */
  message: string;
  
  /** Expected value */
  expected: any;
  
  /** Actual value */
  actual: any;
  
  /** Difference description */
  difference: string;
  
  /** Reproduction steps */
  reproductionSteps: ReproductionStep[];
  
  /** Synthetic data for reproduction */
  syntheticData: {
    webhooks?: any[];
    gex?: any[];
  };
  
  /** Stack trace */
  stackTrace?: string;
  
  /** Additional context */
  context: any;
}

/**
 * Failure Reporter
 */
export class FailureReporter {
  private failures: FailureReport[] = [];

  /**
   * Report a failure
   */
  reportFailure(context: FailureContext): FailureReport {
    const report: FailureReport = {
      id: this.generateFailureId(),
      timestamp: Date.now(),
      testName: context.testName,
      phase: context.phase,
      requirement: context.requirement,
      message: context.validationResult.message,
      expected: context.validationResult.expected,
      actual: context.validationResult.actual,
      difference: this.describeDifference(
        context.validationResult.expected,
        context.validationResult.actual
      ),
      reproductionSteps: this.generateReproductionSteps(context),
      syntheticData: {
        webhooks: context.syntheticWebhooks?.map(w => w.payload),
        gex: context.syntheticGEX?.map(g => g.data)
      },
      stackTrace: context.stackTrace,
      context: {
        systemState: context.systemState,
        testConfig: context.testConfig,
        validationDetails: context.validationResult.details
      }
    };

    this.failures.push(report);
    return report;
  }

  /**
   * Get all failures
   */
  getFailures(): FailureReport[] {
    return this.failures;
  }

  /**
   * Get failures by phase
   */
  getFailuresByPhase(phase: string): FailureReport[] {
    return this.failures.filter(f => f.phase === phase);
  }

  /**
   * Get failures by requirement
   */
  getFailuresByRequirement(requirement: string): FailureReport[] {
    return this.failures.filter(f => f.requirement === requirement);
  }

  /**
   * Clear all failures
   */
  clearFailures(): void {
    this.failures = [];
  }

  /**
   * Generate failure ID
   */
  private generateFailureId(): string {
    return `FAIL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Describe difference between expected and actual
   */
  private describeDifference(expected: any, actual: any): string {
    if (expected === undefined || actual === undefined) {
      return `Expected: ${JSON.stringify(expected)}, Actual: ${JSON.stringify(actual)}`;
    }

    if (typeof expected !== typeof actual) {
      return `Type mismatch: expected ${typeof expected}, got ${typeof actual}`;
    }

    if (typeof expected === 'object' && expected !== null && actual !== null) {
      return this.describeObjectDifference(expected, actual);
    }

    if (typeof expected === 'number' && typeof actual === 'number') {
      const diff = Math.abs(expected - actual);
      const percentDiff = expected !== 0 ? (diff / Math.abs(expected)) * 100 : 0;
      return `Expected: ${expected}, Actual: ${actual}, Difference: ${diff.toFixed(2)} (${percentDiff.toFixed(1)}%)`;
    }

    return `Expected: ${JSON.stringify(expected)}, Actual: ${JSON.stringify(actual)}`;
  }

  /**
   * Describe object difference
   */
  private describeObjectDifference(expected: any, actual: any): string {
    const differences: string[] = [];

    // Check for missing keys
    for (const key of Object.keys(expected)) {
      if (!(key in actual)) {
        differences.push(`Missing key: ${key}`);
      } else if (expected[key] !== actual[key]) {
        differences.push(`${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(actual[key])}`);
      }
    }

    // Check for extra keys
    for (const key of Object.keys(actual)) {
      if (!(key in expected)) {
        differences.push(`Extra key: ${key}`);
      }
    }

    return differences.length > 0 ? differences.join('; ') : 'Objects differ in structure';
  }

  /**
   * Generate reproduction steps
   */
  private generateReproductionSteps(context: FailureContext): ReproductionStep[] {
    const steps: ReproductionStep[] = [];

    // Step 1: Setup test environment
    steps.push({
      step: 1,
      description: 'Set up test environment',
      code: `
const orchestrator = new TestOrchestratorImpl();
const context = await orchestrator.setupTest(${JSON.stringify(context.testConfig, null, 2)});
      `.trim()
    });

    // Step 2: Generate synthetic data
    if (context.syntheticWebhooks && context.syntheticWebhooks.length > 0) {
      steps.push({
        step: 2,
        description: 'Generate synthetic webhook data',
        code: `
const webhookGenerator = new DefaultWebhookGenerator();
const webhook = webhookGenerator.generateWebhook(${JSON.stringify(context.syntheticWebhooks[0].metadata.scenario, null, 2)});
        `.trim(),
        data: context.syntheticWebhooks[0].payload
      });
    }

    if (context.syntheticGEX && context.syntheticGEX.length > 0) {
      steps.push({
        step: steps.length + 1,
        description: 'Generate synthetic GEX data',
        code: `
const gexGenerator = new DefaultGEXGenerator();
const gexData = gexGenerator.generateGEX(${JSON.stringify(context.syntheticGEX[0].metadata.regime, null, 2)});
        `.trim(),
        data: context.syntheticGEX[0].data
      });
    }

    // Step 3: Inject data
    steps.push({
      step: steps.length + 1,
      description: 'Inject synthetic data into system',
      code: `
${context.syntheticGEX ? 'await orchestrator.injectGEX(context, gexData);' : ''}
${context.syntheticWebhooks ? 'await orchestrator.injectWebhook(context, webhook);' : ''}
await new Promise(resolve => setTimeout(resolve, 150));
      `.trim()
    });

    // Step 4: Capture state
    steps.push({
      step: steps.length + 1,
      description: 'Capture system state',
      code: `
const state = await orchestrator.captureState(context);
      `.trim()
    });

    // Step 5: Validate
    steps.push({
      step: steps.length + 1,
      description: 'Run validation that failed',
      code: `
const result = validate${context.phase}(state, expectedBehavior);
console.log('Validation result:', result);
      `.trim()
    });

    // Step 6: Cleanup
    steps.push({
      step: steps.length + 1,
      description: 'Clean up test environment',
      code: `
await orchestrator.teardownTest(context);
      `.trim()
    });

    return steps;
  }

  /**
   * Format failure report as text
   */
  formatAsText(report: FailureReport): string {
    const lines: string[] = [];

    lines.push('='.repeat(80));
    lines.push(`FAILURE REPORT: ${report.id}`);
    lines.push('='.repeat(80));
    lines.push('');
    lines.push(`Timestamp: ${new Date(report.timestamp).toISOString()}`);
    lines.push(`Test: ${report.testName}`);
    lines.push(`Phase: ${report.phase}`);
    lines.push(`Requirement: ${report.requirement}`);
    lines.push('');

    lines.push('FAILURE MESSAGE');
    lines.push('-'.repeat(80));
    lines.push(report.message);
    lines.push('');

    lines.push('DIFFERENCE');
    lines.push('-'.repeat(80));
    lines.push(report.difference);
    lines.push('');

    lines.push('REPRODUCTION STEPS');
    lines.push('-'.repeat(80));
    for (const step of report.reproductionSteps) {
      lines.push(`${step.step}. ${step.description}`);
      if (step.code) {
        lines.push('```typescript');
        lines.push(step.code);
        lines.push('```');
      }
      if (step.data) {
        lines.push('Data:');
        lines.push(JSON.stringify(step.data, null, 2));
      }
      lines.push('');
    }

    if (report.syntheticData.webhooks || report.syntheticData.gex) {
      lines.push('SYNTHETIC DATA');
      lines.push('-'.repeat(80));
      if (report.syntheticData.webhooks) {
        lines.push('Webhooks:');
        lines.push(JSON.stringify(report.syntheticData.webhooks, null, 2));
      }
      if (report.syntheticData.gex) {
        lines.push('GEX Data:');
        lines.push(JSON.stringify(report.syntheticData.gex, null, 2));
      }
      lines.push('');
    }

    if (report.stackTrace) {
      lines.push('STACK TRACE');
      lines.push('-'.repeat(80));
      lines.push(report.stackTrace);
      lines.push('');
    }

    lines.push('='.repeat(80));

    return lines.join('\n');
  }

  /**
   * Format failure report as JSON
   */
  formatAsJSON(report: FailureReport): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * Format failure report as HTML
   */
  formatAsHTML(report: FailureReport): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Failure Report: ${report.id}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #d32f2f; }
    .section { margin: 20px 0; }
    .code { background: #f5f5f5; padding: 10px; border-radius: 5px; overflow-x: auto; }
    .data { background: #e3f2fd; padding: 10px; border-radius: 5px; overflow-x: auto; }
    pre { margin: 0; }
  </style>
</head>
<body>
  <h1>Failure Report: ${report.id}</h1>
  
  <div class="section">
    <h2>Details</h2>
    <p><strong>Timestamp:</strong> ${new Date(report.timestamp).toISOString()}</p>
    <p><strong>Test:</strong> ${report.testName}</p>
    <p><strong>Phase:</strong> ${report.phase}</p>
    <p><strong>Requirement:</strong> ${report.requirement}</p>
  </div>

  <div class="section">
    <h2>Failure Message</h2>
    <p>${report.message}</p>
  </div>

  <div class="section">
    <h2>Difference</h2>
    <p>${report.difference}</p>
  </div>

  <div class="section">
    <h2>Reproduction Steps</h2>
    ${report.reproductionSteps.map(step => `
      <div>
        <h3>${step.step}. ${step.description}</h3>
        ${step.code ? `<div class="code"><pre>${step.code}</pre></div>` : ''}
        ${step.data ? `<div class="data"><pre>${JSON.stringify(step.data, null, 2)}</pre></div>` : ''}
      </div>
    `).join('')}
  </div>

  ${report.stackTrace ? `
    <div class="section">
      <h2>Stack Trace</h2>
      <div class="code"><pre>${report.stackTrace}</pre></div>
    </div>
  ` : ''}
</body>
</html>
    `.trim();
  }
}
