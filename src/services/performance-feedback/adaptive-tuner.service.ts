/**
 * Adaptive Tuner - Bounded sensitivity tuning from rolling performance.
 * Operates once per day. Never overrides hard caps.
 * Respects adaptiveEnabled: when false, skips update but logs dry-run result.
 */

import { db } from '../database.service.js';
import { logger } from '../../utils/logger.js';
import type { RollingStats } from './performance-analyzer.service.js';
import { DEFAULT_RISK_CONFIG } from '../bias-state-aggregator/risk-model-integration.service.js';
import { getAdaptiveMeta, setLastRunSummary } from './adaptive-status.service.js';

interface RiskConfig {
  macroBreakdownLongMultiplier: number;
  macroTrendUpLongMultiplier: number;
  macroTrendDownShortMultiplier: number;
  rangeBreakoutMultiplier: number;
  trendAlignmentMultiplier: number;
  stateStrengthUpMultiplier: number;
  stateStrengthDownMultiplier: number;
  macroDriftHighMultiplier: number;
  latePhaseNegativeMultiplier: number;
}

const MAX_CHANGE_PCT = 0.1;
const BREAKOUT_RANGE_WIN_RATE_THRESHOLD = 0.35;
const HIGH_ACCEL_AVG_R_THRESHOLD = 1.5;
const MACRO_DRIFT_EXIT_AVG_R_THRESHOLD = 0.3;
const LATE_PHASE_AVG_R_THRESHOLD = 1.0;

const MACRO_DRIFT_THRESHOLD_MIN = 0.15;
const MACRO_DRIFT_THRESHOLD_MAX = 0.25;
const ACCELERATION_BOOST_MAX = 1.2;
const LATE_PHASE_PENALTY_MIN = 0.7;

let lastAdaptiveRunDate: string | null = null;

export interface AdaptiveTunerResult {
  updated: boolean;
  changes: { parameter: string; previous: number; new: number; reason: string }[];
  stats: RollingStats;
  dryRun?: boolean;
}

/**
 * Run adaptive tuning. Only once per day. Bounded changes.
 * When adaptiveEnabled=false: skips applying changes but logs dry-run result.
 */
export async function runAdaptiveTuning(opts?: { forceRun?: boolean; dryRun?: boolean }): Promise<AdaptiveTunerResult> {
  const meta = await getAdaptiveMeta();
  const dryRun = opts?.dryRun ?? !meta.enabled;
  const today = new Date().toISOString().slice(0, 10);

  if (!opts?.forceRun && lastAdaptiveRunDate === today) {
    const stats = await import('./performance-analyzer.service.js').then((m) => m.getRollingStats());
    return { updated: false, changes: [], stats, dryRun };
  }

  const { getRollingStats } = await import('./performance-analyzer.service.js');
  const stats = await getRollingStats();

  if (stats.tradeCount < 10) {
    logger.debug('Adaptive tuner skipped - insufficient trades', { tradeCount: stats.tradeCount });
    await setLastRunSummary({
      date: new Date().toISOString(),
      tunerUpdated: false,
      parametersChanged: [],
    });
    return { updated: false, changes: [], stats, dryRun };
  }

  const changes: AdaptiveTunerResult['changes'] = [];
  let riskConfig: RiskConfig = { ...DEFAULT_RISK_CONFIG };

  try {
    const r = await db.query(
      `SELECT config_json FROM bias_config WHERE config_key = 'risk' LIMIT 1`
    );
    const row = r.rows[0];
    if (row?.config_json) {
      riskConfig = { ...DEFAULT_RISK_CONFIG, ...(row.config_json as Partial<RiskConfig>) };
    }
  } catch {
    /* use defaults */
  }

  // 1. Breakout in RANGE underperforming
  if (stats.breakoutWinRateInRange < BREAKOUT_RANGE_WIN_RATE_THRESHOLD && stats.breakoutWinRateInRange > 0) {
    const current = riskConfig.rangeBreakoutMultiplier;
    const delta = Math.min(MAX_CHANGE_PCT, (current - 0.6) * -0.5);
    const next = Math.max(0.5, Math.min(0.9, current + delta));
    if (Math.abs(next - current) > 0.01) {
      riskConfig.rangeBreakoutMultiplier = Math.round(next * 100) / 100;
      changes.push({
        parameter: 'rangeBreakoutMultiplier',
        previous: current,
        new: riskConfig.rangeBreakoutMultiplier,
        reason: `Breakout in RANGE win rate ${(stats.breakoutWinRateInRange * 100).toFixed(1)}% < 35%`,
      });
    }
  }

  // 2. High acceleration trades overperform
  const highAccelR = stats.avgRByAccelerationBucket['high'] ?? 0;
  if (highAccelR > HIGH_ACCEL_AVG_R_THRESHOLD) {
    const current = riskConfig.stateStrengthUpMultiplier;
    const next = Math.min(ACCELERATION_BOOST_MAX, current + 0.05);
    if (next > current) {
      riskConfig.stateStrengthUpMultiplier = Math.round(next * 100) / 100;
      changes.push({
        parameter: 'stateStrengthUpMultiplier',
        previous: current,
        new: riskConfig.stateStrengthUpMultiplier,
        reason: `High acceleration avg R ${highAccelR.toFixed(2)} > 1.5`,
      });
    }
  }

  // 3. Macro drift exits too early - stored in adaptive config
  if (stats.macroDriftExitCount >= 3 && stats.macroDriftExitAvgR < MACRO_DRIFT_EXIT_AVG_R_THRESHOLD) {
    let adaptiveConfig: { macroDriftThreshold?: number } = {};
    try {
      const ar = await db.query(
        `SELECT config_json FROM bias_config WHERE config_key = 'adaptive' LIMIT 1`
      );
      if (ar.rows[0]?.config_json) {
        adaptiveConfig = ar.rows[0].config_json as { macroDriftThreshold?: number };
      }
    } catch {
      /* ignore */
    }
    const currentDrift = adaptiveConfig.macroDriftThreshold ?? 0.18;
    const step = Math.min(0.02, currentDrift * MAX_CHANGE_PCT);
    const nextDrift = Math.min(MACRO_DRIFT_THRESHOLD_MAX, Math.max(MACRO_DRIFT_THRESHOLD_MIN, currentDrift + step));
    if (nextDrift > currentDrift) {
      changes.push({
        parameter: 'macroDriftThreshold',
        previous: currentDrift,
        new: nextDrift,
        reason: `Macro drift exits avg R ${stats.macroDriftExitAvgR.toFixed(2)} < 0.3`,
      });
      if (!dryRun) {
        const nextAdaptive = { ...adaptiveConfig, macroDriftThreshold: nextDrift };
        await db.query(
          `INSERT INTO bias_config (config_key, config_json, updated_at)
           VALUES ('adaptive', $1::jsonb, NOW())
           ON CONFLICT (config_key) DO UPDATE SET config_json = $1::jsonb, updated_at = NOW()`,
          [JSON.stringify(nextAdaptive)]
        );
      }
    }
  }

  // 4. Late phase continuation still profitable
  const latePhaseR = stats.avgRByRegime['LATE'] ?? stats.avgR;
  if (latePhaseR > LATE_PHASE_AVG_R_THRESHOLD) {
    const current = riskConfig.latePhaseNegativeMultiplier;
    const next = Math.max(LATE_PHASE_PENALTY_MIN, Math.min(1, current + 0.1));
    if (next > current) {
      riskConfig.latePhaseNegativeMultiplier = Math.round(next * 100) / 100;
      changes.push({
        parameter: 'latePhaseNegativeMultiplier',
        previous: current,
        new: riskConfig.latePhaseNegativeMultiplier,
        reason: `Late phase avg R ${latePhaseR.toFixed(2)} > 1`,
      });
    }
  }

  if (changes.length === 0) {
    lastAdaptiveRunDate = today;
    await setLastRunSummary({
      date: new Date().toISOString(),
      tunerUpdated: false,
      parametersChanged: [],
    });
    return { updated: false, changes: [], stats, dryRun };
  }

  if (dryRun) {
    logger.info('Adaptive tuner dry-run (enabled=false or dryRun)', {
      changes: changes.map((c) => c.parameter),
      wouldApply: changes,
    });
    await setLastRunSummary({
      date: new Date().toISOString(),
      tunerUpdated: false,
      parametersChanged: changes.map((c) => ({
        key: c.parameter,
        oldValue: c.previous,
        newValue: c.new,
        reason: c.reason,
      })),
    });
    return { updated: false, changes, stats, dryRun: true };
  }

  const riskChanges = changes.filter((c) => c.parameter !== 'macroDriftThreshold');
  for (const ch of riskChanges) {
    await db.query(
      `INSERT INTO bias_adaptive_config_history (
        config_key,
        parameter_name,
        previous_value,
        new_value,
        reason,
        rolling_metrics,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        'risk',
        ch.parameter,
        JSON.stringify(ch.previous),
        JSON.stringify(ch.new),
        ch.reason,
        JSON.stringify({
          tradeCount: stats.tradeCount,
          winRate: stats.winRate,
          avgR: stats.avgR,
        }),
      ]
    );
  }

  if (riskChanges.length > 0) {
    await db.query(
      `UPDATE bias_config SET config_json = $1, updated_at = NOW() WHERE config_key = 'risk'`,
      [JSON.stringify(riskConfig)]
    );
  }

  lastAdaptiveRunDate = today;
  await setLastRunSummary({
    date: new Date().toISOString(),
    tunerUpdated: true,
    parametersChanged: changes.map((c) => ({
      key: c.parameter,
      oldValue: c.previous,
      newValue: c.new,
      reason: c.reason,
    })),
  });
  logger.info('Adaptive tuner applied', { changes: changes.length, parameters: changes.map((c) => c.parameter) });

  return { updated: true, changes, stats };
}

export function getLastAdaptiveRunDate(): string | null {
  return lastAdaptiveRunDate;
}
