import type { ExitDecisionInput, RuleResult } from '../types.js';

export interface ExitMetrics {
  timeInTradeMinutes: number;
  optionPnLPercent: number;
  thetaBurnEstimate: number;
}

export function evaluateTier1Rules(input: ExitDecisionInput, metrics: ExitMetrics): RuleResult[] {
  const rules: RuleResult[] = [];
  const { setupType } = input.tradePosition;

  if (input.thesisStatus && (!input.thesisStatus.thesisValid || input.thesisStatus.htfInvalidation)) {
    rules.push({
      tier: 1,
      rule: 'THESIS_INVALIDATION',
      triggered: true,
      message: 'Thesis invalidated by HTF or confidence drop',
      severity: 'HIGH',
    });
  }

  if (setupType === 'SCALP_GUARDED' && metrics.timeInTradeMinutes > 90) {
    rules.push({
      tier: 1,
      rule: 'SCALP_MAX_HOLD_EXCEEDED',
      triggered: true,
      message: `Scalp hold time ${metrics.timeInTradeMinutes.toFixed(1)} minutes exceeded`,
      severity: 'HIGH',
    });
  }

  if (metrics.thetaBurnEstimate >= input.guardrails.thetaBurnLimit) {
    rules.push({
      tier: 1,
      rule: 'THETA_BURN_LIMIT',
      triggered: true,
      message: `Theta burn ${metrics.thetaBurnEstimate.toFixed(1)}% exceeds limit`,
      severity: 'HIGH',
    });
  }

  const stopLossThreshold = -Math.abs(input.targets.stopLossPercent);
  if (metrics.optionPnLPercent <= stopLossThreshold) {
    rules.push({
      tier: 1,
      rule: 'STOP_LOSS_HIT',
      triggered: true,
      message: `Option PnL ${metrics.optionPnLPercent.toFixed(1)}% below stop loss`,
      severity: 'HIGH',
    });
  }

  return rules;
}
