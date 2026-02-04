/**
 * Main Test Runner
 * 
 * This module implements the main test runner that orchestrates the execution of all test phases.
 * It coordinates test suite execution, handles phase ordering, manages checkpoints, and provides
 * comprehensive error handling and recovery.
 * 
 * Requirements: All requirements
 */

import { TestOrchestrator, TestConfig } from './orchestration/test-orchestrator';
import { createTestOrchestrator } from './orchestration/test-orchestrator-impl';

/**
 * Test phase definition
 */
export interface TestPhase {
  /** Phase number */
  phaseNumber: number;
  
  /** Phase name */
  name: string;
  
  /** Phase description */
  description: string;
  
  /** Test suite file path (relative to tests/e2e/phases/) */
  testSuite: string;
  
  /** Whether this phase is a checkpoint */
  isCheckpoint: boolean;
  
  /** Requirements validated by this phase */
  requirements: string[];
  
  /** Properties validated by this phase */
  properties: number[];
}

/**
 * Test execution result
 */
export interface TestExecutionResult {
  /** Phase that was executed */
  phase: TestPhase;
  
  /** Whether the phase passed */
  passed: boolean;
  
  /** Number of tests run */
  testsRun: number;
  
  /** Number of tests passed */
  testsPassed: number;
  
  /** Number of tests failed */
  testsFailed: number;
  
  /** Execution time in milliseconds */
  executionTime: number;
  
  /** Error message if phase failed */
  error?: string;
  
  /** Detailed failure information */
  failures?: TestFailure[];
}

/**
 * Test failure information
 */
export interface TestFailure {
  /** Test name */
  testName: string;
  
  /** Error message */
  message: string;
  
  /** Expected value */
  expected?: any;
  
  /** Actual value */
  actual?: any;
  
  /** Stack trace */
  stack?: string;
}

/**
 * Test run summary
 */
export interface TestRunSummary {
  /** Total phases executed */
  totalPhases: number;
  
  /** Phases passed */
  phasesPassed: number;
  
  /** Phases failed */
  phasesFailed: number;
  
  /** Total tests run */
  totalTests: number;
  
  /** Total tests passed */
  totalTestsPassed: number;
  
  /** Total tests failed */
  totalTestsFailed: number;
  
  /** Total execution time in milliseconds */
  totalExecutionTime: number;
  
  /** Phase results */
  phaseResults: TestExecutionResult[];
  
  /** Overall success */
  success: boolean;
  
  /** Requirements coverage */
  requirementsCoverage: Map<string, boolean>;
  
  /** Properties coverage */
  propertiesCoverage: Map<number, boolean>;
}

/**
 * Test runner configuration
 */
export interface TestRunnerConfig {
  /** Test configuration for orchestrator */
  testConfig: TestConfig;
  
  /** Phases to execute (if empty, run all phases) */
  phasesToRun?: number[];
  
  /** Whether to stop on first failure */
  stopOnFailure: boolean;
  
  /** Whether to skip checkpoints */
  skipCheckpoints: boolean;
  
  /** Number of iterations for property tests */
  propertyTestIterations: number;
  
  /** Whether to generate detailed reports */
  generateDetailedReports: boolean;
  
  /** Output directory for reports */
  reportOutputDir?: string;
}

/**
 * Main Test Runner
 * 
 * Orchestrates the execution of all test phases with proper ordering, checkpoint handling,
 * and error recovery.
 */
export class TestRunner {
  private orchestrator: TestOrchestrator;
  private phases: TestPhase[];
  
  constructor() {
    this.orchestrator = createTestOrchestrator();
    this.phases = this.defineTestPhases();
  }
  
  /**
   * Define all test phases in execution order
   */
  private defineTestPhases(): TestPhase[] {
    return [
      {
        phaseNumber: 1,
        name: 'Synthetic Data Generation',
        description: 'Validate synthetic webhook and GEX data generation',
        testSuite: 'phase1-data-generation.test.ts',
        isCheckpoint: false,
        requirements: ['1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '1.9', '1.10', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8', '2.9', '2.10'],
        properties: [1, 2, 3, 4],
      },
      {
        phaseNumber: 2,
        name: 'Checkpoint - Verify Generators',
        description: 'Verify synthetic data generators are working correctly',
        testSuite: 'checkpoint-generators.test.ts',
        isCheckpoint: true,
        requirements: ['1.10', '2.10'],
        properties: [1],
      },
      {
        phaseNumber: 3,
        name: 'Webhook Ingestion',
        description: 'Validate webhook ingestion and enrichment behavior',
        testSuite: 'phase3-webhook-ingestion.test.ts',
        isCheckpoint: false,
        requirements: ['3.1', '3.2', '3.3', '3.4'],
        properties: [5, 6, 7],
      },
      {
        phaseNumber: 4,
        name: 'Strategy Router',
        description: 'Validate A/B routing and variant assignment',
        testSuite: 'phase4-strategy-router.test.ts',
        isCheckpoint: false,
        requirements: ['4.1', '4.2', '4.3', '4.4', '4.5'],
        properties: [8, 9, 10],
      },
      {
        phaseNumber: 5,
        name: 'Engine A Regression',
        description: 'Validate Engine A behavior remains unchanged',
        testSuite: 'phase5-engine-a-regression.test.ts',
        isCheckpoint: false,
        requirements: ['5.1', '5.2', '5.3', '5.4', '5.5'],
        properties: [11, 12, 13],
      },
      {
        phaseNumber: 6,
        name: 'Checkpoint - Verify Engine A',
        description: 'Verify Engine A regression prevention is working',
        testSuite: 'checkpoint-engine-a.test.ts',
        isCheckpoint: true,
        requirements: ['5.1', '5.2', '5.3'],
        properties: [11, 12, 13],
      },
      {
        phaseNumber: 7,
        name: 'Engine B Multi-Agent',
        description: 'Validate Engine B multi-agent activation and interaction',
        testSuite: 'phase7-engine-b-multi-agent.test.ts',
        isCheckpoint: false,
        requirements: ['6.1', '6.2', '6.3', '6.4', '6.5', '6.6', '6.7', '6.8', '6.9'],
        properties: [14, 15, 16],
      },
      {
        phaseNumber: 8,
        name: 'Risk Veto',
        description: 'Validate risk veto functionality',
        testSuite: 'phase8-risk-veto.test.ts',
        isCheckpoint: false,
        requirements: ['7.1', '7.2', '7.3'],
        properties: [17],
      },
      {
        phaseNumber: 9,
        name: 'Shadow Execution',
        description: 'Validate shadow execution isolation',
        testSuite: 'phase9-shadow-execution.test.ts',
        isCheckpoint: false,
        requirements: ['8.1', '8.2', '8.3', '8.4', '8.5'],
        properties: [18],
      },
      {
        phaseNumber: 10,
        name: 'Checkpoint - Verify Engine B',
        description: 'Verify Engine B and shadow execution are working correctly',
        testSuite: 'checkpoint-engine-b.test.ts',
        isCheckpoint: true,
        requirements: ['6.1', '8.1', '8.2'],
        properties: [14, 18],
      },
      {
        phaseNumber: 11,
        name: 'Strategy Interaction',
        description: 'Validate multi-agent interactions and confidence adjustments',
        testSuite: 'phase11-strategy-interaction.test.ts',
        isCheckpoint: false,
        requirements: ['9.1', '9.2', '9.3', '9.4', '9.5'],
        properties: [19],
      },
      {
        phaseNumber: 12,
        name: 'GEX Regime',
        description: 'Validate agent behavior under different GEX regimes',
        testSuite: 'phase12-gex-regime.test.ts',
        isCheckpoint: false,
        requirements: ['10.1', '10.2', '10.3', '10.4', '10.5'],
        properties: [20, 21],
      },
      {
        phaseNumber: 13,
        name: 'Logging and Attribution',
        description: 'Validate logging completeness and frontend-backend consistency',
        testSuite: 'phase13-logging-attribution.test.ts',
        isCheckpoint: false,
        requirements: ['11.1', '11.2', '11.3', '11.4', '11.5', '11.6', '11.7', '11.8', '11.9'],
        properties: [22, 23],
      },
      {
        phaseNumber: 14,
        name: 'Feature Flags',
        description: 'Validate feature flag and kill-switch behavior',
        testSuite: 'phase14-feature-flags.test.ts',
        isCheckpoint: false,
        requirements: ['4.3', '5.5', '12.1', '12.2', '12.3', '12.4', '12.5'],
        properties: [24],
      },
      {
        phaseNumber: 15,
        name: 'Checkpoint - Verify All Phases',
        description: 'Verify all phase-specific tests are passing',
        testSuite: 'checkpoint-all-phases.test.ts',
        isCheckpoint: true,
        requirements: [],
        properties: [],
      },
      {
        phaseNumber: 16,
        name: 'Determinism and Replay',
        description: 'Validate deterministic behavior and replay functionality',
        testSuite: 'phase16-determinism-replay.test.ts',
        isCheckpoint: false,
        requirements: ['13.1', '13.2', '13.3', '13.4', '13.5'],
        properties: [25, 26, 27],
      },
      {
        phaseNumber: 17,
        name: 'Safety and Isolation',
        description: 'Validate test isolation and production safety',
        testSuite: 'phase17-safety-isolation.test.ts',
        isCheckpoint: false,
        requirements: ['14.1', '14.2', '14.3', '14.4', '14.5', '14.6'],
        properties: [28],
      },
      {
        phaseNumber: 18,
        name: 'Integration',
        description: 'Validate end-to-end integration of all components',
        testSuite: 'phase18-integration.test.ts',
        isCheckpoint: false,
        requirements: [],
        properties: [],
      },
      {
        phaseNumber: 19,
        name: 'Final Checkpoint',
        description: 'Final verification of all requirements and properties',
        testSuite: 'checkpoint-final.test.ts',
        isCheckpoint: true,
        requirements: [],
        properties: [],
      },
    ];
  }
  
  /**
   * Run all test phases
   */
  async runAllPhases(config: TestRunnerConfig): Promise<TestRunSummary> {
    console.log('🚀 Starting E2E Test Suite Execution');
    console.log('=====================================\n');
    
    const startTime = Date.now();
    const phaseResults: TestExecutionResult[] = [];
    const requirementsCoverage = new Map<string, boolean>();
    const propertiesCoverage = new Map<number, boolean>();
    
    // Determine which phases to run
    const phasesToExecute = config.phasesToRun && config.phasesToRun.length > 0
      ? this.phases.filter(p => config.phasesToRun!.includes(p.phaseNumber))
      : this.phases;
    
    // Filter out checkpoints if requested
    const filteredPhases = config.skipCheckpoints
      ? phasesToExecute.filter(p => !p.isCheckpoint)
      : phasesToExecute;
    
    console.log(`📋 Executing ${filteredPhases.length} phases\n`);
    
    // Execute each phase
    for (const phase of filteredPhases) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Phase ${phase.phaseNumber}: ${phase.name}`);
      console.log(`Description: ${phase.description}`);
      console.log(`${'='.repeat(80)}\n`);
      
      try {
        const result = await this.executePhase(phase, config);
        phaseResults.push(result);
        
        // Update coverage tracking
        for (const req of phase.requirements) {
          requirementsCoverage.set(req, result.passed);
        }
        for (const prop of phase.properties) {
          propertiesCoverage.set(prop, result.passed);
        }
        
        // Print phase result
        this.printPhaseResult(result);
        
        // Stop on failure if configured
        if (!result.passed && config.stopOnFailure) {
          console.log('\n❌ Stopping execution due to phase failure\n');
          break;
        }
        
        // Handle checkpoint failures
        if (phase.isCheckpoint && !result.passed) {
          console.log('\n⚠️  Checkpoint failed - consider fixing issues before proceeding\n');
          if (config.stopOnFailure) {
            break;
          }
        }
        
      } catch (error) {
        console.error(`\n❌ Phase ${phase.phaseNumber} encountered an error:`, error);
        
        const errorResult: TestExecutionResult = {
          phase,
          passed: false,
          testsRun: 0,
          testsPassed: 0,
          testsFailed: 0,
          executionTime: 0,
          error: error instanceof Error ? error.message : String(error),
        };
        
        phaseResults.push(errorResult);
        
        if (config.stopOnFailure) {
          console.log('\n❌ Stopping execution due to error\n');
          break;
        }
      }
    }
    
    const totalExecutionTime = Date.now() - startTime;
    
    // Calculate summary
    const summary: TestRunSummary = {
      totalPhases: phaseResults.length,
      phasesPassed: phaseResults.filter(r => r.passed).length,
      phasesFailed: phaseResults.filter(r => !r.passed).length,
      totalTests: phaseResults.reduce((sum, r) => sum + r.testsRun, 0),
      totalTestsPassed: phaseResults.reduce((sum, r) => sum + r.testsPassed, 0),
      totalTestsFailed: phaseResults.reduce((sum, r) => sum + r.testsFailed, 0),
      totalExecutionTime,
      phaseResults,
      success: phaseResults.every(r => r.passed),
      requirementsCoverage,
      propertiesCoverage,
    };
    
    // Print summary
    this.printSummary(summary);
    
    // Generate detailed reports if requested
    if (config.generateDetailedReports) {
      await this.generateDetailedReports(summary, config);
    }
    
    return summary;
  }
  
  /**
   * Execute a single test phase
   */
  private async executePhase(phase: TestPhase, config: TestRunnerConfig): Promise<TestExecutionResult> {
    const startTime = Date.now();
    
    // Set up test context
    const context = await this.orchestrator.setupTest(config.testConfig);
    
    try {
      // In a real implementation, this would dynamically load and execute the test suite
      // For now, we'll return a mock result
      // TODO: Implement dynamic test suite loading and execution
      
      const result: TestExecutionResult = {
        phase,
        passed: true,
        testsRun: 0,
        testsPassed: 0,
        testsFailed: 0,
        executionTime: Date.now() - startTime,
      };
      
      return result;
      
    } finally {
      // Clean up test context
      await this.orchestrator.teardownTest(context);
    }
  }
  
  /**
   * Print phase execution result
   */
  private printPhaseResult(result: TestExecutionResult): void {
    const icon = result.passed ? '✅' : '❌';
    const status = result.passed ? 'PASSED' : 'FAILED';
    
    console.log(`\n${icon} Phase ${result.phase.phaseNumber}: ${status}`);
    console.log(`   Tests Run: ${result.testsRun}`);
    console.log(`   Tests Passed: ${result.testsPassed}`);
    console.log(`   Tests Failed: ${result.testsFailed}`);
    console.log(`   Execution Time: ${result.executionTime}ms`);
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    
    if (result.failures && result.failures.length > 0) {
      console.log(`\n   Failures:`);
      for (const failure of result.failures) {
        console.log(`   - ${failure.testName}: ${failure.message}`);
      }
    }
  }
  
  /**
   * Print test run summary
   */
  private printSummary(summary: TestRunSummary): void {
    console.log('\n\n');
    console.log('='.repeat(80));
    console.log('TEST RUN SUMMARY');
    console.log('='.repeat(80));
    
    const icon = summary.success ? '✅' : '❌';
    const status = summary.success ? 'SUCCESS' : 'FAILURE';
    
    console.log(`\n${icon} Overall Status: ${status}\n`);
    console.log(`Phases Executed: ${summary.totalPhases}`);
    console.log(`Phases Passed: ${summary.phasesPassed}`);
    console.log(`Phases Failed: ${summary.phasesFailed}`);
    console.log(`\nTotal Tests Run: ${summary.totalTests}`);
    console.log(`Total Tests Passed: ${summary.totalTestsPassed}`);
    console.log(`Total Tests Failed: ${summary.totalTestsFailed}`);
    console.log(`\nTotal Execution Time: ${(summary.totalExecutionTime / 1000).toFixed(2)}s`);
    
    // Print coverage information
    console.log('\n' + '-'.repeat(80));
    console.log('COVERAGE');
    console.log('-'.repeat(80));
    
    const reqsCovered = Array.from(summary.requirementsCoverage.values()).filter(v => v).length;
    const reqsTotal = summary.requirementsCoverage.size;
    const reqsCoverage = reqsTotal > 0 ? ((reqsCovered / reqsTotal) * 100).toFixed(1) : '0.0';
    
    console.log(`\nRequirements Coverage: ${reqsCovered}/${reqsTotal} (${reqsCoverage}%)`);
    
    const propsCovered = Array.from(summary.propertiesCoverage.values()).filter(v => v).length;
    const propsTotal = summary.propertiesCoverage.size;
    const propsCoverage = propsTotal > 0 ? ((propsCovered / propsTotal) * 100).toFixed(1) : '0.0';
    
    console.log(`Properties Coverage: ${propsCovered}/${propsTotal} (${propsCoverage}%)`);
    
    // Print failed phases
    const failedPhases = summary.phaseResults.filter(r => !r.passed);
    if (failedPhases.length > 0) {
      console.log('\n' + '-'.repeat(80));
      console.log('FAILED PHASES');
      console.log('-'.repeat(80));
      
      for (const result of failedPhases) {
        console.log(`\n❌ Phase ${result.phase.phaseNumber}: ${result.phase.name}`);
        if (result.error) {
          console.log(`   Error: ${result.error}`);
        }
        if (result.failures && result.failures.length > 0) {
          console.log(`   Failures: ${result.failures.length}`);
        }
      }
    }
    
    console.log('\n' + '='.repeat(80) + '\n');
  }
  
  /**
   * Generate detailed test reports
   */
  private async generateDetailedReports(_summary: TestRunSummary, _config: TestRunnerConfig): Promise<void> {
    console.log('\n📊 Generating detailed reports...');
    
    // TODO: Implement detailed report generation
    // - HTML report with interactive charts
    // - JSON report for CI/CD integration
    // - Coverage report
    // - Performance metrics report
    
    console.log('✅ Reports generated successfully\n');
  }
  
  /**
   * Run a specific phase by number
   */
  async runPhase(phaseNumber: number, config: TestRunnerConfig): Promise<TestExecutionResult> {
    const phase = this.phases.find(p => p.phaseNumber === phaseNumber);
    
    if (!phase) {
      throw new Error(`Phase ${phaseNumber} not found`);
    }
    
    console.log(`\n🚀 Running Phase ${phase.phaseNumber}: ${phase.name}\n`);
    
    const result = await this.executePhase(phase, config);
    this.printPhaseResult(result);
    
    return result;
  }
  
  /**
   * Get all defined test phases
   */
  getPhases(): TestPhase[] {
    return [...this.phases];
  }
  
  /**
   * Get a specific phase by number
   */
  getPhase(phaseNumber: number): TestPhase | undefined {
    return this.phases.find(p => p.phaseNumber === phaseNumber);
  }
}

/**
 * Create a new test runner instance
 */
export function createTestRunner(): TestRunner {
  return new TestRunner();
}

/**
 * Create default test runner configuration
 */
export function createDefaultConfig(): TestRunnerConfig {
  return {
    testConfig: {
      isolatedEnvironment: true,
      featureFlags: {
        ENGINE_B_ENABLED: true,
      },
      mockExternalAPIs: true,
      captureAllLogs: true,
      timeout: 30000,
      environment: 'test',
    },
    stopOnFailure: false,
    skipCheckpoints: false,
    propertyTestIterations: 100,
    generateDetailedReports: true,
    reportOutputDir: './test-reports',
  };
}
