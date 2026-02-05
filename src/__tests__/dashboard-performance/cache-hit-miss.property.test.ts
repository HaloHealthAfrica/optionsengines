// Property Test: Cache Hit and Miss Behavior
// Feature: dashboard-performance-optimization, Property 2 & 3
// Validates: Requirements 1.3, 1.4, 3.2, 3.3, 4.2

import * as fc from 'fast-check';
import { redisCache } from '../../services/redis-cache.service.js';
import './setup.js';

describe('Property 2: Cache Hit Returns Cached Data', () => {
  beforeAll(async () => {
    if (!redisCache.isAvailable()) {
      await redisCache.connect(process.env.REDIS_URL);
    }
  });

  afterAll(async () => {
    await redisCache.disconnect();
  });

  afterEach(async () => {
    if (redisCache.isAvailable()) {
      await redisCache.invalidate('test:*');
    }
  });

  it('should return cached data without hitting source', async () => {
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
            fc.record({ data: fc.string(), count: fc.integer() })
          ),
        }),
        async ({ key, value }) => {
          const testKey = `test:hit:${key}`;
          const ttl = 300;

          // Pre-populate cache
          await redisCache.set(testKey, value, ttl);

          // Get cached result
          const result = await redisCache.getCached(testKey);

          // Assertions
          expect(result.hit).toBe(true);
          expect(result.data).toEqual(value);
          expect(result.ttl_remaining).toBeGreaterThan(0);
          expect(result.ttl_remaining).toBeLessThanOrEqual(ttl);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 3: Cache Miss Triggers Fresh Fetch', () => {
  beforeAll(async () => {
    if (!redisCache.isAvailable()) {
      await redisCache.connect(process.env.REDIS_URL);
    }
  });

  afterAll(async () => {
    await redisCache.disconnect();
  });

  afterEach(async () => {
    if (redisCache.isAvailable()) {
      await redisCache.invalidate('test:*');
    }
  });

  it('should indicate cache miss for non-existent keys', async () => {
    // Skip if Redis not available
    if (!redisCache.isAvailable()) {
      console.log('Skipping test: Redis not available');
      return;
    }

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        async (key) => {
          const testKey = `test:miss:${key}`;

          // Ensure key doesn't exist
          await redisCache.invalidate(testKey);

          // Try to get non-existent key
          const result = await redisCache.getCached(testKey);

          // Assertions
          expect(result.hit).toBe(false);
          expect(result.data).toBeNull();
          expect(result.ttl_remaining).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should allow cache population after miss', async () => {
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
        }),
        async ({ key, value }) => {
          const testKey = `test:populate:${key}`;

          // First access - cache miss
          const miss = await redisCache.getCached(testKey);
          expect(miss.hit).toBe(false);

          // Populate cache
          await redisCache.setCached(testKey, value, 300);

          // Second access - cache hit
          const hit = await redisCache.getCached(testKey);
          expect(hit.hit).toBe(true);
          expect(hit.data).toEqual(value);
        }
      ),
      { numRuns: 100 }
    );
  });
});
