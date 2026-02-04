/**
 * E2E Test Configuration
 * 
 * This file contains configuration settings for the E2E testing system.
 * It defines test environment settings, feature flags, API mocking configuration,
 * and property-based testing parameters.
 */

export interface E2ETestConfig {
  /**
   * Whether to use an isolated test environment
   */
  isolatedEnvironment: boolean;

  /**
   * Feature flags for controlling system behavior during tests
   */
  featureFlags: Record<string, boolean>;

  /**
   * Whether to mock external API calls
   */
  mockExternalAPIs: boolean;

  /**
   * Whether to capture all logs during test execution
   */
  captureAllLogs: boolean;

  /**
   * Property-based testing configuration
   */
  propertyTesting: {
    /**
     * Number of iterations for property tests
     * Minimum 100 as per design document
     */
    numRuns: number;

    /**
     * Seed for deterministic property test generation
     * Used for reproducibility when debugging failures
     */
    seed?: number;

    /**
     * Whether to enable shrinking to find minimal failing examples
     */
    enableShrinking: boolean;
  };

  /**
   * Performance testing thresholds
   */
  performance: {
    /**
     * Maximum acceptable latency increase over baseline (in milliseconds)
     */
    maxLatencyIncrease: number;

    /**
     * Baseline Engine A processing latency (in milliseconds)
     */
    baselineLatency: number;
  };

  /**
   * Test isolation settings
   */
  isolation: {
    /**
     * Prevent live broker API calls
     */
    preventLiveBrokerCalls: boolean;

    /**
     * Prevent production data modifications
     */
    preventProductionDataModification: boolean;

    /**
     * Prevent production configuration modifications
     */
    preventProductionConfigModification: boolean;
  };
}

/**
 * Default E2E test configuration
 */
export const defaultE2EConfig: E2ETestConfig = {
  isolatedEnvironment: true,
  featureFlags: {
    enableEngineB: true,
    enableMultiAgent: true,
    enableShadowExecution: true,
    enableGEXIntegration: true,
  },
  mockExternalAPIs: true,
  captureAllLogs: true,
  propertyTesting: {
    numRuns: 100, // Minimum as per design document
    enableShrinking: true,
  },
  performance: {
    maxLatencyIncrease: 10, // 10ms acceptable increase
    baselineLatency: 50, // Placeholder baseline
  },
  isolation: {
    preventLiveBrokerCalls: true,
    preventProductionDataModification: true,
    preventProductionConfigModification: true,
  },
};

/**
 * Configuration for Engine B disabled tests (kill-switch validation)
 */
export const engineBDisabledConfig: E2ETestConfig = {
  ...defaultE2EConfig,
  featureFlags: {
    enableEngineB: false,
    enableMultiAgent: false,
    enableShadowExecution: false,
    enableGEXIntegration: false,
  },
};

/**
 * Configuration for determinism validation tests
 */
export const determinismTestConfig: E2ETestConfig = {
  ...defaultE2EConfig,
  propertyTesting: {
    numRuns: 3, // Run 3 times for determinism validation
    seed: 42, // Fixed seed for reproducibility
    enableShrinking: false, // Disable shrinking for determinism tests
  },
};

/**
 * Configuration for extended property testing (nightly runs)
 */
export const extendedPropertyTestConfig: E2ETestConfig = {
  ...defaultE2EConfig,
  propertyTesting: {
    numRuns: 1000, // Extended runs for comprehensive coverage
    enableShrinking: true,
  },
};
