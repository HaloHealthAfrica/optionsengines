import { db } from '../services/database.service.js';
import { logger } from '../utils/logger.js';

export type TradingMode =
  | 'LEGACY_ONLY'
  | 'SHADOW_UDC'
  | 'UDC_PRIMARY'
  | 'UDC_ONLY';

const VALID_MODES = new Set<TradingMode>([
  'LEGACY_ONLY',
  'SHADOW_UDC',
  'UDC_PRIMARY',
  'UDC_ONLY',
]);

const CACHE_TTL_MS = 10_000;

let cachedMode: TradingMode | null = null;
let cacheExpiresAt = 0;

function fallbackMode(): TradingMode {
  const raw = process.env.TRADING_MODE as TradingMode | undefined;
  if (raw && VALID_MODES.has(raw)) return raw;
  return 'LEGACY_ONLY';
}

/**
 * Returns the current trading mode.
 * Reads from the system_settings DB table with a short TTL cache.
 * Falls back to the TRADING_MODE env var if the DB read fails.
 */
export function getTradingMode(): TradingMode {
  if (cachedMode && Date.now() < cacheExpiresAt) {
    return cachedMode;
  }

  // Trigger async refresh but return stale/fallback synchronously
  refreshTradingMode().catch(() => {});

  return cachedMode ?? fallbackMode();
}

async function refreshTradingMode(): Promise<void> {
  try {
    const result = await db.query(
      `SELECT value FROM system_settings WHERE key = 'TRADING_MODE' LIMIT 1`,
    );
    const raw = result.rows[0]?.value as TradingMode | undefined;
    if (raw && VALID_MODES.has(raw)) {
      cachedMode = raw;
    } else {
      cachedMode = fallbackMode();
    }
  } catch {
    cachedMode = fallbackMode();
  }
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
}

/**
 * Eager-load the trading mode at startup so the first call is not stale.
 */
export async function initTradingMode(): Promise<void> {
  await refreshTradingMode();
  logger.info('Trading mode initialized', { mode: cachedMode });
}

/**
 * Update the trading mode in the DB and refresh cache immediately.
 */
export async function setTradingMode(mode: TradingMode): Promise<void> {
  if (!VALID_MODES.has(mode)) {
    throw new Error(`Invalid trading mode: ${mode}`);
  }
  await db.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ('TRADING_MODE', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [mode],
  );
  cachedMode = mode;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  logger.info('Trading mode updated', { mode });
}
