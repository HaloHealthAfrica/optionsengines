// Unit Tests: Performance Monitor Service
// Tests response time tracking, slow request alerting, and metrics

import { performanceMonitor } from '../../services/performance-monitor.service.js';

describe('Performance Monitor Service', () => {
  beforeEach(() => {
    performanceMonitor.clearMetrics();
  });

  describe('recordRequest', () => {
    it('should record request metrics', () => {
      performanceMonitor.recordRequest({
        endpoint: '/dashboard',
        method: 'GET',
        statusCode: 200,
        responseTimeMs: 250,
        timestamp: new Date(),
      });

      const stats = performanceMonitor.getStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.avgResponseTime).toBe(250);
    });

    it('should track multiple requests', () => {
      const requests = [
        { responseTimeMs: 100 },
        { responseTimeMs: 200 },
        { responseTimeMs: 300 },
      ];

      requests.forEach((req, i) => {
        performanceMonitor.recordRequest({
          endpoint: `/test${i}`,
          method: 'GET',
          statusCode: 200,
          responseTimeMs: req.responseTimeMs,
          timestamp: new Date(),
        });
      });

      const stats = performanceMonitor.getStats();
      expect(stats.totalRequests).toBe(3);
      expect(stats.avgResponseTime).toBe(200);
    });
  });

  describe('slow request detection', () => {
    it('should count slow requests', () => {
      // Fast request
      performanceMonitor.recordRequest({
        endpoint: '/fast',
        method: 'GET',
        statusCode: 200,
        responseTimeMs: 500,
        timestamp: new Date(),
      });

      // Slow request (>1000ms)
      performanceMonitor.recordRequest({
        endpoint: '/slow',
        method: 'GET',
        statusCode: 200,
        responseTimeMs: 1500,
        timestamp: new Date(),
      });

      const stats = performanceMonitor.getStats();
      expect(stats.slowRequests).toBe(1);
    });
  });

  describe('percentile calculations', () => {
    it('should calculate P95 and P99 correctly', () => {
      // Generate 100 requests with varying response times
      for (let i = 1; i <= 100; i++) {
        performanceMonitor.recordRequest({
          endpoint: '/test',
          method: 'GET',
          statusCode: 200,
          responseTimeMs: i * 10, // 10ms to 1000ms
          timestamp: new Date(),
        });
      }

      const stats = performanceMonitor.getStats();
      expect(stats.p95ResponseTime).toBeGreaterThan(900);
      expect(stats.p99ResponseTime).toBeGreaterThan(980);
    });
  });

  describe('cache hit rate', () => {
    it('should calculate cache hit rate', () => {
      // Request with cache hits
      performanceMonitor.recordRequest({
        endpoint: '/dashboard',
        method: 'GET',
        statusCode: 200,
        responseTimeMs: 200,
        cacheHits: ['gex', 'analytics'],
        cacheMisses: ['performance'],
        timestamp: new Date(),
      });

      const stats = performanceMonitor.getStats();
      // 2 hits out of 3 total = 66.67%
      expect(stats.cacheHitRate).toBeCloseTo(66.67, 1);
    });

    it('should handle requests without cache data', () => {
      performanceMonitor.recordRequest({
        endpoint: '/health',
        method: 'GET',
        statusCode: 200,
        responseTimeMs: 50,
        timestamp: new Date(),
      });

      const stats = performanceMonitor.getStats();
      expect(stats.cacheHitRate).toBe(0);
    });
  });

  describe('getRecentMetrics', () => {
    it('should return recent metrics', () => {
      for (let i = 0; i < 10; i++) {
        performanceMonitor.recordRequest({
          endpoint: `/test${i}`,
          method: 'GET',
          statusCode: 200,
          responseTimeMs: 100,
          timestamp: new Date(),
        });
      }

      const recent = performanceMonitor.getRecentMetrics(5);
      expect(recent.length).toBe(5);
    });
  });

  describe('clearMetrics', () => {
    it('should clear all metrics', () => {
      performanceMonitor.recordRequest({
        endpoint: '/test',
        method: 'GET',
        statusCode: 200,
        responseTimeMs: 100,
        timestamp: new Date(),
      });

      performanceMonitor.clearMetrics();

      const stats = performanceMonitor.getStats();
      expect(stats.totalRequests).toBe(0);
    });
  });
});
