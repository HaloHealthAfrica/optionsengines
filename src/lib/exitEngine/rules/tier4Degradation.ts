import type { ExitDecisionInput, RuleResult } from '../types.js';
import type { ExitMetrics } from './tier1HardFail.js';

export function evaluateTier4Rules(
  input: ExitDecisionInput,
  metrics: ExitMetrics,
  greekRules: RuleResult[]
): RuleResult[] {
  const rules: RuleResult[] = [];

  const timeStops = input.guardrails.timeStops ?? [];
  const hitTimeStop = timeStops.find((stop) => metrics.timeInTradeMinutes >= stop);
  if (hitTimeStop !== undefined) {
    rules.push({
      tier: 4,
      rule: 'TIME_STOP',
      triggered: true,
      message: `Time stop reached at ${hitTimeStop} minutes`,
      severity: 'LOW',
    });
  }

  rules.push(...greekRules);
  return rules;
}
