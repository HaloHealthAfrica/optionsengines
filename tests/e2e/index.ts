/**
 * E2E Testing System - Main Entry Point
 * 
 * This module provides the main entry point for the E2E testing system.
 * It wires together all components: generators, orchestrator, validation framework,
 * test runner, and reporting.
 * 
 * Requirements: All requirements
 */

import { createTestRunner, createDefaultConfig } from './test-runner';
import { createWebhookGenerator } from './generators/webhook-generator-impl';
import { createGEXGenerator } from './generators/gex-generator-impl';
import { createTestOrchestrator } from './orchestration/test-orchestrator-impl';
import {
  createEngineARegressionConfig,
  createEngineBTestConfig,
  createFeatureFlagTestConfig,
  createCIConfig,
  createNightlyConfig,
  createScenarioConfig,
} from './config';

// Export generators (types + values)
export type {
  WebhookGenerator,
  WebhookScenario,
  SyntheticWebhook,
  WebhookPayload,
  GEXGenerator,
  GEXRegime,
  SyntheticGEX,
  GEXData,
} from './generators';
export {
  DefaultWebhookGenerator,
  createWebhookGenerator,
  DefaultGEXGenerator,
  createGEXGenerator,
} from './generators';

// Export orchestration types
export type {
  TestOrchestrator,
  TestConfig,
  TestContext,
  SystemState,
  VariantAssignment,
  Decision,
  AgentActivation,
  EnrichedSnapshot,
  ShadowTrade,
  LiveTrade,
  LogEntry,
} from './orchestration/test-orchestrator';

// Export orchestration implementation
export {
  TestOrchestratorImpl,
  createTestOrchestrator,
} from './orchestration/test-orchestrator-impl';

// Export test runner (types + values)
export type {
  TestPhase,
  TestExecutionResult,
  TestFailure,
  TestRunSummary,
  TestRunnerConfig,
} from './test-runner';
export {
  TestRunner,
  createTestRunner,
  createDefaultConfig,
} from './test-runner';

// Export configuration (types + values)
export type {
  Environment,
  TestScenario,
  FeatureFlagConfig,
  BaselineConfig,
  PerformanceConfig,
} from './config';
export {
  createDefaultFeatureFlags,
  createEngineBDisabledFlags,
  createPartialFeatureFlags,
  featureFlagsToEnvVars,
  createDefaultBaselineConfig,
  createDefaultPerformanceConfig,
  createEnvironmentConfig,
  createScenarioConfig,
  createEngineARegressionConfig,
  createEngineBTestConfig,
  createFeatureFlagTestConfig,
  createCIConfig,
  createNightlyConfig,
  loadConfigFromEnv,
  validateConfig,
} from './config';

/**
 * E2E Test System
 * 
 * Main class that provides a unified interface to the entire E2E testing system.
 * This class wires together all components and provides convenience methods for
 * common testing workflows.
 */
export class E2ETestSystem {
  private runner: import('./test-runner').TestRunner;
  private webhookGenerator: import('./generators').WebhookGenerator;
  private gexGenerator: import('./generators').GEXGenerator;
  private orchestrator: import('./orchestration/test-orchestrator').TestOrchestrator;
  
  constructor() {
    this.runner = createTestRunner();
    this.webhookGenerator = createWebhookGenerator();
    this.gexGenerator = createGEXGenerator();
    this.orchestrator = createTestOrchestrator();
  }
  
  /**
   * Get the test runner
   */
  getRunner(): import('./test-runner').TestRunner {
    return this.runner;
  }
  
  /**
   * Get the webhook generator
   */
  getWebhookGenerator(): import('./generators').WebhookGenerator {
    return this.webhookGenerator;
  }
  
  /**
   * Get the GEX generator
   */
  getGEXGenerator(): import('./generators').GEXGenerator {
    return this.gexGenerator;
  }
  
  /**
   * Get the test orchestrator
   */
  getOrchestrator(): import('./orchestration/test-orchestrator').TestOrchestrator {
    return this.orchestrator;
  }
  
  /**
   * Run all test phases with default configuration
   */
  async runAllTests(): Promise<import('./test-runner').TestRunSummary> {
    const config = createDefaultConfig();
    return this.runner.runAllPhases(config);
  }
  
  /**
   * Run all test phases with custom configuration
   */
  async runAllTestsWithConfig(config: import('./test-runner').TestRunnerConfig): Promise<import('./test-runner').TestRunSummary> {
    return this.runner.runAllPhases(config);
  }
  
  /**
   * Run a specific test phase
   */
  async runPhase(phaseNumber: number, config?: import('./test-runner').TestRunnerConfig): Promise<import('./test-runner').TestExecutionResult> {
    const testConfig = config || createDefaultConfig();
    return this.runner.runPhase(phaseNumber, testConfig);
  }
  
  /**
   * Run Engine A regression tests
   */
  async runEngineARegression(): Promise<import('./test-runner').TestRunSummary> {
    const config = createEngineARegressionConfig();
    return this.runner.runAllPhases(config);
  }
  
  /**
   * Run Engine B tests
   */
  async runEngineBTests(): Promise<import('./test-runner').TestRunSummary> {
    const config = createEngineBTestConfig();
    return this.runner.runAllPhases(config);
  }
  
  /**
   * Run feature flag tests
   */
  async runFeatureFlagTests(): Promise<import('./test-runner').TestRunSummary> {
    const config = createFeatureFlagTestConfig();
    return this.runner.runAllPhases(config);
  }
  
  /**
   * Run CI/CD tests
   */
  async runCITests(): Promise<import('./test-runner').TestRunSummary> {
    const config = createCIConfig();
    return this.runner.runAllPhases(config);
  }
  
  /**
   * Run nightly extended tests
   */
  async runNightlyTests(): Promise<import('./test-runner').TestRunSummary> {
    const config = createNightlyConfig();
    return this.runner.runAllPhases(config);
  }
  
  /**
   * Get all defined test phases
   */
  getPhases(): import('./test-runner').TestPhase[] {
    return this.runner.getPhases();
  }
  
  /**
   * Get a specific test phase
   */
  getPhase(phaseNumber: number): import('./test-runner').TestPhase | undefined {
    return this.runner.getPhase(phaseNumber);
  }
}

/**
 * Create a new E2E test system instance
 */
export function createE2ETestSystem(): E2ETestSystem {
  return new E2ETestSystem();
}

/**
 * Quick start function for running all tests
 */
export async function runE2ETests(): Promise<import('./test-runner').TestRunSummary> {
  const system = createE2ETestSystem();
  return system.runAllTests();
}

/**
 * Quick start function for running tests with environment configuration
 */
export async function runE2ETestsForEnvironment(env: import('./config').Environment): Promise<import('./test-runner').TestRunSummary> {
  
  const config = createScenarioConfig('e2e', env);
  const runner = createTestRunner();
  
  return runner.runAllPhases(config);
}

/**
 * Quick start function for running tests with scenario configuration
 */
export async function runE2ETestsForScenario(scenario: import('./config').TestScenario): Promise<import('./test-runner').TestRunSummary> {
  
  const config = createScenarioConfig(scenario);
  const runner = createTestRunner();
  
  return runner.runAllPhases(config);
}
