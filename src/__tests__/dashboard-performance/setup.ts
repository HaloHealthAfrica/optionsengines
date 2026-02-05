/**
 * Dashboard Performance Test Setup
 * 
 * This file configures the test environment for dashboard performance tests.
 * It sets up Redis connection, mocks external APIs, and provides test utilities.
 */

import nock from 'nock';

// Set longer timeout for integration tests
jest.setTimeout(30000);

/**
 * Setup before all tests
 */
beforeAll(async () => {
  // Ensure test environment
  process.env.NODE_ENV = 'test';
  
  // Set Redis URL for tests (use test Redis or mock)
  if (!process.env.REDIS_URL) {
    process.env.REDIS_URL = 'redis://localhost:6379';
  }

  // Disable real HTTP requests
  nock.disableNetConnect();
  
  // Allow localhost connections for Redis and local services
  nock.enableNetConnect('127.0.0.1');
  nock.enableNetConnect('localhost');
  nock.enableNetConnect(/upstash\.io/); // Allow Upstash Redis
});

/**
 * Clean up after each test
 */
afterEach(() => {
  // Clean up nock interceptors
  nock.cleanAll();
});

/**
 * Teardown after all tests
 */
afterAll(async () => {
  // Restore network connections
  nock.enableNetConnect();
  nock.restore();
  
  // Give time for cleanup
  await new Promise(resolve => setTimeout(resolve, 1000));
});

/**
 * Mock external GEX API response
 * Matches any query parameters and ignores authorization headers
 */
export function mockGEXAPI(symbol: string = 'SPY') {
  return nock('https://api.marketdata.app', {
    // Ignore authorization headers in matching
    badheaders: [],
  })
    .get(`/v1/options/chain/${symbol}/`)
    .query(true) // Match any query parameters
    .times(10) // Allow multiple calls
    .reply(200, {
      s: 'ok',
      optionChain: [
        {
          strike: 450,
          optionType: 'call',
          bid: 5.0,
          ask: 5.2,
          last: 5.1,
          volume: 1000,
          openInterest: 5000,
          delta: 0.5,
          gamma: 0.05,
          theta: -0.1,
          vega: 0.2,
        },
        {
          strike: 450,
          optionType: 'put',
          bid: 4.8,
          ask: 5.0,
          last: 4.9,
          volume: 800,
          openInterest: 4000,
          delta: -0.5,
          gamma: 0.05,
          theta: -0.1,
          vega: 0.2,
        },
      ],
    });
}

/**
 * Mock database query responses
 */
export function mockDatabaseQueries() {
  // This would mock pg queries if needed
  // For now, we'll let real DB queries through if DB is available
}
