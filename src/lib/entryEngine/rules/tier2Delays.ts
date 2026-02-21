import type { EntryDecisionInput, RuleResult } from '../types.js';
import { GEX_DELAY_STATES } from '../../shared/constants.js';

function confirmationPendingRule(input: EntryDecisionInput): RuleResult | null {
  if (input.signal.confirmationPending) {
    return {
      tier: 2,
      rule: 'CONFIRMATION_PENDING',
      triggered: true,
      message: 'Signal confirmation pending; delay entry',
      severity: 'MEDIUM',
    };
  }
  return null;
}

function timingWindowRule(input: EntryDecisionInput): RuleResult | null {
  const { session, minutesFromOpen } = input.timingContext;
  const isOpenWindow = session === 'OPEN' && minutesFromOpen <= 15;
  // RTH is 390 minutes (9:30–16:00). Last 15 min = minutesFromOpen >= 375.
  const RTH_DURATION_MINUTES = 390;
  const CLOSE_BUFFER_MINUTES = 15;
  const isCloseWindow = session === 'CLOSE' && minutesFromOpen >= (RTH_DURATION_MINUTES - CLOSE_BUFFER_MINUTES);
  const isLunchScalp = session === 'LUNCH' && input.setupType === 'SCALP_GUARDED';

  if (isOpenWindow || isCloseWindow || isLunchScalp) {
    return {
      tier: 2,
      rule: 'UNFAVORABLE_TIMING',
      triggered: true,
      message: `Timing window ${session} with minutesFromOpen=${minutesFromOpen} not favorable for entry`,
      severity: 'MEDIUM',
    };
  }
  return null;
}

function gexProximityRule(input: EntryDecisionInput): RuleResult | null {
  const gexState = input.marketContext.gexState;
  const delayConfig = GEX_DELAY_STATES[gexState];
  if (input.direction === 'CALL' && delayConfig.delayCalls) {
    return {
      tier: 2,
      rule: 'GEX_RESISTANCE',
      triggered: true,
      message: `GEX state ${gexState} indicates resistance to calls`,
      severity: 'MEDIUM',
    };
  }
  if (input.direction === 'PUT' && delayConfig.delayPuts) {
    return {
      tier: 2,
      rule: 'GEX_RESISTANCE',
      triggered: true,
      message: `GEX state ${gexState} indicates resistance to puts`,
      severity: 'MEDIUM',
    };
  }
  return null;
}

export function evaluateTier2Rules(input: EntryDecisionInput): RuleResult[] {
  const rules = [confirmationPendingRule(input), timingWindowRule(input), gexProximityRule(input)];
  return rules.filter((rule): rule is RuleResult => Boolean(rule));
}
