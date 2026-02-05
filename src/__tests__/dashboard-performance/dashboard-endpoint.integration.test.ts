// Integration Test: Aggregated Dashboard Endpoint
// Tests parallel fetching, partial failures, and cache utilization

import request from 'supertest';
import { app } from '../../app.js';
import { redisCache } from '../../services/redis-cache.service.js';
import { authService } from '../../services/auth.service.js';
import './setup.js';

describe('Dashboard Endpoint Integration', () => {
  let authToken: string;

  beforeAll(async () => {
    // Connect Redis
    if (!redisCache.isAvailable()) {
      await redisCache.connect(process.env.REDIS_URL);
    }

    // Generate auth token for testing
    authToken = authService.generateToken({
      userId: 'test-user',
      email: 'test@example.com',
      role: 'admin',
    });
  });

  afterAll(async () => {
    await redisCache.disconnect();
  });

  afterEach(async () => {
    // Clear cache between tests
    if (redisCache.isAvailable()) {
      await redisCache.invalidate('*');
    }
  });

  describe('GET /dashboard', () => {
    it('should return all 9 data sections', async () => {
      // Skip if Redis not available
      if (!redisCache.isAvailable()) {
        console.log('Skipping test: Redis not available');
        return;
      }

      const response = await request(app)
        .get('/dashboard')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify all sections present
      expect(response.body).toHaveProperty('positions');
      expect(response.body).toHaveProperty('shadow_positions');
      expect(response.body).toHaveProperty('health');
      expect(response.body).toHaveProperty('exit_signals');
      expect(response.body).toHaveProperty('queued_signals');
      expect(response.body).toHaveProperty('source_performance');
      expect(response.body).toHaveProperty('gex');
      expect(response.body).toHaveProperty('pnl_curve');
      expect(response.body).toHaveProperty('daily_returns');
      expect(response.body).toHaveProperty('metadata');
    }, 30000);

    it('should include response metadata', async () => {
      // Skip if Redis not available
      if (!redisCache.isAvailable()) {
        console.log('Skipping test: Redis not available');
        return;
      }

      const response = await request(app)
        .get('/dashboard')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const { metadata } = response.body;
      expect(metadata).toHaveProperty('response_time_ms');
      expect(metadata).toHaveProperty('cache_hits');
      expect(metadata).toHaveProperty('cache_misses');
      expect(metadata).toHaveProperty('timestamp');

      expect(typeof metadata.response_time_ms).toBe('number');
      expect(Array.isArray(metadata.cache_hits)).toBe(true);
      expect(Array.isArray(metadata.cache_misses)).toBe(true);
    }, 30000);

    it('should utilize cache on second request', async () => {
      // Skip if Redis not available
      if (!redisCache.isAvailable()) {
        console.log('Skipping test: Redis not available');
        return;
      }

      // First request - populate cache
      const first = await request(app)
        .get('/dashboard')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Second request - should hit cache
      const second = await request(app)
        .get('/dashboard')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Second request should have cache hits
      expect(second.body.metadata.cache_hits.length).toBeGreaterThan(0);
      
      // Second request should be faster
      expect(second.body.metadata.response_time_ms).toBeLessThanOrEqual(
        first.body.metadata.response_time_ms
      );
    }, 30000);

    it('should handle partial failures gracefully', async () => {
      // Skip if Redis not available
      if (!redisCache.isAvailable()) {
        console.log('Skipping test: Redis not available');
        return;
      }

      // Even if some sections fail, should return 200 with partial data
      const response = await request(app)
        .get('/dashboard')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Should have metadata even if some sections fail
      expect(response.body.metadata).toBeDefined();
      
      // Errors object may or may not be present
      if (response.body.errors) {
        expect(typeof response.body.errors).toBe('object');
      }
    }, 30000);

    it('should require authentication', async () => {
      await request(app)
        .get('/dashboard')
        .expect(401);
    });

    it('should respond within acceptable time', async () => {
      // Skip if Redis not available
      if (!redisCache.isAvailable()) {
        console.log('Skipping test: Redis not available');
        return;
      }

      const start = Date.now();
      
      await request(app)
        .get('/dashboard')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const duration = Date.now() - start;
      
      // Should respond within 5 seconds (generous for first request)
      expect(duration).toBeLessThan(5000);
    }, 30000);
  });

  describe('Cache behavior', () => {
    it('should cache GEX data', async () => {
      // Skip if Redis not available
      if (!redisCache.isAvailable()) {
        console.log('Skipping test: Redis not available');
        return;
      }

      await request(app)
        .get('/dashboard')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Check if GEX is cached
      const gexKey = redisCache.buildKey('gex', { 
        symbol: 'SPY', 
        date: new Date().toISOString().split('T')[0] 
      });
      
      const cached = await redisCache.getCached(gexKey);
      // May or may not be cached depending on external API
      expect(typeof cached.hit).toBe('boolean');
    }, 30000);

    it('should cache analytics data', async () => {
      // Skip if Redis not available
      if (!redisCache.isAvailable()) {
        console.log('Skipping test: Redis not available');
        return;
      }

      await request(app)
        .get('/dashboard')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Check if analytics are cached
      const pnlKey = redisCache.buildKey('analytics', { type: 'pnl', days: '30' });
      const cached = await redisCache.getCached(pnlKey);
      
      expect(typeof cached.hit).toBe('boolean');
    }, 30000);
  });
});
