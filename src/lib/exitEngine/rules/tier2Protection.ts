import type { ExitDecisionInput, RuleResult } from '../types.js';
import type { ExitMetrics } from './tier1HardFail.js';

export function evaluateTier2Rules(input: ExitDecisionInput, metrics: ExitMetrics): RuleResult[] {
  const rules: RuleResult[] = [];

  const progressFailure = input.guardrails.progressChecks.find(
    (check) => metrics.timeInTradeMinutes >= check.atMinute && metrics.optionPnLPercent < check.minProfitPercent
  );
  if (progressFailure) {
    rules.push({
      tier: 2,
      rule: 'PROGRESS_CHECK_FAILED',
      triggered: true,
      message: `Progress check failed at ${progressFailure.atMinute} minutes`,
      severity: 'MEDIUM',
    });
  }

  if (input.liveMarket.spreadPercent >= 20) {
    rules.push({
      tier: 2,
      rule: 'LIQUIDITY_DETERIORATION',
      triggered: true,
      message: `Spread widened to ${input.liveMarket.spreadPercent.toFixed(1)}%`,
      severity: 'HIGH',
    });
  }

  const bearishRegimes = new Set(['BEAR', 'STRONG_BEAR', 'BREAKDOWN']);
  const bullishRegimes = new Set(['BULL', 'STRONG_BULL', 'BREAKOUT']);
  if (input.tradePosition.direction === 'CALL' && bearishRegimes.has(input.liveMarket.regime)) {
    rules.push({
      tier: 2,
      rule: 'REGIME_FLIP',
      triggered: true,
      message: `Regime flipped bearish (${input.liveMarket.regime}) against call position`,
      severity: 'HIGH',
    });
  }
  if (input.tradePosition.direction === 'PUT' && bullishRegimes.has(input.liveMarket.regime)) {
    rules.push({
      tier: 2,
      rule: 'REGIME_FLIP',
      triggered: true,
      message: `Regime flipped bullish (${input.liveMarket.regime}) against put position`,
      severity: 'HIGH',
    });
  }

  return rules;
}
