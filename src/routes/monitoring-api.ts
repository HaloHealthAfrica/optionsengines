/**
 * Monitoring API - Provider health, probe, and Engine B agent monitoring endpoints.
 * Mounted at /api/v1/monitoring for versioned API consistency.
 */
import { Router, Request, Response } from 'express';
import { marketData } from '../services/market-data.js';
import { logger } from '../utils/logger.js';
import { db } from '../services/database.service.js';
import { getAgentWeights } from '../services/dynamic-weight.service.js';
import { checkDrawdownCircuitBreaker, getDrawdownFreezeUntil } from '../services/drawdown-circuit-breaker.service.js';
import { getPortfolioGreeks } from '../services/gamma-exposure.service.js';

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

/**
 * GET /api/v1/monitoring/agent-weights
 * Returns current dynamic weights for all Engine B agents.
 */
router.get('/agent-weights', async (_req: Request, res: Response) => {
  try {
    const weights = await getAgentWeights();
    const result: Record<string, { weight: number; rollingSharpe?: number; tradeCount?: number; lastUpdated: string }> = {};
    for (const [name, config] of weights) {
      result[name] = {
        weight: config.weight,
        rollingSharpe: config.rollingSharpe,
        tradeCount: config.tradeCount,
        lastUpdated: config.lastUpdated.toISOString(),
      };
    }
    return res.json({ agents: result });
  } catch (error) {
    logger.error('Agent weights fetch failed', error);
    return res.status(500).json({ error: 'Agent weights fetch failed' });
  }
});

/**
 * GET /api/v1/monitoring/agent-performance
 * Returns rolling Sharpe, trade count, and attribution summary per agent (30d window).
 */
router.get('/agent-performance', async (_req: Request, res: Response) => {
  try {
    const result = await db.query(
      `SELECT
         agent_name,
         COUNT(*) AS trade_count,
         ROUND(AVG(pnl_contribution)::numeric, 4) AS avg_pnl_contribution,
         ROUND(STDDEV(pnl_contribution)::numeric, 4) AS std_pnl_contribution,
         ROUND(SUM(pnl_contribution)::numeric, 4) AS total_pnl_contribution,
         ROUND((CASE WHEN STDDEV(pnl_contribution) > 0
           THEN AVG(pnl_contribution) / STDDEV(pnl_contribution)
           ELSE 0 END)::numeric, 4) AS rolling_sharpe
       FROM agent_trade_attribution
       WHERE created_at >= NOW() - INTERVAL '30 days'
       GROUP BY agent_name
       ORDER BY rolling_sharpe DESC`
    );

    return res.json({
      window: '30d',
      agents: result.rows.map((r: any) => ({
        agent: r.agent_name,
        tradeCount: Number(r.trade_count),
        avgPnlContribution: Number(r.avg_pnl_contribution),
        stdPnlContribution: Number(r.std_pnl_contribution),
        totalPnlContribution: Number(r.total_pnl_contribution),
        rollingSharpe: Number(r.rolling_sharpe),
      })),
    });
  } catch (error) {
    logger.error('Agent performance fetch failed', error);
    return res.status(500).json({ error: 'Agent performance fetch failed' });
  }
});

/**
 * GET /api/v1/monitoring/circuit-breaker
 * Returns drawdown circuit breaker status.
 */
router.get('/circuit-breaker', async (_req: Request, res: Response) => {
  try {
    const status = await checkDrawdownCircuitBreaker();
    const freezeUntil = getDrawdownFreezeUntil();
    return res.json({
      frozen: status.frozen,
      freezeUntil: freezeUntil?.toISOString() ?? null,
      currentDrawdownPct: status.currentDrawdownPct,
      maxAllowedPct: status.maxAllowedPct,
    });
  } catch (error) {
    logger.error('Circuit breaker status failed', error);
    return res.status(500).json({ error: 'Circuit breaker status failed' });
  }
});

/**
 * GET /api/v1/monitoring/portfolio-exposure
 * Returns net greeks, open position count, and directional exposure.
 */
router.get('/portfolio-exposure', async (_req: Request, res: Response) => {
  try {
    const [greeks, exposureResult] = await Promise.all([
      getPortfolioGreeks(),
      db.query(
        `SELECT
           COUNT(*) AS open_count,
           COUNT(*) FILTER (WHERE type = 'call') AS long_count,
           COUNT(*) FILTER (WHERE type = 'put') AS short_count,
           COALESCE(SUM(entry_price * quantity), 0) AS total_exposure
         FROM refactored_positions
         WHERE status IN ('open', 'closing')
           AND COALESCE(is_test, false) = false`
      ),
    ]);

    const row = exposureResult.rows[0] || {};
    const longCount = Number(row.long_count ?? 0);
    const shortCount = Number(row.short_count ?? 0);
    const totalPositions = Number(row.open_count ?? 0);
    const directionalExposure = totalPositions > 0
      ? (longCount - shortCount) / totalPositions
      : 0;

    return res.json({
      greeks,
      openPositions: totalPositions,
      longCount,
      shortCount,
      totalExposure: Number(row.total_exposure ?? 0),
      directionalExposure: Math.round(directionalExposure * 100) / 100,
    });
  } catch (error) {
    logger.error('Portfolio exposure fetch failed', error);
    return res.status(500).json({ error: 'Portfolio exposure fetch failed' });
  }
});

export default router;
