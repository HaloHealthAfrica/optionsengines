/**
 * Score History Management - Append snapshots, derive trend, velocity
 */

import { db } from '../../services/database.service.js';
import type { ScoreSnapshot } from './types.js';

const MAX_HISTORY_LENGTH = 500;

function trimAndDownsample(history: ScoreSnapshot[], maxLength: number): ScoreSnapshot[] {
  if (history.length <= maxLength) return history;
  const recent = history.slice(-100);
  const older = history.slice(0, -100);
  const downsampled = older.filter((_, i) => i % 3 === 0);
  return [...downsampled, ...recent];
}

export async function appendScoreHistory(
  alertId: string,
  snapshot: ScoreSnapshot
): Promise<ScoreSnapshot[]> {
  const r = await db.query(
    `SELECT score_history FROM strat_alerts WHERE alert_id = $1`,
    [alertId]
  );
  const row = r.rows[0];
  const history: ScoreSnapshot[] = Array.isArray(row?.score_history) ? row.score_history : [];
  history.push(snapshot);
  const trimmed = trimAndDownsample(history, MAX_HISTORY_LENGTH);

  await db.query(
    `UPDATE strat_alerts SET score_history = $1 WHERE alert_id = $2`,
    [JSON.stringify(trimmed), alertId]
  );
  return trimmed;
}

export function calculateTrend(recentHistory: ScoreSnapshot[]): 'strengthening' | 'weakening' | 'stable' {
  if (recentHistory.length < 3) return 'stable';
  const scores = recentHistory.map((h) => h.score);
  const n = scores.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = scores.reduce((s, v) => s + v, 0);
  const sumXY = scores.reduce((s, v, i) => s + i * v, 0);
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  if (Number.isNaN(slope)) return 'stable';
  if (slope > 0.5) return 'strengthening';
  if (slope < -0.5) return 'weakening';
  return 'stable';
}

export function calculateVelocity(history: ScoreSnapshot[]): number {
  if (history.length < 2) return 0;
  const first = history[0];
  const last = history[history.length - 1];
  const hoursDiff =
    (new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) / 3600000;
  if (hoursDiff === 0) return 0;
  return (last.score - first.score) / hoursDiff;
}

export async function updateDerivedFields(
  alertId: string,
  newScore: number,
  history: ScoreSnapshot[]
): Promise<void> {
  const initialScore = history.length > 0 ? history[0].score : newScore;
  const peakScore = Math.max(newScore, ...history.map((h) => h.score));
  const delta = newScore - initialScore;
  const trend = calculateTrend(history.slice(-6));
  const velocity = calculateVelocity(history.slice(-12));

  await db.query(
    `UPDATE strat_alerts SET
      current_score = $1,
      initial_score = $2,
      score_delta = $3,
      peak_score = $4,
      score_trend = $5,
      score_velocity = $6,
      last_evaluated_at = NOW()
    WHERE alert_id = $7`,
    [newScore, initialScore, delta, peakScore, trend, velocity, alertId]
  );
}
