// Cache Invalidation Service - Invalidates cache on data changes
import { Router, Request, Response, NextFunction } from 'express';
import { redisCache } from './redis-cache.service.js';
import { authService } from './auth.service.js';
import { logger } from '../utils/logger.js';

type AuthPayload = {
  userId: string;
  email: string;
  role: 'admin' | 'researcher' | 'user';
};

class CacheInvalidationService {
  // Invalidate analytics cache when positions are updated
  async invalidateAnalytics(): Promise<void> {
    try {
      const pattern = 'analytics:*';
      const deleted = await redisCache.invalidate(pattern);
      logger.info('Analytics cache invalidated', { keysDeleted: deleted });
    } catch (error) {
      logger.error('Failed to invalidate analytics cache', error);
      // Don't throw - fall back to TTL-based expiration
    }
  }

  // Invalidate source performance cache when signals are updated
  async invalidateSourcePerformance(): Promise<void> {
    try {
      const pattern = 'performance:*';
      const deleted = await redisCache.invalidate(pattern);
      logger.info('Source performance cache invalidated', { keysDeleted: deleted });
    } catch (error) {
      logger.error('Failed to invalidate source performance cache', error);
      // Don't throw - fall back to TTL-based expiration
    }
  }

  // Invalidate GEX cache for specific symbol
  async invalidateGEX(symbol: string): Promise<void> {
    try {
      const pattern = `gex:symbol:${symbol}:*`;
      const deleted = await redisCache.invalidate(pattern);
      logger.info('GEX cache invalidated', { symbol, keysDeleted: deleted });
    } catch (error) {
      logger.error('Failed to invalidate GEX cache', { symbol, error });
      // Don't throw - fall back to TTL-based expiration
    }
  }

  // Invalidate all cache (admin only)
  async invalidateAll(): Promise<number> {
    try {
      const pattern = '*';
      const deleted = await redisCache.invalidate(pattern);
      logger.warn('All cache invalidated', { keysDeleted: deleted });
      return deleted;
    } catch (error) {
      logger.error('Failed to invalidate all cache', error);
      throw error;
    }
  }

  // Create admin routes for cache management
  createAdminRoutes(): Router {
    const router = Router();

    // Middleware to require admin auth
    const requireAdmin = (req: Request, res: Response, next: NextFunction): Response | void => {
      const token = authService.extractTokenFromHeader(req.headers.authorization);
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const payload = authService.verifyToken(token) as AuthPayload | null;
      if (!payload || payload.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden - Admin access required' });
      }

      (req as Request & { user?: AuthPayload }).user = payload;
      return next();
    };

    // Clear all cache
    router.post('/clear', requireAdmin, async (req: Request, res: Response) => {
      try {
        const pattern = req.body.pattern || '*';
        const deleted = await redisCache.invalidate(pattern);
        
        logger.warn('Manual cache clear', {
          pattern,
          keysDeleted: deleted,
          user: (req as any).user?.email,
        });

        return res.json({
          success: true,
          keysDeleted: deleted,
          pattern,
        });
      } catch (error) {
        logger.error('Manual cache clear failed', error);
        return res.status(500).json({
          error: 'Failed to clear cache',
          message: (error as Error).message,
        });
      }
    });

    // Clear analytics cache
    router.post('/clear/analytics', requireAdmin, async (_req: Request, res: Response) => {
      try {
        await cacheInvalidation.invalidateAnalytics();
        return res.json({ success: true, message: 'Analytics cache cleared' });
      } catch (error) {
        return res.status(500).json({ error: 'Failed to clear analytics cache' });
      }
    });

    // Clear source performance cache
    router.post('/clear/performance', requireAdmin, async (_req: Request, res: Response) => {
      try {
        await cacheInvalidation.invalidateSourcePerformance();
        return res.json({ success: true, message: 'Source performance cache cleared' });
      } catch (error) {
        return res.status(500).json({ error: 'Failed to clear performance cache' });
      }
    });

    // Clear GEX cache for symbol
    router.post('/clear/gex/:symbol', requireAdmin, async (req: Request, res: Response) => {
      try {
        const symbol = req.params.symbol.toUpperCase();
        await cacheInvalidation.invalidateGEX(symbol);
        return res.json({ success: true, message: `GEX cache cleared for ${symbol}` });
      } catch (error) {
        return res.status(500).json({ error: 'Failed to clear GEX cache' });
      }
    });

    // Get cache stats
    router.get('/stats', requireAdmin, async (_req: Request, res: Response) => {
      try {
        const isAvailable = redisCache.isAvailable();
        return res.json({
          redis: {
            available: isAvailable,
            connected: isAvailable,
          },
          ttl: {
            gex: redisCache.getTTLForType('gex'),
            analytics: redisCache.getTTLForType('analytics'),
            performance: redisCache.getTTLForType('performance'),
          },
        });
      } catch (error) {
        return res.status(500).json({ error: 'Failed to get cache stats' });
      }
    });

    return router;
  }
}

export const cacheInvalidation = new CacheInvalidationService();
