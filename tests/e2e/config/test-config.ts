/**
 * Test Configuration
 * 
 * This module defines configuration structures for different test environments
 * and scenarios. It provides environment-specific configurations, feature flag
 * configurations, and baseline configurations.
 * 
 * Requirements: 14.1
 */

import { TestConfig } from '../orchestration/test-orchestrator';
import { TestRunnerConfig } from '../test-runner';

/**
 * Environment types
 */
export type Environment = 'test' | 'development' | 'staging' | 'production';

/**
 * Test scenario types
 */
export type TestScenario = 
  | 'unit'
  | 'integration'
  | 'e2e'
  | 'regression'
  | 'performance'
  | 'determinism'
  | 'safety';

/**
 * Feature flag configuration
 */
export interface FeatureFlagConfig {
  /** Enable Engine B multi-agent system */
  ENGINE_B_ENABLED: boolean;
  
  /** Enable ORB specialist agent */
  AGENT_ORB_ENABLED: boolean;
  
  /** Enable Strat specialist agent */
  AGENT_STRAT_ENABLED: boolean;
  
  /** Enable TTM specialist agent */
  AGENT_TTM_ENABLED: boolean;
  
  /** Enable Satyland specialist agent */
  AGENT_SATYLAND_ENABLED: boolean;
  
  /** Enable Risk specialist agent */
  AGENT_RISK_ENABLED: boolean;
  
  /** Enable Meta-Decision specialist agent */
  AGENT_META_ENABLED: boolean;
  
  /** Enable shadow execution */
  SHADOW_EXECUTION_ENABLED: boolean;
  
  /** Enable GEX regime sensitivity */
  GEX_REGIME_ENABLED: boolean;
  
  /** Enable frontend display */
  FRONTEND_DISPLAY_ENABLED: boolean;
}

/**
 * Baseline configuration for Engine A regression testing
 */
export interface BaselineConfig {
  /** Baseline version identifier */
  version: string;
  
  /** Baseline data file path */
  dataFile: string;
  
  /** Maximum allowed latency increase (ms) */
  maxLatencyIncrease: number;
  
  /** Tolerance for floating point comparisons */
  floatingPointTolerance: number;
  
  /** Whether to update baseline on test run */
  updateBaseline: boolean;
}

/**
 * Performance testing configuration
 */
export interface PerformanceConfig {
  /** Maximum allowed latency for webhook processing (ms) */
  maxWebhookProcessingLatency: number;
  
  /** Maximum allowed latency for enrichment (ms) */
  maxEnrichmentLatency: number;
  
  /** Maximum allowed latency for Engine A decision (ms) */
  maxEngineALatency: number;
  
  /** Maximum allowed latency for Engine B decision (ms) */
  maxEngineBLatency: number;
  
  /** Maximum allowed end-to-end latency (ms) */
  maxEndToEndLatency: number;
  
  /** Number of concurrent webhooks for load testing */
  concurrentWebhooks: number;
  
  /** Duration of load test (ms) */
  loadTestDuration: number;
}

/**
 * Create default feature flag configuration (all features enabled)
 */
export function createDefaultFeatureFlags(): FeatureFlagConfig {
  return {
    ENGINE_B_ENABLED: true,
    AGENT_ORB_ENABLED: true,
    AGENT_STRAT_ENABLED: true,
    AGENT_TTM_ENABLED: true,
    AGENT_SATYLAND_ENABLED: true,
    AGENT_RISK_ENABLED: true,
    AGENT_META_ENABLED: true,
    SHADOW_EXECUTION_ENABLED: true,
    GEX_REGIME_ENABLED: true,
    FRONTEND_DISPLAY_ENABLED: true,
  };
}

/**
 * Create Engine B disabled feature flags (for kill-switch testing)
 */
export function createEngineBDisabledFlags(): FeatureFlagConfig {
  return {
    ENGINE_B_ENABLED: false,
    AGENT_ORB_ENABLED: false,
    AGENT_STRAT_ENABLED: false,
    AGENT_TTM_ENABLED: false,
    AGENT_SATYLAND_ENABLED: false,
    AGENT_RISK_ENABLED: false,
    AGENT_META_ENABLED: false,
    SHADOW_EXECUTION_ENABLED: false,
    GEX_REGIME_ENABLED: true,
    FRONTEND_DISPLAY_ENABLED: true,
  };
}

/**
 * Create partial feature flags (some agents enabled, some disabled)
 */
export function createPartialFeatureFlags(): FeatureFlagConfig {
  return {
    ENGINE_B_ENABLED: true,
    AGENT_ORB_ENABLED: true,
    AGENT_STRAT_ENABLED: true,
    AGENT_TTM_ENABLED: false,
    AGENT_SATYLAND_ENABLED: false,
    AGENT_RISK_ENABLED: true,
    AGENT_META_ENABLED: true,
    SHADOW_EXECUTION_ENABLED: true,
    GEX_REGIME_ENABLED: true,
    FRONTEND_DISPLAY_ENABLED: true,
  };
}

/**
 * Convert feature flag config to environment variable format
 */
export function featureFlagsToEnvVars(flags: FeatureFlagConfig): Record<string, boolean> {
  return {
    FEATURE_ENGINE_B_ENABLED: flags.ENGINE_B_ENABLED,
    FEATURE_AGENT_ORB_ENABLED: flags.AGENT_ORB_ENABLED,
    FEATURE_AGENT_STRAT_ENABLED: flags.AGENT_STRAT_ENABLED,
    FEATURE_AGENT_TTM_ENABLED: flags.AGENT_TTM_ENABLED,
    FEATURE_AGENT_SATYLAND_ENABLED: flags.AGENT_SATYLAND_ENABLED,
    FEATURE_AGENT_RISK_ENABLED: flags.AGENT_RISK_ENABLED,
    FEATURE_AGENT_META_ENABLED: flags.AGENT_META_ENABLED,
    FEATURE_SHADOW_EXECUTION_ENABLED: flags.SHADOW_EXECUTION_ENABLED,
    FEATURE_GEX_REGIME_ENABLED: flags.GEX_REGIME_ENABLED,
    FEATURE_FRONTEND_DISPLAY_ENABLED: flags.FRONTEND_DISPLAY_ENABLED,
  };
}

/**
 * Create default baseline configuration
 */
export function createDefaultBaselineConfig(): BaselineConfig {
  return {
    version: '1.0.0',
    dataFile: './baselines/engine-a-baseline.json',
    maxLatencyIncrease: 10, // 10ms
    floatingPointTolerance: 0.0001,
    updateBaseline: false,
  };
}

/**
 * Create default performance configuration
 */
export function createDefaultPerformanceConfig(): PerformanceConfig {
  return {
    maxWebhookProcessingLatency: 50,
    maxEnrichmentLatency: 200,
    maxEngineALatency: 100,
    maxEngineBLatency: 500,
    maxEndToEndLatency: 1000,
    concurrentWebhooks: 10,
    loadTestDuration: 60000, // 1 minute
  };
}

/**
 * Create test configuration for a specific environment
 */
export function createEnvironmentConfig(env: Environment): TestConfig {
  const baseConfig: TestConfig = {
    isolatedEnvironment: true,
    featureFlags: featureFlagsToEnvVars(createDefaultFeatureFlags()),
    mockExternalAPIs: true,
    captureAllLogs: true,
    timeout: 30000,
    environment: env,
  };
  
  switch (env) {
    case 'test':
      return {
        ...baseConfig,
        isolatedEnvironment: true,
        mockExternalAPIs: true,
      };
    
    case 'development':
      return {
        ...baseConfig,
        isolatedEnvironment: true,
        mockExternalAPIs: true,
        timeout: 60000,
      };
    
    case 'staging':
      return {
        ...baseConfig,
        isolatedEnvironment: true,
        mockExternalAPIs: false, // Use real APIs in staging
        timeout: 60000,
      };
    
    case 'production':
      // Production should never run tests directly
      throw new Error('Cannot create test configuration for production environment');
    
    default:
      return baseConfig;
  }
}

/**
 * Create test runner configuration for a specific scenario
 */
export function createScenarioConfig(scenario: TestScenario, env: Environment = 'test'): TestRunnerConfig {
  const baseConfig: TestRunnerConfig = {
    testConfig: createEnvironmentConfig(env),
    stopOnFailure: false,
    skipCheckpoints: false,
    propertyTestIterations: 100,
    generateDetailedReports: true,
    reportOutputDir: './test-reports',
  };
  
  switch (scenario) {
    case 'unit':
      return {
        ...baseConfig,
        skipCheckpoints: true,
        propertyTestIterations: 50,
        generateDetailedReports: false,
      };
    
    case 'integration':
      return {
        ...baseConfig,
        skipCheckpoints: false,
        propertyTestIterations: 100,
      };
    
    case 'e2e':
      return {
        ...baseConfig,
        skipCheckpoints: false,
        propertyTestIterations: 100,
        stopOnFailure: false,
      };
    
    case 'regression':
      return {
        ...baseConfig,
        skipCheckpoints: true,
        propertyTestIterations: 200,
        stopOnFailure: true,
      };
    
    case 'performance':
      return {
        ...baseConfig,
        skipCheckpoints: true,
        propertyTestIterations: 1000,
        testConfig: {
          ...baseConfig.testConfig,
          timeout: 120000, // 2 minutes
        },
      };
    
    case 'determinism':
      return {
        ...baseConfig,
        skipCheckpoints: true,
        propertyTestIterations: 3, // Run 3 times for determinism check
      };
    
    case 'safety':
      return {
        ...baseConfig,
        skipCheckpoints: false,
        stopOnFailure: true,
        propertyTestIterations: 100,
      };
    
    default:
      return baseConfig;
  }
}

/**
 * Create configuration for Engine A regression testing
 */
export function createEngineARegressionConfig(): TestRunnerConfig {
  return {
    testConfig: {
      isolatedEnvironment: true,
      featureFlags: featureFlagsToEnvVars(createDefaultFeatureFlags()),
      mockExternalAPIs: true,
      captureAllLogs: true,
      timeout: 30000,
      environment: 'test',
    },
    phasesToRun: [5, 6], // Engine A Regression and Checkpoint
    stopOnFailure: true,
    skipCheckpoints: false,
    propertyTestIterations: 200,
    generateDetailedReports: true,
    reportOutputDir: './test-reports/engine-a-regression',
  };
}

/**
 * Create configuration for Engine B testing
 */
export function createEngineBTestConfig(): TestRunnerConfig {
  return {
    testConfig: {
      isolatedEnvironment: true,
      featureFlags: featureFlagsToEnvVars(createDefaultFeatureFlags()),
      mockExternalAPIs: true,
      captureAllLogs: true,
      timeout: 30000,
      environment: 'test',
    },
    phasesToRun: [7, 8, 9, 10], // Engine B, Risk Veto, Shadow Execution, Checkpoint
    stopOnFailure: false,
    skipCheckpoints: false,
    propertyTestIterations: 100,
    generateDetailedReports: true,
    reportOutputDir: './test-reports/engine-b',
  };
}

/**
 * Create configuration for feature flag testing
 */
export function createFeatureFlagTestConfig(): TestRunnerConfig {
  return {
    testConfig: {
      isolatedEnvironment: true,
      featureFlags: featureFlagsToEnvVars(createEngineBDisabledFlags()),
      mockExternalAPIs: true,
      captureAllLogs: true,
      timeout: 30000,
      environment: 'test',
    },
    phasesToRun: [14], // Feature Flags phase
    stopOnFailure: true,
    skipCheckpoints: true,
    propertyTestIterations: 100,
    generateDetailedReports: true,
    reportOutputDir: './test-reports/feature-flags',
  };
}

/**
 * Create configuration for CI/CD pipeline
 */
export function createCIConfig(): TestRunnerConfig {
  return {
    testConfig: {
      isolatedEnvironment: true,
      featureFlags: featureFlagsToEnvVars(createDefaultFeatureFlags()),
      mockExternalAPIs: true,
      captureAllLogs: true,
      timeout: 60000,
      environment: 'test',
    },
    stopOnFailure: true,
    skipCheckpoints: false,
    propertyTestIterations: 100,
    generateDetailedReports: true,
    reportOutputDir: './test-reports/ci',
  };
}

/**
 * Create configuration for nightly extended testing
 */
export function createNightlyConfig(): TestRunnerConfig {
  return {
    testConfig: {
      isolatedEnvironment: true,
      featureFlags: featureFlagsToEnvVars(createDefaultFeatureFlags()),
      mockExternalAPIs: true,
      captureAllLogs: true,
      timeout: 300000, // 5 minutes
      environment: 'test',
    },
    stopOnFailure: false,
    skipCheckpoints: false,
    propertyTestIterations: 1000, // Extended property testing
    generateDetailedReports: true,
    reportOutputDir: './test-reports/nightly',
  };
}

/**
 * Load configuration from environment variables
 */
export function loadConfigFromEnv(): TestRunnerConfig {
  const env = (process.env.TEST_ENV || 'test') as Environment;
  const scenario = (process.env.TEST_SCENARIO || 'e2e') as TestScenario;
  
  const config = createScenarioConfig(scenario, env);
  
  // Override with environment variables if present
  if (process.env.PROPERTY_TEST_ITERATIONS) {
    config.propertyTestIterations = parseInt(process.env.PROPERTY_TEST_ITERATIONS, 10);
  }
  
  if (process.env.STOP_ON_FAILURE) {
    config.stopOnFailure = process.env.STOP_ON_FAILURE === 'true';
  }
  
  if (process.env.SKIP_CHECKPOINTS) {
    config.skipCheckpoints = process.env.SKIP_CHECKPOINTS === 'true';
  }
  
  if (process.env.REPORT_OUTPUT_DIR) {
    config.reportOutputDir = process.env.REPORT_OUTPUT_DIR;
  }
  
  return config;
}

/**
 * Validate configuration
 */
export function validateConfig(config: TestRunnerConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Validate property test iterations
  if (config.propertyTestIterations < 1) {
    errors.push('Property test iterations must be at least 1');
  }
  
  if (config.propertyTestIterations > 10000) {
    errors.push('Property test iterations should not exceed 10000 (performance concern)');
  }
  
  // Validate timeout
  if (config.testConfig.timeout && config.testConfig.timeout < 1000) {
    errors.push('Timeout must be at least 1000ms');
  }
  
  // Validate environment
  if (config.testConfig.environment === 'production') {
    errors.push('Cannot run tests in production environment');
  }
  
  // Validate report output directory
  if (config.generateDetailedReports && !config.reportOutputDir) {
    errors.push('Report output directory must be specified when generating detailed reports');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
