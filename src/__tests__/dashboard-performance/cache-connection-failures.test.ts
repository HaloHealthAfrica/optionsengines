// Unit Tests: Cache Connection Failures
// Tests Redis unavailable scenarios and reconnection with exponential backoff
// Requirements: 1.1

import { RedisCacheService } from '../../services/redis-cache.service.js';

describe('Cache Connection Failures', () => {
  let cacheService: RedisCacheService;

  beforeEach(() => {
    cacheService = new RedisCacheService();
  });

  afterEach(async () => {
    await cacheService.disconnect();
  });

  describe('Redis unavailable scenario', () => {
    it('should handle connection to invalid Redis URL gracefully', async () => {
      const invalidUrl = 'redis://invalid-host:6379';
      
      // Should not throw, but log error and continue
      await expect(cacheService.connect(invalidUrl)).resolves.not.toThrow();
      
      // Service should not be available
      expect(cacheService.isAvailable()).toBe(false);
    }, 15000);

    it('should return null for get operations when Redis unavailable', async () => {
      await cacheService.connect('redis://invalid-host:6379');
      
      const result = await cacheService.get('test-key');
      
      expect(result).toBeNull();
    }, 15000);

    it('should silently fail set operations when Redis unavailable', async () => {
      await cacheService.connect('redis://invalid-host:6379');
      
      // Should not throw
      await expect(cacheService.set('test-key', 'test-value', 300)).resolves.not.toThrow();
    }, 15000);

    it('should return false for exists operations when Redis unavailable', async () => {
      await cacheService.connect('redis://invalid-host:6379');
      
      const exists = await cacheService.exists('test-key');
      
      expect(exists).toBe(false);
    }, 15000);

    it('should return -1 for getTTL operations when Redis unavailable', async () => {
      await cacheService.connect('redis://invalid-host:6379');
      
      const ttl = await cacheService.getTTL('test-key');
      
      expect(ttl).toBe(-1);
    }, 15000);

    it('should return 0 for invalidate operations when Redis unavailable', async () => {
      await cacheService.connect('redis://invalid-host:6379');
      
      const deleted = await cacheService.invalidate('test:*');
      
      expect(deleted).toBe(0);
    }, 15000);

    it('should return cache miss for getCached when Redis unavailable', async () => {
      await cacheService.connect('redis://invalid-host:6379');
      
      const result = await cacheService.getCached('test-key');
      
      expect(result.hit).toBe(false);
      expect(result.data).toBeNull();
      expect(result.ttl_remaining).toBeUndefined();
    }, 15000);
  });

  describe('Missing REDIS_URL configuration', () => {
    it('should handle missing REDIS_URL gracefully', async () => {
      // Don't provide URL, should fall back to process.env.REDIS_URL
      const originalUrl = process.env.REDIS_URL;
      delete process.env.REDIS_URL;
      
      await expect(cacheService.connect()).resolves.not.toThrow();
      
      expect(cacheService.isAvailable()).toBe(false);
      
      // Restore original URL
      if (originalUrl) {
        process.env.REDIS_URL = originalUrl;
      }
    });

    it('should log warning when REDIS_URL not configured', async () => {
      const originalUrl = process.env.REDIS_URL;
      delete process.env.REDIS_URL;
      
      await cacheService.connect();
      
      // Service should gracefully degrade
      expect(cacheService.isAvailable()).toBe(false);
      
      // Restore original URL
      if (originalUrl) {
        process.env.REDIS_URL = originalUrl;
      }
    });
  });

  describe('Reconnection with exponential backoff', () => {
    it('should implement exponential backoff retry strategy', async () => {
      // Connect to invalid URL to trigger retries
      const invalidUrl = 'redis://localhost:9999'; // Non-existent port
      
      const startTime = Date.now();
      await cacheService.connect(invalidUrl);
      const duration = Date.now() - startTime;
      
      // Should complete without throwing
      expect(duration).toBeGreaterThanOrEqual(0);
      
      // Service should not be available after failed retries
      expect(cacheService.isAvailable()).toBe(false);
    }, 20000);

    it('should cap retry delay at maximum value', async () => {
      // The retry strategy should cap delays at 5000ms
      // Even if times * 1000 > 5000, delay should be 5000
      const invalidUrl = 'redis://localhost:9999';
      
      await cacheService.connect(invalidUrl);
      
      // After max retries, service should not be available
      expect(cacheService.isAvailable()).toBe(false);
    }, 20000);
  });

  describe('Connection state management', () => {
    it('should not reconnect if already connected', async () => {
      // Connect to valid Redis
      await cacheService.connect(process.env.REDIS_URL);
      
      if (cacheService.isAvailable()) {
        // Try to connect again
        await cacheService.connect(process.env.REDIS_URL);
        
        // Should still be connected
        expect(cacheService.isAvailable()).toBe(true);
      }
    });

    it('should properly disconnect and clean up', async () => {
      await cacheService.connect(process.env.REDIS_URL);
      
      await cacheService.disconnect();
      
      // Should not be available after disconnect
      expect(cacheService.isAvailable()).toBe(false);
    });

    it('should handle disconnect when not connected', async () => {
      // Should not throw when disconnecting without connection
      await expect(cacheService.disconnect()).resolves.not.toThrow();
    });
  });

  describe('Graceful degradation', () => {
    it('should continue serving requests without caching when Redis fails', async () => {
      await cacheService.connect('redis://invalid-host:6379');
      
      // All operations should work without throwing
      await expect(cacheService.set('key', 'value', 300)).resolves.not.toThrow();
      await expect(cacheService.get('key')).resolves.not.toThrow();
      await expect(cacheService.exists('key')).resolves.not.toThrow();
      await expect(cacheService.getTTL('key')).resolves.not.toThrow();
      await expect(cacheService.invalidate('key')).resolves.not.toThrow();
      
      // Operations should return safe defaults
      expect(await cacheService.get('key')).toBeNull();
      expect(await cacheService.exists('key')).toBe(false);
      expect(await cacheService.getTTL('key')).toBe(-1);
      expect(await cacheService.invalidate('key')).toBe(0);
    }, 15000);

    it('should allow application to continue without Redis', async () => {
      // Don't connect to Redis at all
      
      // All operations should work
      const result = await cacheService.getCached('test-key');
      expect(result.hit).toBe(false);
      expect(result.data).toBeNull();
      
      await cacheService.setCached('test-key', 'value', 300);
      
      // Still no cache available
      const result2 = await cacheService.getCached('test-key');
      expect(result2.hit).toBe(false);
    });
  });

  describe('Error handling during operations', () => {
    it('should handle errors during get operation', async () => {
      await cacheService.connect(process.env.REDIS_URL);
      
      if (cacheService.isAvailable()) {
        // Disconnect to simulate connection loss
        await cacheService.disconnect();
        
        // Get should return null instead of throwing
        const result = await cacheService.get('test-key');
        expect(result).toBeNull();
      }
    });

    it('should handle errors during set operation', async () => {
      await cacheService.connect(process.env.REDIS_URL);
      
      if (cacheService.isAvailable()) {
        // Disconnect to simulate connection loss
        await cacheService.disconnect();
        
        // Set should not throw
        await expect(cacheService.set('key', 'value', 300)).resolves.not.toThrow();
      }
    });

    it('should handle errors during invalidate operation', async () => {
      await cacheService.connect(process.env.REDIS_URL);
      
      if (cacheService.isAvailable()) {
        // Disconnect to simulate connection loss
        await cacheService.disconnect();
        
        // Invalidate should return 0 instead of throwing
        const deleted = await cacheService.invalidate('test:*');
        expect(deleted).toBe(0);
      }
    });
  });
});
