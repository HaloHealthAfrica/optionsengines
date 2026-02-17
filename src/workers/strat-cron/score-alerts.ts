/**
 * Score Movement Notifications - Spike, auto-archive, momentum shift, new peak
 */

import { db } from '../../services/database.service.js';
import {
  publishStratAlertScoreSpike,
  publishStratAlertAutoArchived,
  publishStratAlertMomentumShift,
  publishStratAlertNewPeak,
} from '../../services/realtime-updates.service.js';
import { calculateTrend } from './score-history.js';
import type { StratAlertRow } from './types.js';
import type { ScoreSnapshot } from './types.js';

export async function checkScoreAlerts(
  alert: StratAlertRow,
  newScore: number,
  updatedHistory: ScoreSnapshot[]
): Promise<void> {
  const prevScore = alert.current_score ?? alert.initial_score ?? alert.score;
  const scoreDiff = newScore - prevScore;

  // Sudden spike: score jumped 10+ points in a single check
  if (scoreDiff >= 10) {
    publishStratAlertScoreSpike({
      alertId: alert.alert_id,
      symbol: alert.symbol,
      setup: alert.setup,
      direction: alert.direction,
      previousScore: prevScore,
      newScore,
      change: scoreDiff,
      message: `${alert.symbol} ${alert.setup} score spiked +${scoreDiff} to ${newScore}`,
    });
  }

  // Score dropped below 40 for 3+ consecutive checks -> auto-archive
  if (newScore < 40) {
    const lastThree = updatedHistory.slice(-3).map((h) => h.score);
    if (lastThree.length >= 3 && lastThree.every((s) => s < 40)) {
      await db.query(
        `UPDATE strat_alerts SET status = 'archived', archived_reason = 'score_below_40_sustained'
         WHERE alert_id = $1`,
        [alert.alert_id]
      );
      publishStratAlertAutoArchived({
        alertId: alert.alert_id,
        symbol: alert.symbol,
        reason: 'Sustained low score (below 40 for 3+ checks)',
      });
      return;
    }
  }

  // Momentum shift: was weakening, now strengthening
  if (alert.score_trend === 'weakening') {
    const recentSlope = calculateTrend(updatedHistory.slice(-4));
    if (recentSlope === 'strengthening') {
      publishStratAlertMomentumShift({
        alertId: alert.alert_id,
        symbol: alert.symbol,
        message: `${alert.symbol} ${alert.setup} reversed from weakening to strengthening`,
      });
    }
  }

  // New peak: score hit new all-time high >= 75
  const peakScore = alert.peak_score ?? 0;
  if (newScore > peakScore && newScore >= 75) {
    publishStratAlertNewPeak({
      alertId: alert.alert_id,
      symbol: alert.symbol,
      newPeak: newScore,
      message: `${alert.symbol} ${alert.setup} hit new peak score: ${newScore}`,
    });
  }
}
