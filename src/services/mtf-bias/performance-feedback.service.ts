/**
 * MTF Bias Performance Feedback Loop
 * Tracks win rate by regime, confidence band, entry_mode_hint.
 * Feeds into setup thresholds and risk multiplier.
 */

import { db } from '../database.service.js';
import { logger } from '../../utils/logger.js';

function confidenceBand(score: number): string {
  if (score >= 0.75) return 'HIGH';
  if (score >= 0.6) return 'MEDIUM';
  return 'LOW';
}

export async function recordTradeOutcome(params: {
  symbol: string;
  regimeType: string;
  confidenceScore: number;
  entryModeHint: string;
  won: boolean;
  rMultiple: number;
}): Promise<void> {
  const band = confidenceBand(params.confidenceScore);

  try {
    await db.query(
      `INSERT INTO performance_feedback (symbol, regime_type, confidence_band, entry_mode_hint, win_count, loss_count, avg_r_multiple, sample_size, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1, NOW())`,
      [
        params.symbol,
        params.regimeType,
        band,
        params.entryModeHint,
        params.won ? 1 : 0,
        params.won ? 0 : 1,
        params.rMultiple,
      ]
    );
  } catch (error) {
    logger.error('Performance feedback record failed', error, { symbol: params.symbol });
  }
}

export async function getWinRateByRegime(regimeType: string): Promise<number | null> {
  const result = await db.query(
    `SELECT SUM(win_count)::float / NULLIF(SUM(win_count + loss_count), 0) as win_rate
     FROM performance_feedback
     WHERE regime_type = $1`,
    [regimeType]
  );
  const rate = result.rows[0]?.win_rate;
  return rate != null ? Number(rate) : null;
}
