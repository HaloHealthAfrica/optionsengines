/**
 * Strat Insights Service - Rules-based insight generation from analytics
 */

import { db } from '../database.service.js';
import { stratAnalyticsService } from './strat-analytics.service.js';

export interface Insight {
  type: 'positive' | 'warning' | 'info';
  category: string;
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  actionable: boolean;
  action?: string;
}

export async function generateInsights(): Promise<Insight[]> {
  const insights: Insight[] = [];

  const [patterns, , symbols, calibration, flow, confluence, sessions] =
    await Promise.all([
      stratAnalyticsService.getPatternPerformance(),
      stratAnalyticsService.getTimeframePerformance(),
      stratAnalyticsService.getSymbolPerformance(),
      stratAnalyticsService.getScoreCalibration(),
      stratAnalyticsService.getFlowAlignmentPerformance(),
      stratAnalyticsService.getConfluencePerformance(),
      stratAnalyticsService.getTimeOfDayPerformance(),
    ]);

  const bestPattern = patterns.filter((p) => p.sampleSize >= 20)[0];
  const worstPattern = [...patterns]
    .filter((p) => p.sampleSize >= 20)
    .sort((a, b) => a.winRate - b.winRate)[0];

  if (bestPattern) {
    insights.push({
      type: 'positive',
      category: 'pattern',
      title: `${bestPattern.pattern} is your best setup`,
      description: `${(bestPattern.winRate * 100).toFixed(0)}% win rate over ${bestPattern.sampleSize} trades with ${bestPattern.avgRR.toFixed(1)}R average. Consider prioritizing these alerts.`,
      impact: 'high',
      actionable: true,
      action: `Increase weight for ${bestPattern.pattern} patterns in scoring model`,
    });
  }

  if (worstPattern && worstPattern.winRate < 0.4) {
    insights.push({
      type: 'warning',
      category: 'pattern',
      title: `${worstPattern.pattern} is underperforming`,
      description: `Only ${(worstPattern.winRate * 100).toFixed(0)}% win rate over ${worstPattern.sampleSize} trades. Consider filtering these out or tightening entry criteria.`,
      impact: 'high',
      actionable: true,
      action: `Suppress or reduce score for ${worstPattern.pattern} alerts`,
    });
  }

  const overScored = calibration.find(
    (c) => c.sampleSize >= 20 && c.actualWinRate < c.predictedWinRate - 0.2
  );
  if (overScored) {
    insights.push({
      type: 'warning',
      category: 'scoring',
      title: `Scoring model is over-confident in the ${overScored.range} range`,
      description: `Predicted ~${(overScored.predictedWinRate * 100).toFixed(0)}% win rate but actual is ${(overScored.actualWinRate * 100).toFixed(0)}%. The scoring model needs recalibration.`,
      impact: 'medium',
      actionable: true,
      action: 'Run scoring weight tuner to recalibrate',
    });
  }

  if (
    flow.sampleSizes.aligned >= 20 &&
    flow.sampleSizes.opposing >= 20
  ) {
    if (flow.flowAlignmentEdge > 0.15) {
      insights.push({
        type: 'positive',
        category: 'flow',
        title: `Options flow alignment adds ${(flow.flowAlignmentEdge * 100).toFixed(0)}% edge`,
        description: `Trades aligned with UW flow: ${(flow.alignedWinRate * 100).toFixed(0)}% vs opposing: ${(flow.opposingWinRate * 100).toFixed(0)}%. Flow data is a strong confirming signal.`,
        impact: 'high',
        actionable: true,
        action: 'Increase flow alignment weight in scoring model',
      });
    } else if (flow.flowAlignmentEdge < 0.05) {
      insights.push({
        type: 'info',
        category: 'flow',
        title: 'Options flow data is not adding significant edge',
        description: `Only ${(flow.flowAlignmentEdge * 100).toFixed(0)}% difference between aligned and opposing flow. Consider reducing its weight in the score.`,
        impact: 'low',
        actionable: true,
        action: 'Reduce or remove flow alignment from scoring',
      });
    }
  }

  const highConf = confluence.find((c) => c.confluenceCount >= 3);
  const lowConf = confluence.find((c) => c.confluenceCount <= 1);
  if (
    highConf &&
    lowConf &&
    highConf.sampleSize >= 15 &&
    lowConf.sampleSize >= 15
  ) {
    const edge = highConf.winRate - lowConf.winRate;
    if (edge > 0.15) {
      insights.push({
        type: 'positive',
        category: 'confluence',
        title: `3+ timeframe confluence adds ${(edge * 100).toFixed(0)}% win rate`,
        description: `High confluence win rate: ${(highConf.winRate * 100).toFixed(0)}% vs low: ${(lowConf.winRate * 100).toFixed(0)}%. Always prefer setups with 3+ TF alignment.`,
        impact: 'high',
        actionable: true,
      });
    }
  }

  const sortedSessions = [...sessions].sort((a, b) => b.winRate - a.winRate);
  const bestSession = sortedSessions[0];
  const worstSession = sortedSessions[sortedSessions.length - 1];
  if (bestSession && worstSession && bestSession.sampleSize >= 15) {
    insights.push({
      type: 'info',
      category: 'timing',
      title: `Best trading session: ${bestSession.session}`,
      description: `${(bestSession.winRate * 100).toFixed(0)}% win rate vs ${(worstSession.winRate * 100).toFixed(0)}% in ${worstSession.session}. Consider prioritizing alerts during ${bestSession.session}.`,
      impact: 'medium',
      actionable: false,
    });
  }

  const bestSymbol = symbols
    .filter((s) => s.totalAlerts >= 15)
    .sort((a, b) => b.winRate - a.winRate)[0];
  if (bestSymbol) {
    insights.push({
      type: 'positive',
      category: 'symbol',
      title: `${bestSymbol.symbol} responds best to strat patterns`,
      description: `${(bestSymbol.winRate * 100).toFixed(0)}% win rate, best with ${bestSymbol.bestPattern ?? 'N/A'} on ${bestSymbol.bestTimeframe ?? 'N/A'}. This is your most "strat-friendly" ticker.`,
      impact: 'medium',
      actionable: false,
    });
  }

  const sorted = insights.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.impact] - order[b.impact];
  });

  return sorted;
}

export async function saveInsights(insights: Insight[]): Promise<void> {
  await db.query(`DELETE FROM strat_insights`);
  for (const i of insights) {
    await db.query(
      `INSERT INTO strat_insights (type, category, title, description, impact, actionable, action)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        i.type,
        i.category,
        i.title,
        i.description,
        i.impact,
        i.actionable,
        i.action ?? null,
      ]
    );
  }
}

export async function getCachedInsights(limit = 20): Promise<Insight[]> {
  const result = await db.query(
    `SELECT type, category, title, description, impact, actionable, action
     FROM strat_insights
     ORDER BY generated_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows.map((r) => ({
    type: r.type as Insight['type'],
    category: r.category,
    title: r.title,
    description: r.description,
    impact: r.impact as Insight['impact'],
    actionable: r.actionable,
    action: r.action ?? undefined,
  }));
}
