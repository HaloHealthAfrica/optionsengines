import { db } from './database.service.js';
import { logger } from '../utils/logger.js';
import * as Sentry from '@sentry/node';

const DEFAULT_MAX_DRAWDOWN_PCT = 3;
const DEFAULT_FREEZE_MINUTES = 30;

let cachedFreezeUntil: Date | null = null;
let lastCheckMs = 0;
const CHECK_INTERVAL_MS = 15_000;

let tableReady = false;

export interface DrawdownStatus {
  frozen: boolean;
  freezeUntil: Date | null;
  currentDrawdownPct: number;
  maxAllowedPct: number;
}

async function ensureTable(): Promise<boolean> {
  if (tableReady) return true;
  try {
    await db.query(
      `CREATE TABLE IF NOT EXISTS circuit_breaker_state (
         id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
         freeze_until TIMESTAMPTZ,
         triggered_at TIMESTAMPTZ,
         drawdown_pct DECIMAL(6, 2),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`
    );
    await db.query(
      `INSERT INTO circuit_breaker_state (id, updated_at)
       VALUES (1, NOW())
       ON CONFLICT (id) DO NOTHING`
    );
    tableReady = true;
    return true;
  } catch (err) {
    logger.warn('circuit_breaker_state table unavailable, using in-memory only', { error: err });
    return false;
  }
}

async function loadFreezeState(): Promise<Date | null> {
  if (!(await ensureTable())) return cachedFreezeUntil;
  try {
    const r = await db.query(
      `SELECT freeze_until FROM circuit_breaker_state WHERE id = 1`
    );
    const row = r.rows[0];
    if (row?.freeze_until) {
      const dt = new Date(row.freeze_until);
      return dt > new Date() ? dt : null;
    }
    return null;
  } catch {
    return cachedFreezeUntil;
  }
}

async function persistFreeze(freezeUntil: Date, drawdownPct: number): Promise<void> {
  if (!(await ensureTable())) return;
  try {
    await db.query(
      `INSERT INTO circuit_breaker_state (id, freeze_until, triggered_at, drawdown_pct, updated_at)
       VALUES (1, $1, NOW(), $2, NOW())
       ON CONFLICT (id) DO UPDATE SET
         freeze_until = $1,
         triggered_at = NOW(),
         drawdown_pct = $2,
         updated_at = NOW()`,
      [freezeUntil, drawdownPct]
    );
  } catch (err) {
    logger.warn('Failed to persist circuit breaker state', { error: err });
  }
}

async function clearFreeze(): Promise<void> {
  if (!(await ensureTable())) return;
  try {
    await db.query(
      `UPDATE circuit_breaker_state SET freeze_until = NULL, updated_at = NOW() WHERE id = 1`
    );
  } catch (err) {
    logger.warn('Failed to clear circuit breaker state', { error: err });
  }
}

export async function checkDrawdownCircuitBreaker(opts?: {
  maxDrawdownPct?: number;
  freezeMinutes?: number;
}): Promise<DrawdownStatus> {
  const maxPct = opts?.maxDrawdownPct ?? DEFAULT_MAX_DRAWDOWN_PCT;
  const freezeMins = opts?.freezeMinutes ?? DEFAULT_FREEZE_MINUTES;
  const now = Date.now();

  if (cachedFreezeUntil && new Date() < cachedFreezeUntil) {
    return {
      frozen: true,
      freezeUntil: cachedFreezeUntil,
      currentDrawdownPct: 0,
      maxAllowedPct: maxPct,
    };
  }

  if (cachedFreezeUntil && new Date() >= cachedFreezeUntil) {
    logger.info('Drawdown circuit breaker thawed');
    cachedFreezeUntil = null;
    await clearFreeze();
  }

  if (now - lastCheckMs < CHECK_INTERVAL_MS) {
    return { frozen: false, freezeUntil: null, currentDrawdownPct: 0, maxAllowedPct: maxPct };
  }
  lastCheckMs = now;

  try {
    const dbFreeze = await loadFreezeState();
    if (dbFreeze) {
      cachedFreezeUntil = dbFreeze;
      return { frozen: true, freezeUntil: dbFreeze, currentDrawdownPct: 0, maxAllowedPct: maxPct };
    }
  } catch {
    // Persistence layer failure — continue with drawdown calculation
  }

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
      cachedFreezeUntil = new Date(now + freezeMins * 60_000);
      await persistFreeze(cachedFreezeUntil, Math.round(drawdownPct * 100) / 100);
      logger.warn('Drawdown circuit breaker TRIGGERED', {
        drawdownPct: Math.round(drawdownPct * 100) / 100,
        maxPct,
        freezeUntil: cachedFreezeUntil.toISOString(),
      });
      Sentry.captureMessage('Drawdown circuit breaker TRIGGERED', {
        level: 'warning',
        tags: { service: 'drawdown-circuit-breaker' },
        extra: {
          drawdownPct: Math.round(drawdownPct * 100) / 100,
          maxPct,
          freezeUntil: cachedFreezeUntil!.toISOString(),
        },
      });

      return {
        frozen: true,
        freezeUntil: cachedFreezeUntil,
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
    logger.warn('Drawdown circuit breaker check failed — fail-closed', { error: err });
    Sentry.captureException(err, { tags: { service: 'drawdown-circuit-breaker' } });
    return { frozen: true, freezeUntil: null, currentDrawdownPct: 0, maxAllowedPct: maxPct };
  }
}

export function isDrawdownFrozen(): boolean {
  return cachedFreezeUntil != null && new Date() < cachedFreezeUntil;
}

export function getDrawdownFreezeUntil(): Date | null {
  return cachedFreezeUntil;
}

export async function resetDrawdownBreaker(): Promise<void> {
  cachedFreezeUntil = null;
  lastCheckMs = 0;
  await clearFreeze();
}
