/**
 * Strat Plan Config Service
 * Loads configurable limits from strat_plan_config table
 */

import { db } from '../database.service.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import type { StratPlanConfig } from './types.js';

const DEFAULTS: StratPlanConfig = {
  maxWatchlistTickers: config.stratPlanMaxWatchlistTickers ?? 10,
  maxConcurrentPlans: config.stratPlanMaxConcurrentPlans ?? 500,
  maxPlansPerTicker: config.stratPlanMaxPlansPerTicker ?? 2,
  maxInForceSimultaneous: config.stratPlanMaxInForce ?? 3,
  webhookAutoAddToWatchlist: config.stratPlanWebhookAutoAdd ?? false,
  killSwitchConsecutiveFailures: config.stratPlanKillSwitchFailures ?? 3,
};

let cachedConfig: StratPlanConfig | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 30_000;

export async function getStratPlanConfig(): Promise<StratPlanConfig> {
  const now = Date.now();
  if (cachedConfig && cacheExpiry > now) {
    return cachedConfig;
  }

  try {
    const result = await db.query(
      `SELECT config_key, config_value FROM strat_plan_config`
    );

    const cfg: StratPlanConfig = { ...DEFAULTS };

    for (const row of result.rows) {
      const key = row.config_key as string;
      const val = row.config_value as string;
      switch (key) {
        case 'max_watchlist_tickers':
          cfg.maxWatchlistTickers = Math.max(1, parseInt(val, 10) || 10);
          break;
        case 'max_concurrent_plans':
          cfg.maxConcurrentPlans = Math.max(1, parseInt(val, 10) || 500);
          break;
        case 'max_plans_per_ticker':
          cfg.maxPlansPerTicker = Math.max(1, parseInt(val, 10) || 2);
          break;
        case 'max_in_force_simultaneous':
          cfg.maxInForceSimultaneous = Math.max(1, parseInt(val, 10) || 3);
          break;
        case 'webhook_auto_add_to_watchlist':
          cfg.webhookAutoAddToWatchlist = val === 'true';
          break;
        case 'kill_switch_consecutive_failures':
          cfg.killSwitchConsecutiveFailures = Math.max(1, parseInt(val, 10) || 3);
          break;
      }
    }

    cachedConfig = cfg;
    cacheExpiry = now + CACHE_TTL_MS;
    return cfg;
  } catch (err) {
    logger.warn('Strat plan config load failed, using defaults', { error: err });
    return DEFAULTS;
  }
}

export function invalidateConfigCache(): void {
  cachedConfig = null;
  cacheExpiry = 0;
}
