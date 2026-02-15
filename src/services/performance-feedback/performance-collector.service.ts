/**
 * Performance Collector - Captures trade outcomes on close for P&L feedback.
 * Correlates outcomes with UnifiedBiasState at entry.
 */

import { db } from '../database.service.js';
import { logger } from '../../utils/logger.js';
import type { UnifiedBiasState } from '../../lib/mtfBias/types-v3.js';

export interface TradeOutcomeCapture {
  positionId: string;
  symbol: string;
  direction: 'long' | 'short';
  entryStateSnapshot?: UnifiedBiasState | null;
  exitStateSnapshot?: UnifiedBiasState | null;
  /** Override when entryStateSnapshot not available */
  entryBiasScore?: number | null;
  entryMacroClass?: string | null;
  entryRegime?: string | null;
  entryIntent?: string | null;
  entryAcceleration?: number | null;
  pnlR: number;
  pnlPercent: number;
  durationMinutes: number;
  exitReasonCodes: string[];
  timestamp: Date;
  /** 'live' | 'simulation' for cleanup */
  source?: 'live' | 'simulation';
}

/**
 * Capture trade outcome on close. Stores in bias_trade_performance.
 */
export async function captureTradeOutcome(capture: TradeOutcomeCapture): Promise<void> {
  try {
    const entry = capture.entryStateSnapshot;
    const entryBiasScore = entry?.biasScore ?? capture.entryBiasScore ?? null;
    const entryMacroClass = entry?.macroClass ?? capture.entryMacroClass ?? null;
    const entryRegime = entry?.regimeType ?? capture.entryRegime ?? null;
    const entryIntent =
      entry?.intentType ?? entry?.riskContext?.entryModeHint ?? capture.entryIntent ?? null;
    const entryAcceleration =
      entry?.acceleration?.stateStrengthDelta ?? capture.entryAcceleration ?? null;

    await db.query(
      `INSERT INTO bias_trade_performance (
        position_id,
        symbol,
        direction,
        pnl_r,
        pnl_percent,
        duration_minutes,
        entry_bias_score,
        entry_macro_class,
        entry_regime,
        entry_intent,
        entry_acceleration,
        exit_reason_codes,
        source,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        capture.positionId,
        capture.symbol,
        capture.direction,
        capture.pnlR,
        capture.pnlPercent,
        capture.durationMinutes,
        entryBiasScore,
        entryMacroClass,
        entryRegime,
        entryIntent,
        entryAcceleration,
        capture.exitReasonCodes,
        capture.source ?? 'live',
        capture.timestamp,
      ]
    );
    logger.debug('Trade outcome captured', {
      positionId: capture.positionId,
      symbol: capture.symbol,
      pnlR: capture.pnlR,
      pnlPercent: capture.pnlPercent,
    });
  } catch (error) {
    logger.error('Failed to capture trade outcome', error, { positionId: capture.positionId });
  }
}
