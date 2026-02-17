/**
 * Score Recalculation - Re-evaluate alert score with fresh price data
 * Used by Tier 1 every 5 minutes. Factors: proximity, integrity, time decay + carried.
 */

import { db } from '../../services/database.service.js';
import type { ScoreSnapshot, ScoringWeights, StratAlertRow } from './types.js';

const DEFAULT_WEIGHTS: Required<ScoringWeights> = {
  proximity: 0.15,
  integrity: 0.1,
  timeDecay: 0.1,
  tfConfluence: 0.2,
  rvol: 0.15,
  patternQuality: 0.15,
  candleShape: 0.05,
  flowAlignment: 0.1,
};

async function getCurrentScoringWeights(): Promise<ScoringWeights> {
  try {
    const r = await db.query(
      `SELECT weights FROM strat_scoring_weights ORDER BY updated_at DESC LIMIT 1`
    );
    const row = r.rows[0];
    if (row?.weights) return row.weights as ScoringWeights;
  } catch {
    // ignore
  }
  return DEFAULT_WEIGHTS;
}

export function getMaxLifeForTimeframe(tf: string): number {
  switch (tf) {
    case '4H':
      return 48;
    case 'D':
      return 120;
    case 'W':
      return 336;
    case 'M':
      return 720;
    default:
      return 120;
  }
}

function tfConfluenceCount(alert: StratAlertRow): number {
  const c = alert.tf_confluence_count;
  if (typeof c === 'number') return c;
  const tf = alert.tf_confluence;
  if (tf && typeof tf === 'object') return Object.keys(tf).length;
  return 0;
}

export function recalculateScore(
  alert: StratAlertRow,
  currentPrice: number,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): { score: number; factors: ScoreSnapshot['factors'] } {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  let score = 0;
  const entryPrice = Number(alert.entry);
  const stopPrice = Number(alert.stop);
  const direction = (alert.direction || '').toLowerCase();
  const isLong = direction === 'long';

  const totalRange = Math.abs(entryPrice - stopPrice) || 0.01;

  // 1. Price Proximity
  let proximityScore: number;
  if (isLong) {
    if (currentPrice >= entryPrice) proximityScore = 100;
    else if (currentPrice <= stopPrice) proximityScore = 0;
    else proximityScore = ((currentPrice - stopPrice) / totalRange) * 100;
  } else {
    if (currentPrice <= entryPrice) proximityScore = 100;
    else if (currentPrice >= stopPrice) proximityScore = 0;
    else proximityScore = ((stopPrice - currentPrice) / totalRange) * 100;
  }
  score += proximityScore * (w.proximity ?? 0.15);

  // 2. Candle Integrity
  let integrityScore = 100;
  if (alert.c1_type === '1' && alert.c2_high != null && alert.c2_low != null) {
    const c2High = Number(alert.c2_high);
    const c2Low = Number(alert.c2_low);
    if (currentPrice > c2High || currentPrice < c2Low) {
      integrityScore = 0;
    } else if (alert.c1_high != null && alert.c1_low != null) {
      const c1Range = Number(alert.c1_high) - Number(alert.c1_low);
      const c2Range = c2High - c2Low;
      const compressionRatio = c2Range > 0 ? 1 - c1Range / c2Range : 0.5;
      integrityScore = Math.max(0, Math.min(100, compressionRatio * 100));
    }
  }
  score += integrityScore * (w.integrity ?? 0.1);

  // 3. Time Decay
  const created = new Date(alert.created_at).getTime();
  const hoursAlive = (Date.now() - created) / 3600000;
  const maxLife = getMaxLifeForTimeframe(alert.timeframe);
  const freshness = Math.max(0, 1 - hoursAlive / maxLife);
  const timeDecayScore = freshness * 100;
  score += timeDecayScore * (w.timeDecay ?? 0.1);

  // 4. TF Confluence (carried)
  const confluenceCount = tfConfluenceCount(alert);
  const confluenceScore = Math.min(100, (confluenceCount / 4) * 100);
  score += confluenceScore * (w.tfConfluence ?? 0.2);

  // 5. RVOL (carried)
  const rvolVal = parseFloat(String(alert.rvol || '0').replace('%', '')) || 0;
  const rvolScore = Math.min(100, Math.max(0, 50 + rvolVal));
  score += rvolScore * (w.rvol ?? 0.15);

  // 6. Pattern Quality (static)
  const pq = alert.pattern_quality_score ?? 50;
  score += pq * (w.patternQuality ?? 0.15);

  // 7. Candle Shape (static)
  const cs = alert.candle_shape_score ?? 50;
  score += cs * (w.candleShape ?? 0.05);

  // 8. Flow Alignment (carried)
  const fa = alert.flow_alignment_score ?? 50;
  score += fa * (w.flowAlignment ?? 0.1);

  const finalScore = Math.round(Math.min(100, Math.max(0, score)));

  const factors: ScoreSnapshot['factors'] = {
    proximity: Math.round(proximityScore),
    integrity: Math.round(integrityScore),
    timeDecay: Math.round(timeDecayScore),
    confluence: Math.round(confluenceScore),
    rvol: Math.round(rvolScore),
    patternQuality: pq,
    candleShape: cs,
    flowAlignment: fa,
  };

  return { score: finalScore, factors };
}

export function buildScoreSnapshot(
  _alert: StratAlertRow,
  newScore: number,
  currentPrice: number,
  factors: ScoreSnapshot['factors'],
  trigger: 'tier1' | 'tier2' | 'manual'
): ScoreSnapshot {
  return {
    timestamp: new Date().toISOString(),
    score: newScore,
    price: currentPrice,
    factors,
    trigger,
  };
}

export { getCurrentScoringWeights };
