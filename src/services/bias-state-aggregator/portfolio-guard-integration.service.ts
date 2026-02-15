/**
 * Portfolio Guard Integration - UnifiedBiasState-aware exposure control.
 * Uses macro drift, regime instability, volatility expansion to gate new trades.
 */

import { db } from '../database.service.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import type { UnifiedBiasState } from '../../lib/mtfBias/types-v3.js';
import { PORTFOLIO_GUARDRAILS } from '../../lib/shared/constants.js';

export type GuardResult = 'ALLOW' | 'DOWNGRADE' | 'BLOCK';

export interface OpenPosition {
  position_id: string;
  symbol: string;
  type: 'call' | 'put';
  quantity: number;
  entry_price: number;
  entry_regime_type?: string;
}

export interface NewTrade {
  symbol: string;
  direction: 'long' | 'short';
  strategyType?: 'BREAKOUT' | 'PULLBACK' | 'MEAN_REVERT' | 'SWING';
  definedRisk?: boolean;
}

export interface ExposureEvaluationInput {
  openPositions: OpenPosition[];
  newTrade: NewTrade;
  marketState: UnifiedBiasState;
}

export interface ExposureEvaluationOutput {
  result: GuardResult;
  reasons: string[];
  metrics: {
    netDirectionalExposure: number;
    grossExposure: number;
    macroBiasCluster: number;
    allowedNewExposurePct: number;
    definedRiskOnly: boolean;
    maxDirectionalTrades: number;
  };
}

const MACRO_DRIFT_THRESHOLD = 0.15;
const RANGE_CHOP_THRESHOLD = 70;
const MACRO_UNSTABLE_CLASSES = ['MACRO_REVERSAL_RISK', 'MACRO_RANGE'] as const;
const MAX_SAME_DIRECTION_PER_SYMBOL_CLUSTER = 2;
const MAX_MACRO_MISALIGNED_EXPOSURE = 3;

function getDirectionalSign(type: 'call' | 'put', quantity: number): number {
  return type === 'call' ? quantity : -quantity;
}

function computePortfolioMetrics(positions: OpenPosition[]): {
  netDirectionalExposure: number;
  grossExposure: number;
  longCount: number;
  shortCount: number;
} {
  let netDir = 0;
  let gross = 0;
  let longCount = 0;
  let shortCount = 0;
  for (const p of positions) {
    const sign = getDirectionalSign(p.type, p.quantity);
    netDir += sign;
    gross += Math.abs(p.quantity);
    if (sign > 0) longCount++;
    else shortCount++;
  }
  return { netDirectionalExposure: netDir, grossExposure: gross, longCount, shortCount };
}

/**
 * Evaluate exposure for a new trade using UnifiedBiasState.
 * Implements macro drift guard, range regime guard, volatility expansion guard.
 */
export async function evaluateExposure(
  input: ExposureEvaluationInput
): Promise<ExposureEvaluationOutput> {
  const { openPositions, newTrade, marketState } = input;
  const reasons: string[] = [];
  let allowedNewExposurePct = 1;
  let definedRiskOnly = false;
  let maxDirectionalTrades = PORTFOLIO_GUARDRAILS.maxOpenTrades;

  const { netDirectionalExposure, grossExposure, longCount, shortCount } =
    computePortfolioMetrics(openPositions);

  const directionalCount = newTrade.direction === 'long' ? longCount : shortCount;

  let macroBiasCluster = 0;
  const bearishMacro = ['MACRO_BREAKDOWN_CONFIRMED', 'MACRO_TREND_DOWN'];
  const bullishMacro = ['MACRO_TREND_UP'];
  if (bearishMacro.includes(marketState.macroClass) && longCount > 0) {
    macroBiasCluster = longCount;
  } else if (bullishMacro.includes(marketState.macroClass) && shortCount > 0) {
    macroBiasCluster = shortCount;
  }

  const symbolClusterCount = openPositions.filter(
    (p) => p.symbol === newTrade.symbol && getDirectionalSign(p.type, p.quantity) * (newTrade.direction === 'long' ? 1 : -1) > 0
  ).length;
  if (symbolClusterCount >= MAX_SAME_DIRECTION_PER_SYMBOL_CLUSTER) {
    reasons.push('MAX_SAME_DIRECTION_PER_SYMBOL_CLUSTER');
    return {
      result: 'BLOCK',
      reasons,
      metrics: {
        netDirectionalExposure,
        grossExposure,
        macroBiasCluster,
        allowedNewExposurePct: 0,
        definedRiskOnly: true,
        maxDirectionalTrades,
      },
    };
  }

  if (macroBiasCluster >= MAX_MACRO_MISALIGNED_EXPOSURE) {
    reasons.push('MACRO_BIAS_CLUSTER');
    return {
      result: 'BLOCK',
      reasons,
      metrics: {
        netDirectionalExposure,
        grossExposure,
        macroBiasCluster,
        allowedNewExposurePct: 0,
        definedRiskOnly: true,
        maxDirectionalTrades,
      },
    };
  }

  const acc = marketState.acceleration;
  const macroDriftHigh = (acc?.macroDriftScore ?? 0) > MACRO_DRIFT_THRESHOLD;
  const macroFlip = marketState.transitions?.macroFlip ?? false;

  if (macroDriftHigh || macroFlip) {
    allowedNewExposurePct *= 0.5;
    definedRiskOnly = true;
    reasons.push('MACRO_DRIFT_GUARD');
  }

  if (
    marketState.regimeType === 'RANGE' &&
    marketState.chopScore > RANGE_CHOP_THRESHOLD
  ) {
    maxDirectionalTrades = Math.min(maxDirectionalTrades, 2);
    if (directionalCount >= maxDirectionalTrades) {
      reasons.push('RANGE_REGIME_DIRECTIONAL_CAP');
    }
    if (newTrade.strategyType === 'BREAKOUT') {
      reasons.push('RANGE_BREAKOUT_BLOCKED');
      return {
        result: 'BLOCK',
        reasons,
        metrics: {
          netDirectionalExposure,
          grossExposure,
          macroBiasCluster,
          allowedNewExposurePct,
          definedRiskOnly,
          maxDirectionalTrades,
        },
      };
    }
  }

  const atrExpanding = marketState.atrState15m === 'EXPANDING';
  const macroUnstable = MACRO_UNSTABLE_CLASSES.includes(
    marketState.macroClass as (typeof MACRO_UNSTABLE_CLASSES)[number]
  );
  if (atrExpanding && macroUnstable) {
    allowedNewExposurePct *= 0.8;
    reasons.push('VOLATILITY_EXPANSION_GUARD');
  }

  if (openPositions.length >= PORTFOLIO_GUARDRAILS.maxOpenTrades) {
    reasons.push('MAX_OPEN_TRADES');
    return {
      result: 'BLOCK',
      reasons,
      metrics: {
        netDirectionalExposure,
        grossExposure,
        macroBiasCluster,
        allowedNewExposurePct: 0,
        definedRiskOnly,
        maxDirectionalTrades,
      },
    };
  }

  const symbolCount = openPositions.filter((p) => p.symbol === newTrade.symbol).length;
  if (symbolCount >= 2) {
    reasons.push('MAX_POSITIONS_PER_SYMBOL');
    return {
      result: 'BLOCK',
      reasons,
      metrics: {
        netDirectionalExposure,
        grossExposure,
        macroBiasCluster,
        allowedNewExposurePct: 0,
        definedRiskOnly,
        maxDirectionalTrades,
      },
    };
  }

  const hasBlock = reasons.some((r) =>
    ['MACRO_BIAS_CLUSTER', 'RANGE_BREAKOUT_BLOCKED', 'MAX_OPEN_TRADES', 'MAX_POSITIONS_PER_SYMBOL', 'MAX_SAME_DIRECTION_PER_SYMBOL_CLUSTER'].includes(r)
  );
  const hasDowngrade = reasons.length > 0 && !hasBlock;

  if (config.biasControlDebugMode) {
    logger.info('Portfolio guard evaluation (debug)', {
      symbol: newTrade.symbol,
      result: hasBlock ? 'BLOCK' : hasDowngrade ? 'DOWNGRADE' : 'ALLOW',
      reasons,
      netDirectionalExposure,
      grossExposure,
      macroBiasCluster,
      allowedNewExposurePct,
      definedRiskOnly,
      maxDirectionalTrades,
      macroDriftScore: marketState.acceleration?.macroDriftScore,
      macroFlip: marketState.transitions?.macroFlip,
    });
  } else {
    logger.info('Portfolio guard evaluation', {
      symbol: newTrade.symbol,
      result: hasBlock ? 'BLOCK' : hasDowngrade ? 'DOWNGRADE' : 'ALLOW',
      reasons,
      netDirectionalExposure,
      grossExposure,
      macroBiasCluster,
    });
  }

  return {
    result: hasBlock ? 'BLOCK' : hasDowngrade ? 'DOWNGRADE' : 'ALLOW',
    reasons,
    metrics: {
      netDirectionalExposure,
      grossExposure,
      macroBiasCluster,
      allowedNewExposurePct,
      definedRiskOnly,
      maxDirectionalTrades,
    },
  };
}

/** Load open positions from DB for evaluateExposure. */
export async function loadOpenPositions(): Promise<OpenPosition[]> {
  const r = await db.query(
    `SELECT position_id, symbol, type, quantity, entry_price, entry_regime_type
     FROM refactored_positions WHERE status IN ('open', 'closing')`
  );
  return r.rows.map((row) => ({
    position_id: row.position_id,
    symbol: String(row.symbol ?? '').toUpperCase(),
    type: row.type === 'put' ? 'put' : 'call',
    quantity: Number(row.quantity ?? 0),
    entry_price: Number(row.entry_price ?? 0),
    entry_regime_type: row.entry_regime_type,
  }));
}
