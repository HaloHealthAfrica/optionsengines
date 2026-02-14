/**
 * Flow API - Netflow, confluence, trade gate, position sizing for Flow page
 */
import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../services/database.service.js';
import { authService } from '../services/auth.service.js';
import { positioningService } from '../services/positioning.service.js';
import { confluenceService } from '../services/confluence.service.js';
import { alertService } from '../services/alert.service.js';
import { config } from '../config/index.js';
import { getFlowConfig, updateFlowConfig } from '../services/flow-config.service.js';
import { marketData } from '../services/market-data.js';
import { logger } from '../utils/logger.js';

const router = Router();

/** Flow page supports only these tickers for now */
const FLOW_ALLOWED_SYMBOLS = ['SPY', 'IWM', 'QQQ', 'SMI', 'SPX'];

type AuthPayload = {
  userId: string;
  email: string;
  role: 'admin' | 'researcher' | 'user';
};

function requireAuth(req: Request, res: Response, next: NextFunction): Response | void {
  const token = authService.extractTokenFromHeader(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const payload = authService.verifyToken(token) as AuthPayload | null;
  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  (req as Request & { user?: AuthPayload }).user = payload;
  return next();
}

function formatNotional(value: number): string {
  if (!Number.isFinite(value)) return '--';
  const absValue = Math.abs(value);
  const sign = value >= 0 ? '' : '-';
  if (absValue >= 1e9) return `${sign}$${(absValue / 1e9).toFixed(1)}B`;
  if (absValue >= 1e6) return `${sign}$${(absValue / 1e6).toFixed(1)}M`;
  if (absValue >= 1e3) return `${sign}$${(absValue / 1e3).toFixed(1)}K`;
  return `${sign}$${absValue.toFixed(0)}`;
}

/** Flow/Confluence config (read-only) - must be before :symbol */
router.get('/config', requireAuth, async (_req: Request, res: Response) => {
  const flowConfig = await getFlowConfig();
  res.json({
    confluenceMinThreshold: flowConfig.confluenceMinThreshold,
    enableConfluenceGate: flowConfig.enableConfluenceGate,
    enableConfluenceSizing: flowConfig.enableConfluenceSizing,
    basePositionSize: flowConfig.basePositionSize,
  });
});

/** PATCH Flow/Confluence config (Phase 8: editable from UI) */
router.patch('/config', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    if (typeof body.confluenceMinThreshold === 'number') updates.confluenceMinThreshold = body.confluenceMinThreshold;
    if (typeof body.enableConfluenceGate === 'boolean') updates.enableConfluenceGate = body.enableConfluenceGate;
    if (typeof body.enableConfluenceSizing === 'boolean') updates.enableConfluenceSizing = body.enableConfluenceSizing;
    if (typeof body.basePositionSize === 'number') updates.basePositionSize = body.basePositionSize;
    const flowConfig = await updateFlowConfig(updates as Parameters<typeof updateFlowConfig>[0]);
    res.json(flowConfig);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update flow config' });
  }
});

/** Alerts configuration status (no secrets) - must be before :symbol */
router.get('/alerts/status', requireAuth, async (_req: Request, res: Response) => {
  const flowConfig = await getFlowConfig();
  res.json({
    alertsEnabled: config.alertsEnabled,
    discordConfigured: Boolean(config.discordWebhookUrl),
    slackConfigured: Boolean(config.slackWebhookUrl),
    confluenceThreshold: flowConfig.confluenceMinThreshold,
    cooldownMinutes: config.alertCooldownMinutes,
  });
});

/** Alert history (Phase 9) */
router.get('/alerts/history', requireAuth, async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const symbol = req.query.symbol as string | undefined;
  try {
    const query = symbol
      ? `SELECT flow_alert_id, symbol, direction, confluence_score, netflow_formatted, gamma_regime, sent_to_discord, sent_to_slack, created_at
         FROM flow_alerts WHERE symbol = $1 ORDER BY created_at DESC LIMIT $2`
      : `SELECT flow_alert_id, symbol, direction, confluence_score, netflow_formatted, gamma_regime, sent_to_discord, sent_to_slack, created_at
         FROM flow_alerts ORDER BY created_at DESC LIMIT $1`;
    const result = symbol
      ? await db.query(query, [symbol.toUpperCase(), limit])
      : await db.query(query, [limit]);
    res.json({ alerts: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch alert history' });
  }
});

/** Top Net Impact - net premium per ticker for bar chart (Market Tide style) */
router.get('/top-net-impact', requireAuth, async (_req: Request, res: Response) => {
  try {
    const { positioningService } = await import('../services/positioning.service.js');
    const results: Array<{ symbol: string; netPremium: number; formatted: string }> = [];
    for (const sym of FLOW_ALLOWED_SYMBOLS) {
      const flow = await positioningService.getOptionsFlowSnapshot(sym, 100);
      const callPremium = flow.entries
        .filter((e: { side?: string }) => e.side === 'call')
        .reduce((s: number, e: { premium?: number }) => s + Number(e.premium || 0), 0);
      const putPremium = flow.entries
        .filter((e: { side?: string }) => e.side === 'put')
        .reduce((s: number, e: { premium?: number }) => s + Number(e.premium || 0), 0);
      const netPremium = callPremium - putPremium;
      results.push({ symbol: sym, netPremium, formatted: formatNotional(netPremium) });
    }
    results.sort((a, b) => b.netPremium - a.netPremium);
    res.json({ tickers: results });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch top net impact' });
  }
});

/** Send test alert to Discord/Slack (bypasses cooldown) */
router.post('/alerts/test', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await alertService.sendTestAlert();
    res.json({
      success: true,
      discord: result.discord,
      slack: result.slack,
      message:
        !result.discord && !result.slack
          ? 'No webhooks configured. Set DISCORD_WEBHOOK_URL or SLACK_WEBHOOK_URL.'
          : `Test sent to ${[result.discord && 'Discord', result.slack && 'Slack'].filter(Boolean).join(' and ')}.`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to send test alert',
    });
  }
});

router.get('/:symbol', requireAuth, async (req: Request, res: Response) => {
  const symbol = String(req.params.symbol || 'SPY').toUpperCase();

  if (!FLOW_ALLOWED_SYMBOLS.includes(symbol)) {
    return res.status(400).json({
      error: 'Symbol not supported for Flow',
      symbol,
      allowedSymbols: FLOW_ALLOWED_SYMBOLS,
    });
  }

  try {
    const [gex, flow, zScoreResult, flowConfig] = await Promise.all([
      positioningService.getGexSnapshot(symbol),
      positioningService.getOptionsFlowSnapshot(symbol, 100),
      positioningService.getNetflowZScore(symbol, 20),
      getFlowConfig(),
    ]);

    const flowSource = flow.source ?? 'marketdata';
    res.setHeader('x-data-source', flowSource);

    const callPremium = flow.entries
      .filter((e) => e.side === 'call')
      .reduce((s, e) => s + Number(e.premium || 0), 0);
    const putPremium = flow.entries
      .filter((e) => e.side === 'put')
      .reduce((s, e) => s + Number(e.premium || 0), 0);
    const netflow = callPremium - putPremium;
    const totalPremium = callPremium + putPremium;

    const confluence = confluenceService.computeConfluenceFromPositioning({
      optionsFlow: flow,
      gex,
    });

    const dealerPosition = String(gex.dealerPosition || '').toLowerCase();
    const gammaRegime =
      dealerPosition === 'long_gamma'
        ? 'LONG_GAMMA'
        : dealerPosition === 'short_gamma'
          ? 'SHORT_GAMMA'
          : 'NEUTRAL';

    const callVolume = flow.entries
      .filter((e) => e.side === 'call')
      .reduce((s, e) => s + Number(e.volume || 0), 0);
    const putVolume = flow.entries
      .filter((e) => e.side === 'put')
      .reduce((s, e) => s + Number(e.volume || 0), 0);
    const totalVolume = callVolume + putVolume;
    const bullish = totalVolume > 0 ? Math.round((callVolume / totalVolume) * 100) : 0;
    const bearish = totalVolume > 0 ? 100 - bullish : 0;

    return res.json({
      symbol,
      netflow: {
        value: netflow,
        formatted: formatNotional(netflow),
        direction: confluenceService.getFlowDirection(netflow),
      },
      optionsFlow: {
        premium: formatNotional(totalPremium),
        netflow: formatNotional(netflow),
        bullish,
        bearish,
      },
      gamma: {
        regime: gammaRegime,
        zeroGammaLevel: gex.zeroGammaLevel ?? null,
      },
      confluence: {
        score: confluence.score,
        aligned: confluence.aligned,
        alignment: confluence.alignment,
        factors: confluence.factors,
        tradeGatePasses: confluence.tradeGatePasses,
        threshold: flowConfig.confluenceMinThreshold,
      },
      tradeGate: {
        passes: confluence.tradeGatePasses,
        threshold: flowConfig.confluenceMinThreshold,
        reason: confluence.tradeGatePasses ? 'Confluence above threshold' : 'Confluence below threshold',
      },
      positionSize: {
        multiplier: confluence.positionSizeMultiplier,
        tier: confluence.positionSizeTier,
      },
      gex: {
        total: formatNotional(gex.netGex ?? gex.totalCallGex + gex.totalPutGex),
        call: formatNotional(gex.totalCallGex),
        put: formatNotional(gex.totalPutGex),
      },
      maxPain: null,
      flowSource,
      netflowZScore: zScoreResult.zScore != null ? {
        value: Math.round(zScoreResult.zScore * 100) / 100,
        isUnusual: zScoreResult.isUnusual,
        sampleSize: zScoreResult.sampleSize,
      } : null,
      circuitBreakers: config.unusualWhalesOptionsEnabled
        ? (() => {
            try {
              return marketData.getCircuitBreakerStatus();
            } catch {
              return undefined;
            }
          })()
        : undefined,
      flowDebug: flow.flowDebug,
      allowedSymbols: FLOW_ALLOWED_SYMBOLS,
    });
  } catch (error) {
    logger.error('Flow fetch failed', { symbol, error });
    return res.status(500).json({
      error: 'Failed to fetch flow data',
      symbol,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

/** Market Tide - time series of net prem ticks for chart (price, NCP, NPP, volume).
 *  Primary: Unusual Whales net-prem-ticks. Fallback: derive from MarketData.app options flow.
 */
router.get('/:symbol/market-tide', requireAuth, async (req: Request, res: Response) => {
  const symbol = String(req.params.symbol || 'SPY').toUpperCase();
  if (!FLOW_ALLOWED_SYMBOLS.includes(symbol)) {
    return res.status(400).json({ error: 'Symbol not supported', symbol, allowedSymbols: FLOW_ALLOWED_SYMBOLS });
  }
  try {
    const { unusualWhalesOptionsService } = await import('../services/unusual-whales-options.service.js');
    const { marketData } = await import('../services/market-data.js');
    let ticks = await unusualWhalesOptionsService.getNetPremTicks(symbol);
    let source: 'unusualwhales' | 'marketdata' = 'unusualwhales';

    // Fallback: derive time series from MarketData.app options flow when Unusual Whales returns empty
    if (ticks.length === 0) {
      try {
        const flow = await marketData.getOptionsFlow(symbol, 200);
        if (flow.entries.length > 0) {
          const bucketMs = 60 * 60 * 1000; // 1-hour buckets
          const buckets = new Map<number, { callPremium: number; putPremium: number; callVolume: number; putVolume: number }>();
          for (const e of flow.entries) {
            const ts = e.timestamp instanceof Date ? e.timestamp.getTime() : new Date(e.timestamp as string).getTime();
            if (!Number.isFinite(ts)) continue;
            const bucket = Math.floor(ts / bucketMs) * bucketMs;
            const b = buckets.get(bucket) ?? { callPremium: 0, putPremium: 0, callVolume: 0, putVolume: 0 };
            const prem = Number(e.premium ?? 0);
            const vol = Number(e.volume ?? 0);
            if (e.side === 'call') {
              b.callPremium += prem;
              b.callVolume += vol;
            } else {
              b.putPremium += prem;
              b.putVolume += vol;
            }
            buckets.set(bucket, b);
          }
          ticks = Array.from(buckets.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([ts, b]) => ({
              timestamp: ts,
              callPremium: b.callPremium,
              putPremium: b.putPremium,
              callVolume: b.callVolume,
              putVolume: b.putVolume,
              netPremium: b.callPremium - b.putPremium,
            }));
          source = 'marketdata';
        }
      } catch {
        /* fallback failed, keep empty */
      }
    }

    let currentPrice = 0;
    try {
      currentPrice = await marketData.getStockPrice(symbol);
    } catch {
      /* ignore */
    }
    const timeSeries = ticks.map((t) => ({
      timestamp: t.timestamp,
      time: typeof t.timestamp === 'number' ? new Date(t.timestamp).toISOString() : String(t.timestamp),
      callPremium: t.callPremium ?? 0,
      putPremium: t.putPremium ?? 0,
      netPremium: t.netPremium ?? (t.callPremium ?? 0) - (t.putPremium ?? 0),
      volume: -(t.callVolume ?? 0) - (t.putVolume ?? 0),
    }));
    const lastTick = ticks[ticks.length - 1];
    const ncp = lastTick?.callPremium ?? 0;
    const npp = lastTick?.putPremium ?? 0;
    const totalVol = lastTick ? (lastTick.callVolume ?? 0) + (lastTick.putVolume ?? 0) : 0;
    return res.json({
      symbol,
      source,
      currentPrice: Number.isFinite(currentPrice) ? currentPrice : null,
      timeSeries,
      summary: {
        ncp,
        npp,
        netPremium: ncp - npp,
        volume: totalVol,
        formatted: { ncp: formatNotional(ncp), npp: formatNotional(npp), net: formatNotional(ncp - npp) },
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch market tide', symbol });
  }
});

/** Recent signals with confluence for symbol */
router.get('/:symbol/signals', requireAuth, async (req: Request, res: Response) => {
  const symbol = String(req.params.symbol || 'SPY').toUpperCase();
  const limit = Math.min(Number(req.query.limit) || 20, 50);

  try {
    const result = await db.query(
      `SELECT s.signal_id, s.symbol, s.direction, s.status, s.created_at, rs.enriched_data, rs.rejection_reason
       FROM signals s
       LEFT JOIN refactored_signals rs ON rs.signal_id = s.signal_id
       WHERE s.symbol = $1 AND s.created_at >= NOW() - INTERVAL '7 days'
       ORDER BY s.created_at DESC
       LIMIT $2`,
      [symbol, limit]
    );

    const signals = result.rows.map((row: any) => {
      let confluence = null;
      if (row.enriched_data?.confluence) {
        confluence = {
          score: row.enriched_data.confluence.score,
          tradeGatePasses: row.enriched_data.confluence.tradeGatePasses,
          alignment: row.enriched_data.confluence.alignment,
        };
      }
      return {
        signal_id: row.signal_id,
        symbol: row.symbol,
        direction: row.direction,
        status: row.status,
        created_at: row.created_at,
        rejection_reason: row.rejection_reason,
        confluence,
      };
    });

    res.json({ symbol, signals });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch signals', symbol });
  }
});

export default router;
