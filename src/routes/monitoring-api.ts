/**
 * Monitoring API - Provider health and probe endpoints.
 * Mounted at /api/v1/monitoring for versioned API consistency.
 */
import { Router, Request, Response } from 'express';
import { marketData } from '../services/market-data.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/v1/monitoring/provider-health
 * Returns health status for all market data providers including Unusual Whales.
 */
router.get('/provider-health', async (_req: Request, res: Response) => {
  try {
    const providers = await marketData.healthCheckAll();
    const circuitBreakers = marketData.getCircuitBreakerStatus();
    return res.json({
      providers,
      circuit_breakers: circuitBreakers,
    });
  } catch (error) {
    logger.error('Provider health check failed', error);
    return res.status(500).json({ error: 'Provider health check failed' });
  }
});

/**
 * GET /api/v1/monitoring/provider-probe?symbol=SPY
 * Probes option chain and options flow, returns source info for E2E validation.
 */
router.get('/provider-probe', async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || 'SPY').toUpperCase();
  try {
    const [chain, flow] = await Promise.all([
      marketData.getOptionsChain(symbol).catch((e) => {
        logger.warn('Provider probe: options chain failed', { symbol, error: e });
        return [] as any[];
      }),
      marketData.getOptionsFlow(symbol, 10).catch((e) => {
        logger.warn('Provider probe: options flow failed', { symbol, error: e });
        return { entries: [], flowDebug: `error: ${(e as Error).message}` } as any;
      }),
    ]);

    const flowDebug = (flow as any)?.flowDebug ?? 'unknown';
    const entryCount = Array.isArray((flow as any)?.entries) ? (flow as any).entries.length : 0;

    return res.json({
      symbol,
      optionChain: { rowCount: Array.isArray(chain) ? chain.length : 0 },
      optionsFlow: { entryCount, flowDebug },
    });
  } catch (error) {
    logger.error('Provider probe failed', error);
    return res.status(500).json({ error: 'Provider probe failed' });
  }
});

export default router;
