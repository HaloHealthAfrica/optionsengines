/**
 * Property-Based Test: Circuit breaker state transitions
 * Property 41: Circuit breaker state transitions
 * Validates: Requirements 18.6
 */

import fc from 'fast-check';
import { CircuitBreaker } from '../../services/circuit-breaker.service.js';

describe('Property 41: circuit breaker transitions', () => {
  test('opens after failures and half-opens after timeout', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 5, max: 10 }), async (failureCount) => {
        let now = 0;
        const breaker = new CircuitBreaker({
          maxFailures: 5,
          resetTimeoutMs: 60000,
          now: () => now,
        });

        for (let i = 0; i < failureCount; i += 1) {
          breaker.recordFailure();
        }

        const openStatus = breaker.getStatus();
        expect(openStatus.state).toBe('open');

        now = 61000;
        const canRequest = breaker.canRequest();
        expect(canRequest).toBe(true);
        expect(breaker.getStatus().state).toBe('half-open');

        breaker.recordSuccess();
        const closedStatus = breaker.getStatus();
        expect(closedStatus.state).toBe('closed');
        expect(closedStatus.failures).toBe(0);
      }),
      { numRuns: 20 }
    );
  });
});
