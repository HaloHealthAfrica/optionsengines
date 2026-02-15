/**
 * Bias Config Service - Config-driven effective gating rules.
 * Loads from bias_config table with safe defaults.
 */

import { db } from '../database.service.js';
import { logger } from '../../utils/logger.js';
import type { MacroClassValue } from '../../lib/mtfBias/constants-v3.js';

export interface BiasGatingConfig {
  /** Macro classes that suppress long entries */
  macroSuppressLongClasses: MacroClassValue[];
  /** Macro classes that suppress short entries */
  macroSuppressShortClasses: MacroClassValue[];
  /** Confidence penalty when room_to_resistance=LOW and intent=BREAKOUT */
  breakoutLowSpacePenalty: number;
  /** Confidence boost when reclaim=true */
  reclaimBoost: number;
  /** Chop score above which to suppress (unless reclaim + strong macro) */
  chopSuppressionThreshold: number;
  /** Confidence boost when regime_transition=true */
  regimeTransitionBoost: number;
  /** Risk multiplier when macro/intraday conflict */
  macroConflictRiskMultiplier: number;
}

const DEFAULT_CONFIG: BiasGatingConfig = {
  macroSuppressLongClasses: ['MACRO_BREAKDOWN_CONFIRMED', 'MACRO_TREND_DOWN'],
  macroSuppressShortClasses: ['MACRO_TREND_UP'],
  breakoutLowSpacePenalty: 0.25,
  reclaimBoost: 0.08,
  chopSuppressionThreshold: 75,
  regimeTransitionBoost: 0.05,
  macroConflictRiskMultiplier: 0.6,
};

let cachedConfig: BiasGatingConfig | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

/** Load bias gating config from DB or return defaults */
export async function getBiasGatingConfig(): Promise<BiasGatingConfig> {
  const now = Date.now();
  if (cachedConfig && now - cachedAt < CACHE_TTL_MS) {
    return cachedConfig;
  }

  try {
    const result = await db.query(
      `SELECT config_json FROM bias_config WHERE config_key = 'gating' LIMIT 1`
    );
    const row = result.rows[0];
    if (row?.config_json) {
      const parsed = row.config_json as Partial<BiasGatingConfig>;
      cachedConfig = { ...DEFAULT_CONFIG, ...parsed };
      cachedAt = now;
      return cachedConfig;
    }
  } catch (err) {
    logger.warn('Bias config load failed, using defaults', { error: err });
  }

  cachedConfig = DEFAULT_CONFIG;
  cachedAt = now;
  return cachedConfig;
}

/** Invalidate config cache (e.g. after config update) */
export function invalidateBiasConfigCache(): void {
  cachedConfig = null;
  cachedAt = 0;
}

export interface StalenessConfig {
  behavior: 'reduce_risk' | 'block';
  riskMultiplier: number;
}

let cachedStalenessConfig: StalenessConfig | null = null;
let cachedStalenessAt = 0;

/** Load staleness config from DB or return defaults */
export async function getStalenessConfig(): Promise<StalenessConfig> {
  const now = Date.now();
  if (cachedStalenessConfig && now - cachedStalenessAt < CACHE_TTL_MS) {
    return cachedStalenessConfig;
  }
  try {
    const r = await db.query(
      `SELECT config_json FROM bias_config WHERE config_key = 'staleness' LIMIT 1`
    );
    const row = r.rows[0];
    if (row?.config_json) {
      const parsed = row.config_json as Partial<StalenessConfig>;
      cachedStalenessConfig = {
        behavior: parsed.behavior ?? 'reduce_risk',
        riskMultiplier: parsed.riskMultiplier ?? 0.7,
      };
      cachedStalenessAt = now;
      return cachedStalenessConfig;
    }
  } catch {
    /* use defaults */
  }
  cachedStalenessConfig = { behavior: 'reduce_risk', riskMultiplier: 0.7 };
  cachedStalenessAt = now;
  return cachedStalenessConfig;
}
