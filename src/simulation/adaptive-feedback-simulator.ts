/**
 * Adaptive Feedback Simulator - Validates P&L feedback loop.
 * 100 synthetic trades, biased performance, verify bounded tuning.
 */

import { randomUUID } from 'crypto';
import { db } from '../services/database.service.js';
import { captureTradeOutcome } from '../services/performance-feedback/index.js';
import { getRollingStats } from '../services/performance-feedback/performance-analyzer.service.js';
import { runAdaptiveTuning } from '../services/performance-feedback/adaptive-tuner.service.js';

const NUM_TRADES = 100;

/** Seed bias_trade_performance with synthetic trades */
async function seedSyntheticTrades(): Promise<void> {
  await db.query(`DELETE FROM bias_trade_performance WHERE source = 'simulation'`);

  const baseTime = Date.now() - 14 * 24 * 60 * 60 * 1000;
  for (let i = 0; i < NUM_TRADES; i++) {
    const positionId = randomUUID();
    const regime = i % 3 === 0 ? 'RANGE' : 'TREND';
    const intent = i % 3 === 0 ? 'BREAKOUT' : i % 3 === 1 ? 'MEAN_REVERT' : 'PULLBACK';
    const accel = (i % 5) * 8 - 10;
    const macro = ['MACRO_TREND_UP', 'MACRO_TREND_DOWN', 'MACRO_RANGE'][i % 3];

    // Biased: acceleration trades overperform, breakout-in-range underperforms
    let pnlR: number;
    if (regime === 'RANGE' && intent === 'BREAKOUT') {
      pnlR = Math.random() * 0.5 - 0.3;
    } else if (accel > 15) {
      pnlR = 0.8 + Math.random() * 1.2;
    } else {
      pnlR = (Math.random() - 0.3) * 2;
    }
    const pnlPercent = pnlR * 1.5;

    await captureTradeOutcome({
      positionId,
      symbol: 'SPY',
      direction: 'long',
      entryBiasScore: 70,
      entryMacroClass: macro,
      entryRegime: regime,
      entryIntent: intent,
      entryAcceleration: accel,
      pnlR,
      pnlPercent,
      durationMinutes: 60 + Math.floor(Math.random() * 120),
      exitReasonCodes: i % 10 === 0 ? ['MACRO_DRIFT_EXIT_PRESSURE'] : ['profit_target'],
      timestamp: new Date(baseTime + i * 3600 * 1000),
      source: 'simulation',
    });
  }
}

export interface AdaptiveFeedbackSimReport {
  tradeCount: number;
  rollingStats: Awaited<ReturnType<typeof getRollingStats>>;
  tunerResult: Awaited<ReturnType<typeof runAdaptiveTuning>>;
  passed: boolean;
  anomalies: string[];
}

export async function runAdaptiveFeedbackSimulation(): Promise<AdaptiveFeedbackSimReport> {
  const anomalies: string[] = [];

  await seedSyntheticTrades();
  const rollingStats = await getRollingStats();
  const tunerResult = await runAdaptiveTuning();

  if (tunerResult.changes.some((c) => Math.abs((c.new - c.previous) / c.previous) > 0.1)) {
    anomalies.push('Parameter change exceeded ±10% cap');
  }

  const rangeBreakout = tunerResult.changes.find((c) => c.parameter === 'rangeBreakoutMultiplier');
  if (rangeBreakout && rangeBreakout.new > 0.9) {
    anomalies.push('rangeBreakoutMultiplier increased beyond safe bound');
  }

  const stateStrength = tunerResult.changes.find((c) => c.parameter === 'stateStrengthUpMultiplier');
  if (stateStrength && stateStrength.new > 1.2) {
    anomalies.push('stateStrengthUpMultiplier exceeded 1.2 cap');
  }

  const latePhase = tunerResult.changes.find((c) => c.parameter === 'latePhaseNegativeMultiplier');
  if (latePhase && latePhase.new > 1) {
    anomalies.push('latePhaseNegativeMultiplier exceeded baseline');
  }

  return {
    tradeCount: NUM_TRADES,
    rollingStats,
    tunerResult,
    passed: anomalies.length === 0,
    anomalies,
  };
}
