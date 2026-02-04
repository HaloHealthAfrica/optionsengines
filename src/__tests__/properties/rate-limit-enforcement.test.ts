/**
 * Property-Based Test: API rate limit enforcement
 * Property 45: Alpaca/TwelveData calls are limited by token bucket
 * Validates: Requirements 24.1, 24.2
 */

import fc from 'fast-check';
import { rateLimiter } from '../../services/rate-limiter.service.js';

describe('Property 45: API rate limit enforcement', () => {
  test('Property: acquire fails after capacity is exhausted', async () => {
    const stats = rateLimiter.getStats('alpaca');
    expect(stats).not.toBeNull();
    const capacity = stats?.capacity || 1;

    rateLimiter.reset('alpaca');

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: capacity + 5 }),
        async (attempts) => {
          rateLimiter.reset('alpaca');

          const results: boolean[] = [];
          for (let i = 0; i < attempts; i++) {
            results.push(await rateLimiter.tryAcquire('alpaca'));
          }

          if (attempts <= capacity) {
            expect(results.every(Boolean)).toBe(true);
          } else {
            expect(results.some((value) => value === false)).toBe(true);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
