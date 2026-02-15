/**
 * Performance Analyzer - Rolling stats for adaptive tuning.
 * Last 50 trades or 14 days.
 */

import { db } from '../database.service.js';

const ROLLING_TRADE_LIMIT = 50;
const ROLLING_DAYS = 14;

export interface RollingStats {
  winRate: number;
  avgR: number;
  tradeCount: number;
  avgRByRegime: Record<string, number>;
  avgRByMacro: Record<string, number>;
  avgRByAccelerationBucket: Record<string, number>;
  breakoutWinRateInRange: number;
  meanReversionWinRateInTrend: number;
  macroDriftExitAvgR: number;
  macroDriftExitCount: number;
}

function parseExitReasonCodes(codes: string[] | null): string[] {
  if (!codes || !Array.isArray(codes)) return [];
  return codes;
}

/**
 * Calculate rolling performance stats.
 */
export async function getRollingStats(): Promise<RollingStats> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - ROLLING_DAYS);

  const result = await db.query(
    `SELECT
      symbol,
      direction,
      pnl_r,
      pnl_percent,
      entry_regime,
      entry_macro_class,
      entry_intent,
      entry_acceleration,
      exit_reason_codes,
      created_at
    FROM bias_trade_performance
    WHERE created_at >= $1
    ORDER BY created_at DESC
    LIMIT $2`,
    [cutoff, ROLLING_TRADE_LIMIT * 2]
  );

  const rows = result.rows;
  const limited = rows.slice(0, ROLLING_TRADE_LIMIT);

  if (limited.length === 0) {
    return {
      winRate: 0,
      avgR: 0,
      tradeCount: 0,
      avgRByRegime: {},
      avgRByMacro: {},
      avgRByAccelerationBucket: {},
      breakoutWinRateInRange: 0,
      meanReversionWinRateInTrend: 0,
      macroDriftExitAvgR: 0,
      macroDriftExitCount: 0,
    };
  }

  const wins = limited.filter((r) => Number(r.pnl_r) > 0).length;
  const winRate = limited.length > 0 ? wins / limited.length : 0;
  const avgR =
    limited.length > 0
      ? limited.reduce((s, r) => s + Number(r.pnl_r ?? 0), 0) / limited.length
      : 0;

  const byRegime: Record<string, number[]> = {};
  const byMacro: Record<string, number[]> = {};
  const byAccel: Record<string, number[]> = {};
  let breakoutRangeWins = 0;
  let breakoutRangeTotal = 0;
  let meanRevTrendWins = 0;
  let meanRevTrendTotal = 0;
  const macroDriftExits: number[] = [];

  for (const r of limited) {
    const regime = String(r.entry_regime ?? 'unknown');
    const macro = String(r.entry_macro_class ?? 'unknown');
    const acc = r.entry_acceleration != null ? Number(r.entry_acceleration) : null;
    const bucket =
      acc == null ? 'unknown' : acc > 15 ? 'high' : acc > 0 ? 'mid' : acc > -15 ? 'low' : 'negative';
    const pnlR = Number(r.pnl_r ?? 0);
    const intent = String(r.entry_intent ?? '');
    const exitCodes = parseExitReasonCodes(r.exit_reason_codes);

    if (!byRegime[regime]) byRegime[regime] = [];
    byRegime[regime].push(pnlR);
    if (!byMacro[macro]) byMacro[macro] = [];
    byMacro[macro].push(pnlR);
    if (!byAccel[bucket]) byAccel[bucket] = [];
    byAccel[bucket].push(pnlR);

    if (regime === 'RANGE' && (intent === 'BREAKOUT' || intent === 'breakout')) {
      breakoutRangeTotal++;
      if (pnlR > 0) breakoutRangeWins++;
    }
    if (regime === 'TREND' && (intent === 'MEAN_REVERT' || intent === 'PULLBACK' || intent === 'mean_revert' || intent === 'pullback')) {
      meanRevTrendTotal++;
      if (pnlR > 0) meanRevTrendWins++;
    }

    if (exitCodes.some((c) => c.includes('MACRO_DRIFT') || c.includes('macro_drift'))) {
      macroDriftExits.push(pnlR);
    }
  }

  const avgRByRegime: Record<string, number> = {};
  for (const [k, arr] of Object.entries(byRegime)) {
    avgRByRegime[k] = arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  const avgRByMacro: Record<string, number> = {};
  for (const [k, arr] of Object.entries(byMacro)) {
    avgRByMacro[k] = arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  const avgRByAccelerationBucket: Record<string, number> = {};
  for (const [k, arr] of Object.entries(byAccel)) {
    avgRByAccelerationBucket[k] = arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  return {
    winRate,
    avgR,
    tradeCount: limited.length,
    avgRByRegime,
    avgRByMacro,
    avgRByAccelerationBucket,
    breakoutWinRateInRange: breakoutRangeTotal > 0 ? breakoutRangeWins / breakoutRangeTotal : 0,
    meanReversionWinRateInTrend: meanRevTrendTotal > 0 ? meanRevTrendWins / meanRevTrendTotal : 0,
    macroDriftExitAvgR:
      macroDriftExits.length > 0
        ? macroDriftExits.reduce((a, b) => a + b, 0) / macroDriftExits.length
        : 0,
    macroDriftExitCount: macroDriftExits.length,
  };
}
