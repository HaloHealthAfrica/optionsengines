/**
 * Property-Based Test: Cache consistency
 * Property 6: Cached data is returned for repeated requests within TTL
 * Validates: Requirements 2.4
 */

import fc from 'fast-check';
import { cache } from '../../services/cache.service.js';

describe('Property 6: Cache consistency', () => {
  beforeEach(() => {
    cache.clear();
  });

  afterEach(() => {
    cache.clear();
  });

  const keyArb = fc.string({ minLength: 1, maxLength: 30 });
  const valueArb = fc.oneof(
    fc.string({ maxLength: 50 }),
    fc.integer({ min: -1000, max: 1000 }),
    fc.boolean(),
    fc.record({
      a: fc.integer({ min: 0, max: 100 }),
      b: fc.string({ maxLength: 20 }),
    })
  );

  test('Property: repeated get returns cached value', async () => {
    await fc.assert(
      fc.asyncProperty(keyArb, valueArb, async (key, value) => {
        const firstSet = cache.set(key, value, 60);
        expect(firstSet).toBe(true);

        const firstGet = cache.get<typeof value>(key);
        const secondGet = cache.get<typeof value>(key);

        expect(firstGet).toEqual(value);
        expect(secondGet).toEqual(value);
      }),
      { numRuns: 100 }
    );
  });
});
