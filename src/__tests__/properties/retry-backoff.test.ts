/**
 * Property-Based Test: API retry with exponential backoff
 * Property 38: API retry with exponential backoff
 * Validates: Requirements 18.1
 */

import fc from 'fast-check';
import { retry } from '../../utils/retry.js';

describe('Property 38: retry backoff', () => {
  test('uses exponential backoff delays', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 3 }), async (failures) => {
        const delays: number[] = [];
        let attempt = 0;
        const result = await retry(
          async () => {
            attempt += 1;
            if (attempt <= failures) {
              throw new Error('fail');
            }
            return 'ok';
          },
          {
            retries: failures,
            baseDelayMs: 1000,
            sleepFn: async (ms: number) => {
              delays.push(ms);
            },
          }
        );

        expect(result).toBe('ok');
        expect(delays).toHaveLength(failures);
        delays.forEach((delay, index) => {
          const expected = Math.pow(2, index + 1) * 1000;
          expect(delay).toBe(expected);
        });
      }),
      { numRuns: 20 }
    );
  });
});
