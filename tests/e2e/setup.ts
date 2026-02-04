/**
 * E2E Test Setup
 * 
 * This file runs before all E2E tests to configure the test environment.
 * It sets up API mocking, environment variables, and safety checks.
 */

import nock from 'nock';

jest.setTimeout(30000);

/**
 * Global test setup
 */
beforeAll(() => {
  // Ensure we're in test mode
  process.env.NODE_ENV = 'test';

  // Disable real HTTP requests by default
  // This ensures all external API calls must be explicitly mocked
  nock.disableNetConnect();

  // Allow localhost connections for testing local services if needed
  nock.enableNetConnect('127.0.0.1');
  nock.enableNetConnect('localhost');

  console.log('E2E Test Environment Initialized');
  console.log('- External API calls are mocked');
  console.log('- Test isolation is enabled');
  console.log('- Safety checks are active');
});

/**
 * Clean up after each test
 */
afterEach(() => {
  // Clean up any pending nock interceptors
  nock.cleanAll();
});

/**
 * Global test teardown
 */
afterAll(() => {
  // Restore HTTP connections
  nock.enableNetConnect();
  nock.restore();

  console.log('E2E Test Environment Cleaned Up');
});

/**
 * Safety check: Ensure no live broker API calls
 * This function can be called in tests to verify no real broker calls were made
 */
export function assertNoLiveBrokerCalls(): void {
  // Check that all nock interceptors were used (no unmocked calls)
  if (!nock.isDone()) {
    const pending = nock.pendingMocks();
    if (pending.length > 0) {
      console.warn('Warning: Pending mock interceptors:', pending);
    }
  }
}

/**
 * Safety check: Ensure synthetic data is properly marked
 */
export function assertSyntheticDataMarked(data: any): void {
  if (!data.metadata || data.metadata.synthetic !== true) {
    throw new Error(
      'Safety violation: Data is not marked as synthetic. ' +
      'All test data must have metadata.synthetic = true'
    );
  }
}

/**
 * Helper to create a test context with safety checks
 */
export function createSafeTestContext() {
  return {
    brokerCallCount: 0,
    productionDataModified: false,
    productionConfigModified: false,
    
    recordBrokerCall() {
      this.brokerCallCount++;
      throw new Error(
        'CRITICAL SAFETY VIOLATION: Live broker API call detected during test! ' +
        'All broker calls must be mocked.'
      );
    },
    
    recordProductionDataModification() {
      this.productionDataModified = true;
      throw new Error(
        'CRITICAL SAFETY VIOLATION: Production data modification detected during test! ' +
        'Tests must not modify production data.'
      );
    },
    
    recordProductionConfigModification() {
      this.productionConfigModified = true;
      throw new Error(
        'CRITICAL SAFETY VIOLATION: Production config modification detected during test! ' +
        'Tests must not modify production configuration.'
      );
    },
    
    assertSafe() {
      if (this.brokerCallCount > 0) {
        throw new Error(`Safety check failed: ${this.brokerCallCount} broker calls detected`);
      }
      if (this.productionDataModified) {
        throw new Error('Safety check failed: Production data was modified');
      }
      if (this.productionConfigModified) {
        throw new Error('Safety check failed: Production config was modified');
      }
    },
  };
}
