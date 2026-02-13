/**
 * Test Configuration Module
 * 
 * Export all configuration utilities and types.
 */

export type {
  Environment,
  TestScenario,
  FeatureFlagConfig,
  BaselineConfig,
  PerformanceConfig,
} from './test-config';

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
} from './test-config';
