/**
 * Strat Scanner Service - Active pattern detection across watchlist
 * Fetches candles, detects Strat patterns, scores, and upserts to strat_alerts.
 */

import { db } from '../database.service.js';
import { marketData } from '../market-data.js';
import { watchlistManager } from '../strat-plan/watchlist-manager.service.js';
import { publishStratAlertNew } from '../realtime-updates.service.js';
import { indicators as indicatorService } from '../indicators.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import {
  detectStratPatterns,
  classifyCandle,
  classifyCandleShape,
  type DetectedPattern,
} from './strat-patterns.js';
import type { Candle } from '../../types/index.js';

const BUFFER_PERCENT = 0.0005; // 0.05% buffer for entry/stop
const TARGET_ATR_MULTIPLIER = 2;
const MIN_SCORE_FOR_FLOW_ENRICHMENT = 60;

export interface StratScannerOptions {
  symbols?: string[];
  timeframes?: string[];
}

export interface StratAlertRecord {
  symbol: string;
  direction: 'long' | 'short';
  timeframe: string;
  setup: string;
  entry: number;
  target: number;
  stop: number;
  reversalLevel: number | null;
  score: number;
  c1Type: string;
  c2Type: string;
  c1Shape: string;
  atr: number | null;
  rvol: string | null;
  tfConfluence: Record<string, string> | null;
  flowSentiment: 'bullish' | 'bearish' | 'neutral' | null;
  unusualActivity: boolean;
  status: 'pending';
  source: 'scanner';
  optionsSuggestion: string | null;
  conditionText: string;
  expiresAt: Date | null;
}

function getExpirationForTimeframe(tf: string): Date {
  const now = new Date();
  if (tf === '4H') {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return d;
  }
  if (tf === 'D') {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return d;
  }
  if (tf === 'W') {
    const d = new Date(now);
    d.setDate(d.getDate() + 14);
    return d;
  }
  if (tf === 'M') {
    const d = new Date(now);
    d.setMonth(d.getMonth() + 1);
    return d;
  }
  const d = new Date(now);
  d.setDate(d.getDate() + 7);
  return d;
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

function calculateRVOL(candles: Candle[]): string | null {
  if (candles.length < 11) return null;
  const last10 = candles.slice(-11, -1);
  const current = candles[candles.length - 1];
  const avgVolume = last10.reduce((s, c) => s + c.volume, 0) / 10;
  if (avgVolume <= 0) return null;
  const pct = ((current.volume - avgVolume) / avgVolume) * 100;
  return `${Math.round(pct)}%`;
}

function scoreSetup(
  pattern: DetectedPattern,
  atr: number | null,
  rvol: string | null,
  tfConfluence: number,
  candleShape: string
): number {
  let patternQuality = 15;
  if (pattern.setup.includes('2-1-2')) patternQuality = 22;
  if (pattern.setup.includes('3-1-2') || pattern.setup.includes('3-2')) patternQuality = 20;

  const risk = pattern.c1.high - pattern.c1.low;
  const reward = risk * 2; // target typically 2x ATR or 2x range
  const rr = risk > 0 ? reward / risk : 0;
  const riskReward = rr >= 2 ? 20 : rr >= 1.5 ? 15 : rr >= 1 ? 10 : 5;

  const tfScore = Math.min(20, tfConfluence * 5);

  let rvolScore = 5;
  if (rvol) {
    const pct = parseFloat(rvol.replace('%', ''));
    if (pct >= 50) rvolScore = 15;
    else if (pct >= 20) rvolScore = 12;
    else if (pct >= 0) rvolScore = 8;
  }

  let shapeScore = 5;
  if (['hammer', 'bullish', 'bullish marubozu'].includes(candleShape) && pattern.direction === 'long')
    shapeScore = 10;
  else if (
    ['shooting star', 'bearish', 'bearish marubozu'].includes(candleShape) &&
    pattern.direction === 'short'
  )
    shapeScore = 10;
  else if (candleShape === 'doji') shapeScore = 7;

  let atrScore = 5;
  if (atr != null && atr > 0) {
    const range = pattern.c1.high - pattern.c1.low;
    const atrRatio = range / atr;
    if (atrRatio >= 0.5 && atrRatio <= 2) atrScore = 10;
    else if (atrRatio >= 0.3 && atrRatio <= 3) atrScore = 8;
  }

  const total =
    patternQuality + riskReward + tfScore + rvolScore + shapeScore + atrScore;
  return Math.min(100, Math.round(total));
}

export class StratScannerService {
  async run(options: StratScannerOptions = {}): Promise<StratAlertRecord[]> {
    const status = await watchlistManager.getStatus();
    const symbols = options.symbols ?? status.entries.map((e) => e.symbol);
    const timeframes = options.timeframes ?? ['4H', 'D', 'W', 'M'];

    if (symbols.length === 0) {
      logger.info('Strat scanner: no watchlist symbols');
      return [];
    }

    const results: StratAlertRecord[] = [];

    for (const symbol of symbols) {
      for (const tf of timeframes) {
        try {
          const alerts = await this.scanSymbolTimeframe(symbol, tf);
          results.push(...alerts);
        } catch (err) {
          logger.warn('Strat scanner: symbol/tf failed', {
            symbol,
            timeframe: tf,
            error: err,
          });
        }
      }
    }

    if (results.length > 0) {
      await this.upsertAlerts(results);
    }

    await this.expireStaleAlerts();
    return results;
  }

  private async scanSymbolTimeframe(
    symbol: string,
    timeframe: string
  ): Promise<StratAlertRecord[]> {
    const apiTf = mapTimeframeToApi(timeframe);
    const candles = await marketData.getCandles(symbol, apiTf, 20);
    if (candles.length < 3) return [];

    const patterns = detectStratPatterns(candles);
    const results: StratAlertRecord[] = [];

    const atrArr = indicatorService.calculateATR(candles, 14);
    const atr = atrArr.length > 0 ? atrArr[atrArr.length - 1] : null;
    const rvol = calculateRVOL(candles);

    for (const pattern of patterns) {
      // TF confluence: classify other timeframes
      let tfConfluence = 0;
      try {
        const otherTfs = ['4H', 'D', 'W', 'M'].filter((t) => t !== timeframe);
        for (const otf of otherTfs) {
          const oc = await marketData.getCandles(symbol, mapTimeframeToApi(otf), 5);
          if (oc.length >= 2) {
            const last = classifyCandle(oc[oc.length - 1], oc[oc.length - 2]);
            const dir = pattern.direction;
            if (
              (dir === 'long' && (last.type === '2U' || last.type === '1')) ||
              (dir === 'short' && (last.type === '2D' || last.type === '1'))
            ) {
              tfConfluence++;
            }
          }
        }
      } catch {
        tfConfluence = 0;
      }
      const buffer = (pattern.c1.high + pattern.c1.low) / 2 * BUFFER_PERCENT;
      const candleShape = classifyCandleShape(pattern.c1);

      let entry: number;
      let stop: number;
      let target: number;

      if (pattern.direction === 'long') {
        entry = pattern.c1.high + buffer;
        stop = pattern.c1.low - buffer;
        target = atr != null
          ? entry + atr * TARGET_ATR_MULTIPLIER
          : entry + (pattern.c1.high - pattern.c1.low) * 2;
      } else {
        entry = pattern.c1.low - buffer;
        stop = pattern.c1.high + buffer;
        target = atr != null
          ? entry - atr * TARGET_ATR_MULTIPLIER
          : entry - (pattern.c1.high - pattern.c1.low) * 2;
      }

      const score = scoreSetup(
        pattern,
        atr,
        rvol,
        tfConfluence,
        candleShape
      );

      const conditionText =
        pattern.direction === 'long'
          ? `Break above $${entry.toFixed(2)} confirms`
          : `Break below $${entry.toFixed(2)} confirms`;

      const alert: StratAlertRecord = {
        symbol,
        direction: pattern.direction,
        timeframe,
        setup: pattern.setup,
        entry,
        target,
        stop,
        reversalLevel: entry,
        score,
        c1Type: pattern.c1Type,
        c2Type: pattern.c2Type,
        c1Shape: candleShape,
        atr,
        rvol,
        tfConfluence: null,
        flowSentiment: null,
        unusualActivity: false,
        status: 'pending',
        source: 'scanner',
        optionsSuggestion: null,
        conditionText,
        expiresAt: getExpirationForTimeframe(timeframe),
      };

      if (score >= MIN_SCORE_FOR_FLOW_ENRICHMENT && config.unusualWhalesOptionsEnabled) {
        try {
          const flow = await marketData.getOptionsFlow(symbol, 20);
          const callPrem = flow.entries
            .filter((e) => e.side === 'call')
            .reduce((s, e) => s + (e.premium ?? 0), 0);
          const putPrem = flow.entries
            .filter((e) => e.side === 'put')
            .reduce((s, e) => s + (e.premium ?? 0), 0);
          if (callPrem > putPrem * 1.2) alert.flowSentiment = 'bullish';
          else if (putPrem > callPrem * 1.2) alert.flowSentiment = 'bearish';
          else alert.flowSentiment = 'neutral';
          if (flow.entries.length > 10) alert.unusualActivity = true;
          if (alert.flowSentiment === (pattern.direction === 'long' ? 'bullish' : 'bearish'))
            alert.score = Math.min(100, alert.score + 10);
          else if (alert.flowSentiment === (pattern.direction === 'long' ? 'bearish' : 'bullish'))
            alert.score = Math.max(0, alert.score - 10);
        } catch {
          // ignore flow enrichment errors
        }
      }

      results.push(alert);
    }

    return results;
  }

  private async upsertAlerts(alerts: StratAlertRecord[]): Promise<void> {
    for (const a of alerts) {
      try {
        const existing = await db.query(
          `SELECT alert_id FROM strat_alerts
           WHERE symbol = $1 AND timeframe = $2 AND setup = $3 AND status IN ('pending', 'watching')
           LIMIT 1`,
          [a.symbol, a.timeframe, a.setup]
        );

        if (existing.rows.length > 0) continue;

        const insert = await db.query(
          `INSERT INTO strat_alerts (
            symbol, direction, timeframe, setup, entry, target, stop,
            reversal_level, score, c1_type, c2_type, c1_shape, atr, rvol,
            tf_confluence, flow_sentiment, unusual_activity, status, source,
            options_suggestion, condition_text, expires_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
          RETURNING alert_id, symbol, direction, timeframe, setup, entry, target, stop, score, status, source, created_at`,
          [
            a.symbol,
            a.direction,
            a.timeframe,
            a.setup,
            a.entry,
            a.target,
            a.stop,
            a.reversalLevel,
            a.score,
            a.c1Type,
            a.c2Type,
            a.c1Shape,
            a.atr,
            a.rvol,
            a.tfConfluence ? JSON.stringify(a.tfConfluence) : null,
            a.flowSentiment,
            a.unusualActivity,
            a.status,
            a.source,
            a.optionsSuggestion,
            a.conditionText,
            a.expiresAt,
          ]
        );
        const row = insert.rows[0];
        if (row) {
          publishStratAlertNew({
            id: row.alert_id,
            symbol: row.symbol,
            direction: row.direction,
            timeframe: row.timeframe,
            setup: row.setup,
            entry: Number(row.entry),
            target: Number(row.target),
            stop: Number(row.stop),
            score: Number(row.score),
            status: row.status,
            source: row.source,
            createdAt: row.created_at,
          });
        }
      } catch (err) {
        logger.warn('Strat scanner: upsert alert failed', {
          symbol: a.symbol,
          setup: a.setup,
          error: err,
        });
      }
    }
  }

  private async expireStaleAlerts(): Promise<void> {
    try {
      const r = await db.query(
        `UPDATE strat_alerts SET status = 'expired'
         WHERE status IN ('pending', 'watching') AND expires_at IS NOT NULL AND expires_at < NOW()
         RETURNING alert_id`
      );
      if (r.rows.length > 0) {
        logger.info('Strat scanner: expired alerts', { count: r.rows.length });
      }
    } catch (err) {
      logger.warn('Strat scanner: expire stale failed', { error: err });
    }
  }
}

export const stratScannerService = new StratScannerService();
