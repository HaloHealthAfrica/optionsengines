/**
 * Bias State Risk Model Integration
 * Position sizing with UnifiedBiasState modifiers:
 * - riskMultiplier, macroClass, regimeType, trendPhase
 * - acceleration (stateStrengthDelta, macroDriftScore)
 * - chopScore, alignmentScore
 */

import { db } from '../database.service.js';
import { logger } from '../../utils/logger.js';
import { getStalenessConfig } from './bias-config.service.js';
import { config } from '../../config/index.js';
import type { UnifiedBiasState } from '../../lib/mtfBias/types-v3.js';

const MIN_RISK_FLOOR = 0.25;
const MAX_RISK_CAP = 1.5;
const MIN_RR = 1.5;
const MAX_RISK_PER_TRADE_PCT = 2;
const MAX_CONTRACTS = 10;

export type Direction = 'long' | 'short';
export type StrategyType = 'BREAKOUT' | 'PULLBACK' | 'MEAN_REVERT' | 'SWING';

export interface RiskModelInput {
  accountSize: number;
  baseRiskPercent: number;
  direction: Direction;
  marketState: UnifiedBiasState;
  strategyType?: StrategyType;
  entryPrice?: number;
  invalidationLevel?: number;
  atr?: number;
  /** For simulation: skip DB, use this config */
  simulationConfig?: Partial<RiskConfig>;
}

export interface ModifierContributionBreakdown {
  macro: number;
  regime: number;
  acceleration: number;
  latePhase: number;
  staleness: number;
}

export interface RiskModelOutput {
  positionSize: number;
  riskPerTrade: number;
  finalRiskMultiplier: number;
  modifiers: {
    baseRisk: number;
    aggregatorMultiplier: number;
    macroModifier: number;
    regimeModifier: number;
    accelerationModifier: number;
    latePhaseModifier: number;
    finalRisk: number;
  };
  /** Per-modifier contribution (multiplier applied, 1 = neutral) for variance audit */
  modifierContributionBreakdown?: ModifierContributionBreakdown;
  valid: boolean;
  minRr?: number;
}

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

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  macroBreakdownLongMultiplier: 0.5,
  macroTrendUpLongMultiplier: 1.15,
  macroTrendDownShortMultiplier: 0.5,
  rangeBreakoutMultiplier: 0.7,
  trendAlignmentMultiplier: 1.1,
  stateStrengthUpMultiplier: 1.1,
  stateStrengthDownMultiplier: 0.8,
  macroDriftHighMultiplier: 0.85,
  latePhaseNegativeMultiplier: 0.75,
};

let cachedRiskConfig: RiskConfig | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

async function getRiskConfig(): Promise<RiskConfig> {
  const now = Date.now();
  if (cachedRiskConfig && now - cachedAt < CACHE_TTL_MS) {
    return cachedRiskConfig;
  }
  try {
    const r = await db.query(
      `SELECT config_json FROM bias_config WHERE config_key = 'risk' LIMIT 1`
    );
    const row = r.rows[0];
    if (row?.config_json) {
      cachedRiskConfig = { ...DEFAULT_RISK_CONFIG, ...(row.config_json as Partial<RiskConfig>) };
      cachedAt = now;
      return cachedRiskConfig!;
    }
  } catch {
    /* use defaults */
  }
  cachedRiskConfig = DEFAULT_RISK_CONFIG;
  cachedAt = now;
  return cachedRiskConfig;
}

/**
 * Calculate position size with UnifiedBiasState modifiers.
 * Deterministic, testable, config-driven.
 */
export async function calculatePositionSize(input: RiskModelInput): Promise<RiskModelOutput> {
  const cfg = input.simulationConfig
    ? { ...DEFAULT_RISK_CONFIG, ...input.simulationConfig }
    : await getRiskConfig();
  const { accountSize, baseRiskPercent, direction, marketState, strategyType = 'SWING' } = input;
  const baseRisk = baseRiskPercent / 100;

  let risk = baseRisk;

  const modifiers = {
    baseRisk,
    aggregatorMultiplier: 1,
    macroModifier: 1,
    regimeModifier: 1,
    accelerationModifier: 1,
    latePhaseModifier: 1,
    finalRisk: baseRisk,
  };

  modifiers.aggregatorMultiplier = marketState.effective.riskMultiplier;
  risk *= modifiers.aggregatorMultiplier;

  if (marketState.macroClass === 'MACRO_BREAKDOWN_CONFIRMED' && direction === 'long') {
    modifiers.macroModifier = cfg.macroBreakdownLongMultiplier;
    risk *= modifiers.macroModifier;
  } else if (marketState.macroClass === 'MACRO_TREND_UP' && direction === 'long') {
    modifiers.macroModifier = cfg.macroTrendUpLongMultiplier;
    risk *= modifiers.macroModifier;
  } else if (marketState.macroClass === 'MACRO_TREND_DOWN' && direction === 'short') {
    modifiers.macroModifier = cfg.macroTrendDownShortMultiplier;
    risk *= modifiers.macroModifier;
  }

  if (marketState.regimeType === 'RANGE' && strategyType === 'BREAKOUT') {
    modifiers.regimeModifier = cfg.rangeBreakoutMultiplier;
    risk *= modifiers.regimeModifier;
  } else if (marketState.regimeType === 'TREND' && marketState.alignmentScore > 75) {
    modifiers.regimeModifier = cfg.trendAlignmentMultiplier;
    risk *= modifiers.regimeModifier;
  }

  const acc = marketState.acceleration;
  if (acc) {
    if (acc.stateStrengthDelta > 15) {
      modifiers.accelerationModifier *= cfg.stateStrengthUpMultiplier;
      risk *= cfg.stateStrengthUpMultiplier;
    } else if (acc.stateStrengthDelta < -20) {
      modifiers.accelerationModifier *= cfg.stateStrengthDownMultiplier;
      risk *= cfg.stateStrengthDownMultiplier;
    }
    if (acc.macroDriftScore > 0.15) {
      modifiers.accelerationModifier *= cfg.macroDriftHighMultiplier;
      risk *= cfg.macroDriftHighMultiplier;
    }
  }

  if (
    marketState.trendPhase === 'LATE' &&
    acc &&
    acc.stateStrengthDelta < 0
  ) {
    modifiers.latePhaseModifier = cfg.latePhaseNegativeMultiplier;
    risk *= modifiers.latePhaseModifier;
  }

  let stalenessContrib = 1;
  if (!input.simulationConfig) {
    const stalenessCfg = await getStalenessConfig();
    if (marketState.isStale && stalenessCfg.behavior === 'reduce_risk') {
      risk *= stalenessCfg.riskMultiplier;
      stalenessContrib = stalenessCfg.riskMultiplier;
    }
  } else if (marketState.isStale) {
    risk *= 0.7;
    stalenessContrib = 0.7;
  }

  const modifierContributionBreakdown: ModifierContributionBreakdown = {
    macro: modifiers.macroModifier,
    regime: modifiers.regimeModifier,
    acceleration: modifiers.accelerationModifier,
    latePhase: modifiers.latePhaseModifier,
    staleness: stalenessContrib,
  };

  const cappedRisk = Math.max(
    baseRisk * MIN_RISK_FLOOR,
    Math.min(baseRisk * MAX_RISK_CAP, risk)
  );
  modifiers.finalRisk = cappedRisk;

  const riskPerTrade = Math.min(cappedRisk, MAX_RISK_PER_TRADE_PCT / 100);
  const riskAmount = accountSize * riskPerTrade;

  let positionSize = 1;
  let valid = true;
  let minRr: number | undefined;

  if (input.entryPrice != null && input.invalidationLevel != null && input.atr != null) {
    const stopDistance = Math.abs(input.entryPrice - input.invalidationLevel);
    if (stopDistance > 0) {
      positionSize = Math.floor(riskAmount / stopDistance);
      positionSize = Math.max(1, Math.min(positionSize, MAX_CONTRACTS));
      const rewardDistance = input.atr * MIN_RR;
      minRr = rewardDistance / stopDistance;
      valid = minRr >= MIN_RR;
    }
  }

  if (config.biasControlDebugMode) {
    logger.info('Bias risk model (debug)', {
      symbol: marketState.symbol,
      direction,
      baseRisk,
      riskMultiplier: modifiers.aggregatorMultiplier,
      macroModifier: modifiers.macroModifier,
      regimeModifier: modifiers.regimeModifier,
      accelerationModifier: modifiers.accelerationModifier,
      latePhaseModifier: modifiers.latePhaseModifier,
      finalRisk: modifiers.finalRisk,
      positionSize,
      isStale: marketState.isStale,
      macroDriftScore: marketState.acceleration?.macroDriftScore,
    });
  } else {
    logger.info('Bias risk model', {
      symbol: marketState.symbol,
      direction,
      baseRisk,
      aggregatorMultiplier: modifiers.aggregatorMultiplier,
      macroModifier: modifiers.macroModifier,
      regimeModifier: modifiers.regimeModifier,
      accelerationModifier: modifiers.accelerationModifier,
      latePhaseModifier: modifiers.latePhaseModifier,
      finalRisk: modifiers.finalRisk,
      positionSize,
    });
  }

  return {
    positionSize,
    riskPerTrade,
    finalRiskMultiplier: cappedRisk / baseRisk,
    modifiers,
    modifierContributionBreakdown,
    valid,
    minRr,
  };
}

/**
 * Get risk multiplier from market state only (no position sizing).
 * Use when full calculatePositionSize inputs unavailable.
 * Returns value in [MIN_RISK_FLOOR, MAX_RISK_CAP] relative to base 1.
 */
export async function getRiskMultiplierFromState(
  marketState: UnifiedBiasState,
  direction: Direction,
  strategyType: StrategyType = 'SWING'
): Promise<number> {
  const out = await calculatePositionSize({
    accountSize: 100_000,
    baseRiskPercent: 1,
    direction,
    marketState,
    strategyType,
  });
  return out.finalRiskMultiplier;
}

/** Decision audit for explainability - every trade must be explainable */
export interface DecisionAudit {
  baseRisk: number;
  riskMultiplier: number;
  macroModifier: number;
  regimeModifier: number;
  accelerationModifier: number;
  latePhaseModifier: number;
  finalRisk: number;
  exposureDecision?: string;
  exposureReasons?: string[];
  setupBlockReason?: string | null;
}

/**
 * Get full decision audit for logging. No silent modifier stacking.
 */
export async function getRiskDecisionAudit(
  marketState: UnifiedBiasState,
  direction: Direction,
  strategyType: StrategyType = 'SWING'
): Promise<DecisionAudit> {
  const out = await calculatePositionSize({
    accountSize: 100_000,
    baseRiskPercent: 1,
    direction,
    marketState,
    strategyType,
  });
  return {
    baseRisk: out.modifiers.baseRisk,
    riskMultiplier: out.modifiers.aggregatorMultiplier,
    macroModifier: out.modifiers.macroModifier,
    regimeModifier: out.modifiers.regimeModifier,
    accelerationModifier: out.modifiers.accelerationModifier,
    latePhaseModifier: out.modifiers.latePhaseModifier,
    finalRisk: out.modifiers.finalRisk,
  };
}
