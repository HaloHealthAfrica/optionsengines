// Property Test: Cache Storage with TTL
// Feature: dashboard-performance-optimization, Property 1: Cache Storage with TTL
// Validates: Requirements 1.2, 1.5

import * as fc from 'fast-check';
import { redisCache } from '../../services/redis-cache.service.js';
import './setup.js';

describe('Property 1: Cache Storage with TTL', () => {
  beforeAll(async () => {
    // Connect to Redis if not already connected
    if (!redisCache.isAvailable()) {
      await redisCache.connect(process.env.REDIS_URL);
    }
  });

  afterAll(async () => {
    await redisCache.disconnect();
  });

  afterEach(async () => {
    // Clean up test keys
    if (redisCache.isAvailable()) {
      await redisCache.invalidate('test:*');
    }
  });

  it('should store and retrieve data with correct TTL', async () => {
    // Skip if Redis not available
    if (!redisCache.isAvailable()) {
      console.log('Skipping test: Redis not available');
      return;
    }

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          key: fc.string({ minLength: 1, maxLength: 50 }),
          value: fc.oneof(
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.double(),
            fc.array(fc.string()),
            fc.record({ data: fc.string(), count: fc.integer() })
          ), // Exclude undefined/null which don't serialize well
          type: fc.constantFrom('gex', 'analytics', 'performance'),
        }),
        async ({ key, value, type }) => {
          const testKey = `test:${type}:${key}`;
          const expectedTTL = redisCache.getTTLForType(type as any);

          // Store in cache
          await redisCache.set(testKey, value, expectedTTL);

          // Retrieve from cache
          const retrieved = await redisCache.get(testKey);

          // Check TTL
          const actualTTL = await redisCache.getTTL(testKey);

          // Assertions
          expect(retrieved).toEqual(value);
          expect(actualTTL).toBeGreaterThan(0);
          expect(actualTTL).toBeLessThanOrEqual(expectedTTL);

          // Verify TTL matches type
          if (type === 'gex') {
            expect(expectedTTL).toBe(300); // 5 minutes
          } else if (type === 'analytics') {
            expect(expectedTTL).toBe(900); // 15 minutes
          } else if (type === 'performance') {
            expect(expectedTTL).toBe(600); // 10 minutes
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should expire data after TTL', async () => {
    // Skip if Redis not available
    if (!redisCache.isAvailable()) {
      console.log('Skipping test: Redis not available');
      return;
    }

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          key: fc.string({ minLength: 1, maxLength: 50 }),
          value: fc.string(),
          ttl: fc.integer({ min: 1, max: 3 }), // Short TTL for testing
        }),
        async ({ key, value, ttl }) => {
          const testKey = `test:expire:${key}`;

          // Store with short TTL
          await redisCache.set(testKey, value, ttl);

          // Should exist immediately
          const exists = await redisCache.exists(testKey);
          expect(exists).toBe(true);

          // Wait for expiration
          await new Promise(resolve => setTimeout(resolve, (ttl + 1) * 1000));

          // Should not exist after TTL
          const existsAfter = await redisCache.exists(testKey);
          expect(existsAfter).toBe(false);
        }
      ),
      { numRuns: 10 } // Fewer runs due to time delays
    );
  }, 60000);
});
