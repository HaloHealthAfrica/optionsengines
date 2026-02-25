import { strategyRouter } from './strategy-router.js';
import { portfolioGovernor } from './portfolio-governor.js';
import { strikeSelection } from './strike-selection.js';
import { sizer } from './sizer.js';
import { buildOrderPlan } from './order-plan-builder.js';
import { buildDecisionId } from './decision-id.js';
import type { UDCSignal, MarketSnapshot, PortfolioState, UDCResult } from './types.js';

/**
 * Derives the horizon bucket from a timeframe string.
 * Intraday: 1, 3, 5, 15. Swing: 30, 60, D, W, M.
 */
function resolveHorizon(timeframe: string): string {
  const intraday = ['1', '3', '5', '15'];
  return intraday.includes(timeframe) ? 'INTRADAY' : 'SWING';
}

const FALLBACK_INVALIDATION_PCT: Record<string, number> = {
  INTRADAY: 0.012,
  SWING: 0.020,
};

function deriveInvalidationFromSnapshot(
  price: number,
  direction: string,
  horizon: string,
): number {
  if (!price || price <= 0) return 0;
  const pct = FALLBACK_INVALIDATION_PCT[horizon] ?? 0.012;
  const isBull = direction === 'BULL';
  return Math.round(price * (isBull ? 1 - pct : 1 + pct) * 100) / 100;
}

/**
 * Unified Decision Core — deterministic, fail-closed entry function.
 *
 * Runs in parallel with the legacy Engine A/B flow.
 * Blocks trade if: snapshot stale, portfolio unavailable,
 * invalidation missing, or options chain unavailable.
 */
export async function runUDC(
  signal: UDCSignal,
  snapshot: MarketSnapshot,
  portfolio: PortfolioState,
): Promise<UDCResult> {
  const horizon = resolveHorizon(signal.timeframe);

  if (!snapshot || snapshot.stale) {
    return {
      status: 'BLOCKED',
      reason: 'STALE_SNAPSHOT',
      decisionId: buildDecisionId(signal.id, '_none_', horizon, '_none_'),
    };
  }

  if (!portfolio || portfolio.risk == null) {
    return {
      status: 'BLOCKED',
      reason: 'Portfolio state unavailable',
      decisionId: buildDecisionId(signal.id, '_none_', horizon, '_none_'),
    };
  }

  if (!snapshot.chain || snapshot.chain.length === 0) {
    return {
      status: 'BLOCKED',
      reason: 'Options chain unavailable',
      decisionId: buildDecisionId(signal.id, '_none_', horizon, '_none_'),
    };
  }

  const routed = strategyRouter(signal);
  if (!routed) {
    return {
      status: 'NO_STRATEGY',
      decisionId: buildDecisionId(signal.id, '_none_', horizon, '_none_'),
    };
  }

  const strategy = routed.intent.strategy;
  const setupType = routed.intent.structure;
  const decisionId = buildDecisionId(signal.id, strategy, horizon, setupType);

  if (routed.intent.invalidation === 0) {
    const fallback = deriveInvalidationFromSnapshot(
      snapshot.price,
      routed.intent.direction,
      horizon,
    );
    if (fallback > 0) {
      routed.intent.invalidation = fallback;
    } else {
      return { status: 'BLOCKED', reason: 'Invalidation level missing', decisionId };
    }
  }

  const gov = portfolioGovernor(routed.intent, portfolio);
  if (!gov.allowed) {
    return { status: 'BLOCKED', reason: gov.reason, decisionId };
  }

  try {
    const selected = strikeSelection(routed.intent, snapshot);
    const sized = sizer(selected, portfolio);
    const plan = buildOrderPlan(sized);

    return {
      status: 'PLAN_CREATED',
      plan,
      decision: routed,
      decisionId,
    };
  } catch (err: any) {
    return {
      status: 'BLOCKED',
      reason: err?.message ?? 'Strike selection or sizing failed',
      decisionId,
    };
  }
}
