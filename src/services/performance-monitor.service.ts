// Performance Monitoring Service - Tracks response times, slow queries, and cache metrics
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

interface ResponseMetrics {
  endpoint: string;
  method: string;
  statusCode: number;
  responseTimeMs: number;
  cacheHits?: string[];
  cacheMisses?: string[];
  timestamp: Date;
}

interface PerformanceStats {
  totalRequests: number;
  avgResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  slowRequests: number;
  cacheHitRate: number;
}

class PerformanceMonitorService {
  private metrics: ResponseMetrics[] = [];
  private readonly maxMetrics = 1000; // Keep last 1000 requests
  private readonly slowRequestThreshold = 1000; // 1 second

  // Response time monitoring middleware
  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();
      const originalSend = res.send;

      // Capture response
      res.send = function (data: any) {
        const responseTime = Date.now() - startTime;
        
        // Extract cache metrics from response if available
        let cacheHits: string[] | undefined;
        let cacheMisses: string[] | undefined;
        
        try {
          if (typeof data === 'string') {
            const parsed = JSON.parse(data);
            if (parsed.metadata) {
              cacheHits = parsed.metadata.cache_hits;
              cacheMisses = parsed.metadata.cache_misses;
            }
          }
        } catch {
          // Not JSON or no metadata, ignore
        }

        // Record metrics
        performanceMonitor.recordRequest({
          endpoint: req.path,
          method: req.method,
          statusCode: res.statusCode,
          responseTimeMs: responseTime,
          cacheHits,
          cacheMisses,
          timestamp: new Date(),
        });

        // Log slow requests
        if (responseTime > performanceMonitor.slowRequestThreshold) {
          logger.warn('Slow request detected', {
            endpoint: req.path,
            method: req.method,
            responseTimeMs: responseTime,
            statusCode: res.statusCode,
            cacheHits,
            cacheMisses,
          });
        }

        return originalSend.call(this, data);
      };

      next();
    };
  }

  recordRequest(metrics: ResponseMetrics): void {
    this.metrics.push(metrics);
    
    // Keep only last N metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }

    // Log all requests with timing
    logger.info('Request completed', {
      endpoint: metrics.endpoint,
      method: metrics.method,
      statusCode: metrics.statusCode,
      responseTimeMs: metrics.responseTimeMs,
      cacheHits: metrics.cacheHits,
      cacheMisses: metrics.cacheMisses,
    });
  }

  getStats(): PerformanceStats {
    if (this.metrics.length === 0) {
      return {
        totalRequests: 0,
        avgResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        slowRequests: 0,
        cacheHitRate: 0,
      };
    }

    const responseTimes = this.metrics.map(m => m.responseTimeMs).sort((a, b) => a - b);
    const avgResponseTime = responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length;
    
    const p95Index = Math.floor(responseTimes.length * 0.95);
    const p99Index = Math.floor(responseTimes.length * 0.99);
    const p95ResponseTime = responseTimes[p95Index] || 0;
    const p99ResponseTime = responseTimes[p99Index] || 0;

    const slowRequests = this.metrics.filter(m => m.responseTimeMs > this.slowRequestThreshold).length;

    // Calculate cache hit rate
    let totalCacheChecks = 0;
    let totalCacheHits = 0;
    
    for (const metric of this.metrics) {
      if (metric.cacheHits) {
        totalCacheHits += metric.cacheHits.length;
        totalCacheChecks += metric.cacheHits.length;
      }
      if (metric.cacheMisses) {
        totalCacheChecks += metric.cacheMisses.length;
      }
    }

    const cacheHitRate = totalCacheChecks > 0 ? (totalCacheHits / totalCacheChecks) * 100 : 0;

    return {
      totalRequests: this.metrics.length,
      avgResponseTime: Math.round(avgResponseTime),
      p95ResponseTime: Math.round(p95ResponseTime),
      p99ResponseTime: Math.round(p99ResponseTime),
      slowRequests,
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
    };
  }

  getRecentMetrics(limit: number = 100): ResponseMetrics[] {
    return this.metrics.slice(-limit);
  }

  clearMetrics(): void {
    this.metrics = [];
    logger.info('Performance metrics cleared');
  }
}

// Slow Query Logger
export class SlowQueryLogger {
  private readonly threshold: number;

  constructor(thresholdMs: number = 500) {
    this.threshold = thresholdMs;
  }

  async logQuery<T>(
    queryName: string,
    queryFn: () => Promise<T>,
    params?: any
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      const result = await queryFn();
      const duration = Date.now() - startTime;

      if (duration > this.threshold) {
        logger.warn('Slow query detected', {
          queryName,
          durationMs: duration,
          threshold: this.threshold,
          params: params ? JSON.stringify(params).substring(0, 200) : undefined,
        });
      } else {
        logger.debug('Query completed', {
          queryName,
          durationMs: duration,
        });
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Query failed', {
        queryName,
        durationMs: duration,
        error,
        params: params ? JSON.stringify(params).substring(0, 200) : undefined,
      });
      throw error;
    }
  }

  wrap<T extends (...args: any[]) => Promise<any>>(
    queryName: string,
    queryFn: T
  ): T {
    return (async (...args: any[]) => {
      return this.logQuery(queryName, () => queryFn(...args), args);
    }) as T;
  }
}

export const performanceMonitor = new PerformanceMonitorService();
export const slowQueryLogger = new SlowQueryLogger(500);
