import type { ExitDecisionInput, RuleResult } from '../types.js';
import type { ExitMetrics } from './tier1HardFail.js';
import { EXIT_POLICIES } from '../constants.js';

export function evaluateTier3Rules(
  input: ExitDecisionInput,
  metrics: ExitMetrics
): { rules: RuleResult[]; exitPercent?: number } {
  const rules: RuleResult[] = [];
  const policy = EXIT_POLICIES[input.tradePosition.setupType];
  const profitPartials = policy.profitPartials;

  let matchedPartial: { atPercent: number; exitPercent: number } | null = null;
  for (const partial of profitPartials) {
    if (metrics.optionPnLPercent >= partial.atPercent) {
      matchedPartial = partial;
    }
  }

  if (matchedPartial) {
    rules.push({
      tier: 3,
      rule: 'PROFIT_TARGET_REACHED',
      triggered: true,
      message: `Profit ${metrics.optionPnLPercent.toFixed(1)}% reached partial ${matchedPartial.atPercent}%`,
      severity: metrics.optionPnLPercent >= 50 ? 'MEDIUM' : 'LOW',
    });
    return { rules, exitPercent: matchedPartial.exitPercent };
  }

  if (metrics.optionPnLPercent >= input.targets.fullTakeProfitPercent) {
    rules.push({
      tier: 3,
      rule: 'FULL_TARGET_REACHED',
      triggered: true,
      message: `Profit ${metrics.optionPnLPercent.toFixed(1)}% reached full target`,
      severity: 'MEDIUM',
    });
    return { rules, exitPercent: 100 };
  }

  return { rules };
}
