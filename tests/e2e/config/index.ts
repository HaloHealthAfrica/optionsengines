/**
 * Test Configuration Module
 * 
 * Export all configuration utilities and types.
 */

export {
  Environment,
  TestScenario,
  FeatureFlagConfig,
  BaselineConfig,
  PerformanceConfig,
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
