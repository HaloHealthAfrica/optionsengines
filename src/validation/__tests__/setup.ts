/**
 * Test setup for validation framework
 * 
 * Configures Jest and fast-check for property-based testing
 */

// Configure fast-check for property-based testing
// Minimum 100 iterations as per requirements
export const PROPERTY_TEST_ITERATIONS = 100;

// Test timeout for validation tests (30 seconds)
export const VALIDATION_TEST_TIMEOUT = 30000;

// Mock data cleanup
afterEach(() => {
  jest.clearAllMocks();
});

// Global test utilities
export const testUtils = {
  /**
   * Create a test validation result
   */
  createMockValidationResult: (overrides = {}) => ({
    category: 'WEBHOOK_INFRASTRUCTURE',
    status: 'PASS' as const,
    testsPassed: 10,
    testsFailed: 0,
    executionTime: 1000,
    timestamp: new Date(),
    failures: [],
    ...overrides,
  }),

  /**
   * Create a test validation failure
   */
  createMockValidationFailure: (overrides = {}) => ({
    testName: 'test-validation',
    expectedOutcome: 'expected',
    actualOutcome: 'actual',
    errorMessage: 'Test failed',
    context: {},
    ...overrides,
  }),
};
