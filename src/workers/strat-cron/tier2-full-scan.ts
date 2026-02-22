/**
 * Tier 2: Full Pattern Scan (On Candle Close)
 * Heavy scan: detects NEW patterns, updates slow-changing factors.
 */

import { db } from '../../services/database.service.js';
import { marketData } from '../../services/market-data.js';
import { watchlistManager } from '../../services/strat-plan/watchlist-manager.service.js';
import { stratScannerService } from '../../services/strat-scanner/index.js';
import { runTier1PriceCheck } from './tier1-price-check.js';
import { publishStratScanComplete } from '../../services/realtime-updates.service.js';
import { classifyCandle, classifyCandleShape } from '../../services/strat-scanner/strat-patterns.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import * as Sentry from '@sentry/node';
import type { Candle } from '../../types/index.js';

export type ScanReason =
  | 'scheduled_4h'
  | 'scheduled_daily'
  | 'scheduled_weekly'
  | 'scheduled_monthly'
  | 'manual_refresh'
  | 'new_ticker';

export interface Tier2Options {
  symbols?: string[];
  timeframes?: string[];
  reason?: ScanReason;
}

function mapTimeframeToApi(tf: string): string {
  const map: Record<string, string> = {
    '4H': '4h',
    D: '1d',
    W: '1week',
    M: '1month',
  };
  return map[tf] ?? '1d';
}

function getTimeframesForScanReason(reason?: ScanReason): string[] {
  switch (reason) {
    case 'scheduled_4h':
      return ['4H'];
    case 'scheduled_daily':
      return ['4H', 'D'];
    case 'scheduled_weekly':
      return ['4H', 'D', 'W'];
    case 'scheduled_monthly':
      return ['4H', 'D', 'W', 'M'];
    case 'manual_refresh':
    case 'new_ticker':
      return ['4H', 'D', 'W', 'M'];
    default:
      return ['4H', 'D'];
  }
}

function calculateRVOL(candles: Candle[]): string | null {
  if (candles.length < 11) return null;
  const last10 = candles.slice(-11, -1);
  const current = candles[candles.length - 1];
  const avgVolume = last10.reduce((s, c) => s + c.volume, 0) / 10;
  if (avgVolume <= 0) return null;
  const pct = ((current.volume - avgVolume) / avgVolume) * 100;
  return `${Math.round(pct)}%`;
}

function flowAlignmentScore(
  flowSentiment: string | null,
  direction: string
): number {
  if (!flowSentiment) return 50;
  const isLong = direction.toLowerCase() === 'long';
  if (flowSentiment === (isLong ? 'bullish' : 'bearish')) return 80;
  if (flowSentiment === (isLong ? 'bearish' : 'bullish')) return 20;
  return 50;
}

export async function runTier2FullScan(options: Tier2Options = {}): Promise<{
  alertsCount: number;
  symbolsScanned: number;
  timeframes: string[];
  reason: string;
  tier1Result?: { alertCount: number; triggers: number; invalidations: number };
}> {
  const status = await watchlistManager.getStatus();
  const symbols = options.symbols ?? status.entries.map((e) => e.symbol);
  const timeframes = options.timeframes ?? getTimeframesForScanReason(options.reason);
  const reason = options.reason ?? 'manual_refresh';

  if (symbols.length === 0) {
    logger.info('Tier 2: no watchlist symbols');
    return { alertsCount: 0, symbolsScanned: 0, timeframes, reason };

  }

  const alerts = await stratScannerService.run({ symbols, timeframes });
  const alertsCount = alerts.length;

  const activeAlertsResult = await db.query(
    `SELECT alert_id, symbol, direction, timeframe, setup, current_score,
            flow_sentiment, tf_confluence
     FROM strat_alerts
     WHERE status IN ('pending', 'triggered', 'watching')`
  );

  for (const row of activeAlertsResult.rows) {
    try {
      const symbol = row.symbol;
      const direction = row.direction;
      const timeframe = row.timeframe;

      let tfConfluenceCount = 0;
      const tfConfluence: Record<string, string> = {};
      try {
        const otherTfs = ['4H', 'D', 'W', 'M'].filter((t) => t !== timeframe);
        for (const otf of otherTfs) {
          const oc = await marketData.getCandles(symbol, mapTimeframeToApi(otf), 5);
          if (oc.length >= 2) {
            const last = classifyCandle(oc[oc.length - 1], oc[oc.length - 2]);
            const dir = direction;
            if (
              (dir === 'long' && (last.type === '2U' || last.type === '1')) ||
              (dir === 'short' && (last.type === '2D' || last.type === '1'))
            ) {
              tfConfluenceCount++;
              tfConfluence[otf] = last.type;
            }
          }
        }
      } catch {
        tfConfluenceCount = 0;
      }

      const candles = await marketData.getCandles(symbol, mapTimeframeToApi(timeframe), 3);
      const rvol = candles.length >= 11 ? calculateRVOL(candles) : null;
      const lastCandle = candles[candles.length - 1];
      const newShape = lastCandle ? classifyCandleShape(lastCandle) : row.c1_shape ?? '';

      let newFlowScore = flowAlignmentScore(row.flow_sentiment, direction);
      const currentScore = row.current_score ?? 50;
      if (currentScore > 50 && config.unusualWhalesOptionsEnabled) {
        try {
          const flow = await marketData.getOptionsFlow(symbol, 20);
          const callPrem = flow.entries
            .filter((e) => e.side === 'call')
            .reduce((s, e) => s + (e.premium ?? 0), 0);
          const putPrem = flow.entries
            .filter((e) => e.side === 'put')
            .reduce((s, e) => s + (e.premium ?? 0), 0);
          let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
          if (callPrem > putPrem * 1.2) sentiment = 'bullish';
          else if (putPrem > callPrem * 1.2) sentiment = 'bearish';
          newFlowScore = flowAlignmentScore(sentiment, direction);
        } catch {
          // keep existing
        }
      }

      await db.query(
        `UPDATE strat_alerts SET
          tf_confluence_count = $1,
          tf_confluence = $2,
          rvol = $3,
          c1_shape = $4,
          flow_alignment_score = $5,
          last_full_scan_at = NOW()
        WHERE alert_id = $6`,
        [tfConfluenceCount, JSON.stringify(tfConfluence), rvol, newShape, newFlowScore, row.alert_id]
      );
    } catch (err) {
      logger.warn('Tier 2: slow-factor update failed', {
        alert_id: row.alert_id,
        symbol: row.symbol,
        error: err,
      });
      Sentry.captureException(err, {
        tags: { worker: 'strat-cron', tier: 'tier2' },
        extra: { alert_id: row.alert_id, symbol: row.symbol },
      });
    }
  }

  const tier1Result = await runTier1PriceCheck();

  publishStratScanComplete({
    count: alertsCount,
    scannedAt: new Date().toISOString(),
  });

  logger.info('Tier 2 full scan complete', {
    reason,
    symbolsScanned: symbols.length,
    alertsCount,
    timeframes,
  });

  return {
    alertsCount,
    symbolsScanned: symbols.length,
    timeframes,
    reason,
    tier1Result: {
      alertCount: tier1Result.alertCount,
      triggers: tier1Result.triggers,
      invalidations: tier1Result.invalidations,
    },
  };
}
