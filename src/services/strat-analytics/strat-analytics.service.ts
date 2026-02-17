/**
 * Strat Analytics Service - Aggregates alert outcomes for feedback loop insights
 * Performance by pattern, timeframe, symbol, score calibration, market regime, flow alignment
 */

import { db } from '../database.service.js';

export interface DateRange {
  from: Date;
  to: Date;
}

export interface OverallStats {
  totalAlerts: number;
  triggeredCount: number;
  triggerRate: number;
  targetHitCount: number;
  stopHitCount: number;
  winRate: number;
  avgRR: number;
  avgMFE: number;
  avgMAE: number;
  profitFactor: number;
  expectancy: number;
}

export interface PatternStats {
  pattern: string;
  totalAlerts: number;
  winRate: number;
  avgRR: number;
  avgScore: number;
  bestTimeframe: string | null;
  profitFactor: number;
  sampleSize: number;
  isStatisticallySignificant: boolean;
}

export interface TimeframeStats {
  timeframe: string;
  winRate: number;
  avgRR: number;
  avgHoldTime: number | null;
  triggerRate: number;
  sampleSize: number;
}

export interface SymbolStats {
  symbol: string;
  winRate: number;
  avgRR: number;
  bestPattern: string | null;
  bestTimeframe: string | null;
  totalAlerts: number;
  profitFactor: number;
}

export interface ScoreCalibrationData {
  range: string;
  predictedWinRate: number;
  actualWinRate: number;
  sampleSize: number;
  avgRR: number;
  isCalibrated: boolean;
}

export interface RegimeStats {
  regime: string;
  winRate: number;
  avgRR: number;
  sampleSize: number;
  recommendation?: string;
}

export interface FlowAlignmentStats {
  alignedWinRate: number;
  opposingWinRate: number;
  neutralWinRate: number;
  alignedAvgRR: number;
  opposingAvgRR: number;
  flowAlignmentEdge: number;
  isFlowUseful: boolean;
  sampleSizes: { aligned: number; opposing: number; neutral: number };
}

export interface ConfluenceStats {
  confluenceCount: number;
  winRate: number;
  avgRR: number;
  sampleSize: number;
}

export interface CandleShapeStats {
  shape: string;
  winRate: number;
  avgRR: number;
  sampleSize: number;
}

export interface TimeOfDayStats {
  session: string;
  winRate: number;
  avgRR: number;
  sampleSize: number;
}

function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function sum(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0);
}

function calcWinRate(arr: Record<string, unknown>[]): number {
  const resolved = arr.filter((o) =>
    ['target_hit', 'stop_hit'].includes(String(o.outcome ?? ''))
  );
  if (resolved.length === 0) return 0;
  const wins = resolved.filter((o) => o.outcome === 'target_hit').length;
  return wins / resolved.length;
}

function calcProfitFactor(arr: Record<string, unknown>[]): number {
  const resolved = arr.filter((o) =>
    ['target_hit', 'stop_hit'].includes(String(o.outcome ?? ''))
  );
  const positive = sum(
    resolved
      .filter((o) => o.outcome === 'target_hit')
      .map((o) => Number(o.actual_rr ?? 0))
  );
  const negative = Math.abs(
    sum(
      resolved
        .filter((o) => o.outcome === 'stop_hit')
        .map((o) => Number(o.actual_rr ?? 0))
    )
  );
  if (negative === 0) return positive > 0 ? 999 : 0;
  return positive / negative;
}

function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of arr) {
    const k = String(item[key] ?? '');
    if (!out[k]) out[k] = [];
    out[k].push(item);
  }
  return out;
}

export class StratAnalyticsService {
  private async getOutcomes(dateRange?: DateRange): Promise<Record<string, unknown>[]> {
    let query = `SELECT * FROM alert_outcomes WHERE 1=1`;
    const params: unknown[] = [];
    let idx = 1;
    if (dateRange) {
      query += ` AND created_at >= $${idx} AND created_at <= $${idx + 1}`;
      params.push(dateRange.from, dateRange.to);
      idx += 2;
    }
    query += ` ORDER BY created_at DESC`;
    const result = await db.query(query, params);
    return result.rows as Record<string, unknown>[];
  }

  async getOverallStats(dateRange?: DateRange): Promise<OverallStats> {
    const outcomes = await this.getOutcomes(dateRange);
    const triggered = outcomes.filter((o) => o.did_trigger === true);
    const resolved = outcomes.filter((o) =>
      ['target_hit', 'stop_hit'].includes(String(o.outcome ?? ''))
    );
    const wins = outcomes.filter((o) => o.outcome === 'target_hit');
    const losses = outcomes.filter((o) => o.outcome === 'stop_hit');
    const positiveRR = outcomes
      .filter((o) => Number(o.actual_rr ?? 0) > 0)
      .map((o) => Number(o.actual_rr));
    const allRR = outcomes.map((o) => Number(o.actual_rr ?? 0));
    const allMFE = outcomes.map((o) => Number(o.max_favorable_excursion ?? 0));
    const allMAE = outcomes.map((o) => Number(o.max_adverse_excursion ?? 0));
    const sumPos = sum(wins.map((o) => Number(o.actual_rr ?? 0)));
    const sumNeg = Math.abs(sum(losses.map((o) => Number(o.actual_rr ?? 0))));

    return {
      totalAlerts: outcomes.length,
      triggeredCount: triggered.length,
      triggerRate: outcomes.length > 0 ? triggered.length / outcomes.length : 0,
      targetHitCount: wins.length,
      stopHitCount: losses.length,
      winRate: resolved.length > 0 ? wins.length / resolved.length : 0,
      avgRR: average(positiveRR.length > 0 ? positiveRR : [0]),
      avgMFE: average(allMFE),
      avgMAE: average(allMAE),
      profitFactor: sumNeg > 0 ? sumPos / sumNeg : sumPos > 0 ? 999 : 0,
      expectancy: average(allRR),
    };
  }

  async getPatternPerformance(): Promise<PatternStats[]> {
    const outcomes = await this.getOutcomes();
    const grouped = groupBy(outcomes, 'setup_type');
    const result: PatternStats[] = [];

    for (const [pattern, trades] of Object.entries(grouped)) {
      if (!pattern) continue;
      const resolved = trades.filter((o) =>
        ['target_hit', 'stop_hit'].includes(String(o.outcome ?? ''))
      );
      const tfGrouped = groupBy(trades, 'timeframe');
      let bestTf: string | null = null;
      let bestWr = 0;
      for (const [tf, tfTrades] of Object.entries(tfGrouped)) {
        const wr = calcWinRate(tfTrades);
        if (tfTrades.length >= 5 && wr > bestWr) {
          bestWr = wr;
          bestTf = tf;
        }
      }
      result.push({
        pattern,
        totalAlerts: trades.length,
        winRate: calcWinRate(trades),
        avgRR: average(trades.map((t) => Number(t.actual_rr ?? 0))),
        avgScore: average(trades.map((t) => Number(t.score_at_creation ?? 0))),
        bestTimeframe: bestTf,
        profitFactor: calcProfitFactor(trades),
        sampleSize: resolved.length,
        isStatisticallySignificant: trades.length >= 30,
      });
    }
    return result.sort((a, b) => b.winRate - a.winRate);
  }

  async getTimeframePerformance(): Promise<TimeframeStats[]> {
    const outcomes = await this.getOutcomes();
    const grouped = groupBy(outcomes, 'timeframe');
    const result: TimeframeStats[] = [];

    for (const [timeframe, trades] of Object.entries(grouped)) {
      if (!timeframe) continue;
      const triggered = trades.filter((o) => o.did_trigger === true);
      const times = trades
        .map((t) => Number((t as Record<string, unknown>).time_to_outcome_minutes ?? 0))
        .filter((v) => v > 0);
      result.push({
        timeframe,
        winRate: calcWinRate(trades),
        avgRR: average(trades.map((t) => Number(t.actual_rr ?? 0))),
        avgHoldTime: times.length > 0 ? average(times) : null,
        triggerRate: trades.length > 0 ? triggered.length / trades.length : 0,
        sampleSize: trades.length,
      });
    }
    return result.sort((a, b) => b.winRate - a.winRate);
  }

  async getSymbolPerformance(): Promise<SymbolStats[]> {
    const outcomes = await this.getOutcomes();
    const grouped = groupBy(outcomes, 'symbol');
    const result: SymbolStats[] = [];

    for (const [symbol, trades] of Object.entries(grouped)) {
      if (!symbol) continue;
      const patternGrouped = groupBy(trades, 'setup_type');
      const tfGrouped = groupBy(trades, 'timeframe');
      let bestPattern: string | null = null;
      let bestWr = 0;
      for (const [p, pTrades] of Object.entries(patternGrouped)) {
        const wr = calcWinRate(pTrades);
        if (pTrades.length >= 5 && wr > bestWr) {
          bestWr = wr;
          bestPattern = p;
        }
      }
      let bestTf: string | null = null;
      bestWr = 0;
      for (const [tf, tfTrades] of Object.entries(tfGrouped)) {
        const wr = calcWinRate(tfTrades);
        if (tfTrades.length >= 5 && wr > bestWr) {
          bestWr = wr;
          bestTf = tf;
        }
      }
      result.push({
        symbol,
        winRate: calcWinRate(trades),
        avgRR: average(trades.map((t) => Number(t.actual_rr ?? 0))),
        bestPattern,
        bestTimeframe: bestTf,
        totalAlerts: trades.length,
        profitFactor: calcProfitFactor(trades),
      });
    }
    return result.sort((a, b) => b.winRate - a.winRate);
  }

  async getScoreCalibration(): Promise<ScoreCalibrationData[]> {
    const outcomes = await this.getOutcomes();
    const ranges = [
      { min: 0, max: 50, label: '0-50' },
      { min: 50, max: 60, label: '50-60' },
      { min: 60, max: 70, label: '60-70' },
      { min: 70, max: 80, label: '70-80' },
      { min: 80, max: 90, label: '80-90' },
      { min: 90, max: 100, label: '90-100' },
    ];

    return ranges.map((range) => {
      const trades = outcomes.filter(
        (o) =>
          (Number(o.score_at_creation ?? 0) >= range.min &&
            Number(o.score_at_creation ?? 0) < range.max)
      );
      const predictedWR = range.min / 100;
      const actualWR = calcWinRate(trades);
      return {
        range: range.label,
        predictedWinRate: predictedWR,
        actualWinRate: actualWR,
        sampleSize: trades.length,
        avgRR: average(trades.map((t) => Number(t.actual_rr ?? 0))),
        isCalibrated: Math.abs(actualWR - predictedWR) < 0.15,
      };
    });
  }

  async getMarketRegimePerformance(): Promise<RegimeStats[]> {
    const outcomes = await this.getOutcomes();
    const ctx = (o: Record<string, unknown>) =>
      (o.market_context as Record<string, unknown>) ?? {};
    const regimes = {
      bullish_low_vix: outcomes.filter(
        (o) =>
          ctx(o).spy_trend === 'bullish' && Number(ctx(o).vix_level ?? 999) < 20
      ),
      bullish_high_vix: outcomes.filter(
        (o) =>
          ctx(o).spy_trend === 'bullish' && Number(ctx(o).vix_level ?? 0) >= 20
      ),
      bearish_low_vix: outcomes.filter(
        (o) =>
          ctx(o).spy_trend === 'bearish' && Number(ctx(o).vix_level ?? 999) < 20
      ),
      bearish_high_vix: outcomes.filter(
        (o) =>
          ctx(o).spy_trend === 'bearish' && Number(ctx(o).vix_level ?? 0) >= 20
      ),
      neutral: outcomes.filter((o) => ctx(o).spy_trend === 'neutral'),
    };

    return Object.entries(regimes).map(([regime, trades]) => ({
      regime,
      winRate: calcWinRate(trades),
      avgRR: average(trades.map((t) => Number(t.actual_rr ?? 0))),
      sampleSize: trades.length,
    }));
  }

  async getFlowAlignmentPerformance(): Promise<FlowAlignmentStats> {
    const outcomes = await this.getOutcomes();
    const withFlow = outcomes.filter((o) => o.flow_sentiment);
    const dir = (d: unknown) => String(d ?? '').toLowerCase();
    const aligned = withFlow.filter(
      (o) =>
        (dir(o.direction) === 'long' && o.flow_sentiment === 'bullish') ||
        (dir(o.direction) === 'short' && o.flow_sentiment === 'bearish')
    );
    const opposing = withFlow.filter(
      (o) =>
        (dir(o.direction) === 'long' && o.flow_sentiment === 'bearish') ||
        (dir(o.direction) === 'short' && o.flow_sentiment === 'bullish')
    );
    const neutral = withFlow.filter((o) => o.flow_sentiment === 'neutral');

    const alignedWr = calcWinRate(aligned);
    const opposingWr = calcWinRate(opposing);
    const neutralWr = calcWinRate(neutral);
    const edge = alignedWr - opposingWr;

    return {
      alignedWinRate: alignedWr,
      opposingWinRate: opposingWr,
      neutralWinRate: neutralWr,
      alignedAvgRR: average(aligned.map((t) => Number(t.actual_rr ?? 0))),
      opposingAvgRR: average(opposing.map((t) => Number(t.actual_rr ?? 0))),
      flowAlignmentEdge: edge,
      isFlowUseful: edge > 0.1,
      sampleSizes: {
        aligned: aligned.length,
        opposing: opposing.length,
        neutral: neutral.length,
      },
    };
  }

  async getConfluencePerformance(): Promise<ConfluenceStats[]> {
    const outcomes = await this.getOutcomes();
    const grouped = groupBy(outcomes, 'tf_confluence_count');
    const result: ConfluenceStats[] = Object.entries(grouped).map(
      ([count, trades]) => ({
        confluenceCount: parseInt(count, 10) || 0,
        winRate: calcWinRate(trades),
        avgRR: average(trades.map((t) => Number(t.actual_rr ?? 0))),
        sampleSize: trades.length,
      })
    );
    return result.sort((a, b) => a.confluenceCount - b.confluenceCount);
  }

  async getCandleShapePerformance(): Promise<CandleShapeStats[]> {
    const outcomes = await this.getOutcomes();
    const grouped = groupBy(outcomes, 'c1_shape');
    return Object.entries(grouped).map(([shape, trades]) => ({
      shape: shape || 'unknown',
      winRate: calcWinRate(trades),
      avgRR: average(trades.map((t) => Number(t.actual_rr ?? 0))),
      sampleSize: trades.length,
    }));
  }

  async getPatternTimeframeMatrix(): Promise<{ pattern: string; timeframe: string; winRate: number; sampleSize: number }[]> {
    const outcomes = await this.getOutcomes();
    const grouped: Record<string, { wins: number; total: number }> = {};
    for (const o of outcomes) {
      const key = `${String(o.setup_type ?? '')}|${String(o.timeframe ?? '')}`;
      if (!grouped[key]) grouped[key] = { wins: 0, total: 0 };
      if (['target_hit', 'stop_hit'].includes(String(o.outcome ?? ''))) {
        grouped[key].total++;
        if (o.outcome === 'target_hit') grouped[key].wins++;
      }
    }
    return Object.entries(grouped).map(([key, v]) => {
      const [pattern, timeframe] = key.split('|');
      return {
        pattern,
        timeframe,
        winRate: v.total > 0 ? v.wins / v.total : 0,
        sampleSize: v.total,
      };
    });
  }

  async getTimeOfDayPerformance(): Promise<TimeOfDayStats[]> {
    const outcomes = await this.getOutcomes();
    const ctx = (o: Record<string, unknown>) =>
      (o.market_context as Record<string, unknown>) ?? {};
    const sessions: Record<string, Record<string, unknown>[]> = {
      pre_market: outcomes.filter((o) => ctx(o).market_session === 'premarket'),
      open_9_30_10_30: outcomes.filter((o) => ctx(o).market_session === 'open'),
      midday_10_30_14: outcomes.filter((o) => ctx(o).market_session === 'midday'),
      power_hour_14_16: outcomes.filter((o) => ctx(o).market_session === 'power_hour'),
    };
    return Object.entries(sessions).map(([session, trades]) => ({
      session,
      winRate: calcWinRate(trades),
      avgRR: average(trades.map((t) => Number(t.actual_rr ?? 0))),
      sampleSize: trades.length,
    }));
  }
}

export const stratAnalyticsService = new StratAnalyticsService();
