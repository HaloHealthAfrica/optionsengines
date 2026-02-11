/**
 * Jest configuration for GTM Launch Readiness Validation tests
 * 
 * Extends the root Jest configuration with validation-specific settings
 */

export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@/(.*)$': '<rootDir>/../../../src/$1',
    '^@validation/(.*)$': '<rootDir>/../$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  testMatch: [
    '<rootDir>/**/*.test.ts',
    '<rootDir>/**/*.property.test.ts',
  ],
  collectCoverageFrom: [
    '<rootDir>/../**/*.ts',
    '!<rootDir>/../**/*.test.ts',
    '!<rootDir>/../**/*.spec.ts',
    '!<rootDir>/../types/**',
  ],
  setupFilesAfterEnv: ['<rootDir>/setup.ts'],
  testTimeout: 30000, // 30 seconds for validation tests
  // Property-based testing configuration
  globals: {
    PROPERTY_TEST_ITERATIONS: 100,
  },
};
