import { db } from './database.service.js';
import { logger } from '../utils/logger.js';

const DEFAULT_MAX_DRAWDOWN_PCT = 3;
const DEFAULT_FREEZE_MINUTES = 30;

let freezeUntil: Date | null = null;
let lastCheckMs = 0;
const CHECK_INTERVAL_MS = 15_000;

export interface DrawdownStatus {
  frozen: boolean;
  freezeUntil: Date | null;
  currentDrawdownPct: number;
  maxAllowedPct: number;
}

export async function checkDrawdownCircuitBreaker(opts?: {
  maxDrawdownPct?: number;
  freezeMinutes?: number;
}): Promise<DrawdownStatus> {
  const maxPct = opts?.maxDrawdownPct ?? DEFAULT_MAX_DRAWDOWN_PCT;
  const freezeMins = opts?.freezeMinutes ?? DEFAULT_FREEZE_MINUTES;
  const now = Date.now();

  if (freezeUntil && new Date() < freezeUntil) {
    return {
      frozen: true,
      freezeUntil,
      currentDrawdownPct: 0,
      maxAllowedPct: maxPct,
    };
  }

  if (freezeUntil && new Date() >= freezeUntil) {
    logger.info('Drawdown circuit breaker thawed');
    freezeUntil = null;
  }

  if (now - lastCheckMs < CHECK_INTERVAL_MS) {
    return { frozen: false, freezeUntil: null, currentDrawdownPct: 0, maxAllowedPct: maxPct };
  }
  lastCheckMs = now;

  try {
    const result = await db.query(
      `SELECT
         COALESCE(SUM(unrealized_pnl), 0) AS total_unrealized,
         COALESCE(SUM(
           CASE WHEN unrealized_pnl < 0 THEN ABS(unrealized_pnl) ELSE 0 END
         ), 0) AS total_loss,
         COALESCE(SUM(entry_price * quantity), 1) AS total_exposure
       FROM refactored_positions
       WHERE status IN ('open', 'closing')
         AND COALESCE(is_test, false) = false`
    );

    const row = result.rows[0];
    const totalLoss = Number(row?.total_loss ?? 0);
    const totalExposure = Number(row?.total_exposure ?? 1);
    const drawdownPct = totalExposure > 0 ? (totalLoss / totalExposure) * 100 : 0;

    if (drawdownPct >= maxPct) {
      freezeUntil = new Date(now + freezeMins * 60_000);
      logger.warn('Drawdown circuit breaker TRIGGERED', {
        drawdownPct: Math.round(drawdownPct * 100) / 100,
        maxPct,
        freezeUntil: freezeUntil.toISOString(),
      });

      return {
        frozen: true,
        freezeUntil,
        currentDrawdownPct: Math.round(drawdownPct * 100) / 100,
        maxAllowedPct: maxPct,
      };
    }

    return {
      frozen: false,
      freezeUntil: null,
      currentDrawdownPct: Math.round(drawdownPct * 100) / 100,
      maxAllowedPct: maxPct,
    };
  } catch (err) {
    logger.warn('Drawdown circuit breaker check failed', { error: err });
    return { frozen: false, freezeUntil: null, currentDrawdownPct: 0, maxAllowedPct: maxPct };
  }
}

export function isDrawdownFrozen(): boolean {
  return freezeUntil != null && new Date() < freezeUntil;
}

export function getDrawdownFreezeUntil(): Date | null {
  return freezeUntil;
}

export function resetDrawdownBreaker(): void {
  freezeUntil = null;
  lastCheckMs = 0;
}
