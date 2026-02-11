import type { EntryDecisionInput, RuleResult } from '../types.js';
import { ENTRY_LIQUIDITY_ALLOWED, ENTRY_MIN_CONFIDENCE, ENTRY_VOLATILITY_BANDS, PORTFOLIO_GUARDRAILS } from '../../shared/constants.js';

function confidenceRule(input: EntryDecisionInput): RuleResult | null {
  const minConfidence = ENTRY_MIN_CONFIDENCE[input.setupType];
  if (input.signal.confidence < minConfidence) {
    return {
      tier: 1,
      rule: 'LOW_SIGNAL_CONFIDENCE',
      triggered: true,
      message: `Signal confidence ${input.signal.confidence} below minimum ${minConfidence}`,
      severity: 'HIGH',
    };
  }
  return null;
}

function regimeConflictRule(input: EntryDecisionInput): RuleResult | null {
  const bearishRegimes = new Set(['BEAR', 'STRONG_BEAR', 'BREAKDOWN']);
  const bullishRegimes = new Set(['BULL', 'STRONG_BULL', 'BREAKOUT']);

  if (input.direction === 'CALL' && bearishRegimes.has(input.marketContext.regime)) {
    return {
      tier: 1,
      rule: 'REGIME_CONFLICT',
      triggered: true,
      message: `Bullish call conflicts with regime ${input.marketContext.regime}`,
      severity: 'HIGH',
    };
  }

  if (input.direction === 'PUT' && bullishRegimes.has(input.marketContext.regime)) {
    return {
      tier: 1,
      rule: 'REGIME_CONFLICT',
      triggered: true,
      message: `Bearish put conflicts with regime ${input.marketContext.regime}`,
      severity: 'HIGH',
    };
  }

  return null;
}

function volatilityMismatchRule(input: EntryDecisionInput): RuleResult | null {
  const band = ENTRY_VOLATILITY_BANDS[input.setupType];
  const iv = input.marketContext.ivPercentile;
  if (iv < band.minIvPercentile || iv > band.maxIvPercentile) {
    return {
      tier: 1,
      rule: 'VOLATILITY_MISMATCH',
      triggered: true,
      message: `IV percentile ${iv} outside ${band.minIvPercentile}-${band.maxIvPercentile} for ${input.setupType}`,
      severity: 'HIGH',
    };
  }
  return null;
}

function portfolioGuardrailsRule(input: EntryDecisionInput): RuleResult | null {
  if (input.riskContext.openTradesCount >= PORTFOLIO_GUARDRAILS.maxOpenTrades) {
    return {
      tier: 1,
      rule: 'PORTFOLIO_MAX_TRADES',
      triggered: true,
      message: `Open trades ${input.riskContext.openTradesCount} exceeds max ${PORTFOLIO_GUARDRAILS.maxOpenTrades}`,
      severity: 'HIGH',
    };
  }

  if (input.riskContext.dailyPnL <= PORTFOLIO_GUARDRAILS.maxDailyLoss) {
    return {
      tier: 1,
      rule: 'DAILY_LOSS_LIMIT',
      triggered: true,
      message: `Daily PnL ${input.riskContext.dailyPnL} below limit ${PORTFOLIO_GUARDRAILS.maxDailyLoss}`,
      severity: 'HIGH',
    };
  }

  if (Math.abs(input.riskContext.portfolioDelta) >= PORTFOLIO_GUARDRAILS.maxAbsDelta) {
    return {
      tier: 1,
      rule: 'PORTFOLIO_DELTA_LIMIT',
      triggered: true,
      message: `Portfolio delta ${input.riskContext.portfolioDelta} exceeds limit ${PORTFOLIO_GUARDRAILS.maxAbsDelta}`,
      severity: 'HIGH',
    };
  }

  if (Math.abs(input.riskContext.portfolioTheta) >= PORTFOLIO_GUARDRAILS.maxAbsTheta) {
    return {
      tier: 1,
      rule: 'PORTFOLIO_THETA_LIMIT',
      triggered: true,
      message: `Portfolio theta ${input.riskContext.portfolioTheta} exceeds limit ${PORTFOLIO_GUARDRAILS.maxAbsTheta}`,
      severity: 'HIGH',
    };
  }

  return null;
}

function liquiditySafetyRule(input: EntryDecisionInput): RuleResult | null {
  const allowed = ENTRY_LIQUIDITY_ALLOWED[input.setupType];
  if (!allowed.includes(input.timingContext.liquidityState)) {
    return {
      tier: 1,
      rule: 'UNSAFE_LIQUIDITY',
      triggered: true,
      message: `Liquidity state ${input.timingContext.liquidityState} not allowed for ${input.setupType}`,
      severity: 'HIGH',
    };
  }
  return null;
}

export function evaluateTier1Rules(input: EntryDecisionInput): RuleResult[] {
  const rules = [
    confidenceRule(input),
    regimeConflictRule(input),
    volatilityMismatchRule(input),
    portfolioGuardrailsRule(input),
    liquiditySafetyRule(input),
  ];

  return rules.filter((rule): rule is RuleResult => Boolean(rule));
}
