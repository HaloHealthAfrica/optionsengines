/**
 * Confluence Service - Computes confluence score from netflow, gamma regime, and optional signal direction.
 * Used for trade gating (confluence >= 75) and position sizing.
 */
import { getFlowConfigSync } from './flow-config.service.js';

export type FlowDirection = 'bullish' | 'bearish' | 'neutral';
export type GammaRegime = 'LONG_GAMMA' | 'SHORT_GAMMA' | 'NEUTRAL';
export type SignalDirection = 'long' | 'short';

export interface ConfluenceFactors {
  flowGammaAlignment: number;
  signalFlowAlignment: number;
  signalGammaAlignment: number;
  flowStrength: number;
}

export interface ConfluenceResult {
  score: number;
  aligned: boolean;
  alignment: 'aligned' | 'misaligned' | 'neutral';
  factors: ConfluenceFactors;
  tradeGatePasses: boolean;
  positionSizeMultiplier: number;
  positionSizeTier: 'full' | 'half' | 'quarter' | 'none';
}

const CONFLUENCE_THRESHOLD = 75;
const SIZING_TIERS = {
  full: 80,
  half: 70,
  quarter: 60,
} as const;

/**
 * Derive flow direction from netflow (call premium - put premium).
 */
export function getFlowDirection(netflow: number): FlowDirection {
  if (!Number.isFinite(netflow)) return 'neutral';
  if (netflow > 0) return 'bullish';
  if (netflow < 0) return 'bearish';
  return 'neutral';
}

/**
 * Derive gamma regime from GEX dealer position.
 */
export function getGammaRegime(dealerPosition: string | undefined): GammaRegime {
  const pos = String(dealerPosition || '').toLowerCase();
  if (pos === 'long_gamma') return 'LONG_GAMMA';
  if (pos === 'short_gamma') return 'SHORT_GAMMA';
  return 'NEUTRAL';
}

/**
 * Compute confluence score and alignment.
 * - With signal: full confluence (signal + flow + gamma)
 * - Without signal: flow-gamma alignment only (for Flow page context)
 */
export function computeConfluence(params: {
  netflow: number;
  gammaRegime: GammaRegime;
  signalDirection?: SignalDirection | null;
  flowEntriesCount?: number;
}): ConfluenceResult {
  const { netflow, gammaRegime, signalDirection, flowEntriesCount = 0 } = params;
  const flowDir = getFlowDirection(netflow);

  // Flow-gamma alignment: bullish flow + short gamma = expansion (bullish), bearish flow + long gamma = mean revert (bearish)
  let flowGammaAlignment = 50;
  if (flowDir === 'bullish' && gammaRegime === 'SHORT_GAMMA') flowGammaAlignment = 90;
  else if (flowDir === 'bearish' && gammaRegime === 'LONG_GAMMA') flowGammaAlignment = 90;
  else if (flowDir === 'bullish' && gammaRegime === 'LONG_GAMMA') flowGammaAlignment = 60;
  else if (flowDir === 'bearish' && gammaRegime === 'SHORT_GAMMA') flowGammaAlignment = 60;
  else if (flowDir === 'neutral' || gammaRegime === 'NEUTRAL') flowGammaAlignment = 50;

  // Signal-flow alignment (when we have a signal)
  let signalFlowAlignment = 50;
  if (signalDirection) {
    const signalBullish = signalDirection === 'long';
    const flowBullish = flowDir === 'bullish';
    const flowBearish = flowDir === 'bearish';
    if (signalBullish && flowBullish) signalFlowAlignment = 90;
    else if (!signalBullish && flowBearish) signalFlowAlignment = 90;
    else if (signalBullish && flowBearish) signalFlowAlignment = 30;
    else if (!signalBullish && flowBullish) signalFlowAlignment = 30;
    else signalFlowAlignment = 50;
  }

  // Signal-gamma alignment
  let signalGammaAlignment = 50;
  if (signalDirection) {
    const signalBullish = signalDirection === 'long';
    const gammaSupportsExpansion = gammaRegime === 'SHORT_GAMMA';
    const gammaSupportsMeanRevert = gammaRegime === 'LONG_GAMMA';
    if (signalBullish && gammaSupportsExpansion) signalGammaAlignment = 90;
    else if (!signalBullish && gammaSupportsMeanRevert) signalGammaAlignment = 90;
    else if (signalBullish && gammaSupportsMeanRevert) signalGammaAlignment = 60;
    else if (!signalBullish && gammaSupportsExpansion) signalGammaAlignment = 60;
    else signalGammaAlignment = 50;
  }

  // Flow strength (based on having flow data)
  const flowStrength = flowEntriesCount > 0 ? Math.min(80, 50 + Math.log10(flowEntriesCount + 1) * 15) : 40;

  const factors: ConfluenceFactors = {
    flowGammaAlignment,
    signalFlowAlignment,
    signalGammaAlignment,
    flowStrength,
  };

  // Weighted score: with signal use all factors, without signal use flow-gamma + flow strength
  let score: number;
  if (signalDirection) {
    score = Math.round(
      flowGammaAlignment * 0.3 +
        signalFlowAlignment * 0.35 +
        signalGammaAlignment * 0.25 +
        flowStrength * 0.1
    );
  } else {
    score = Math.round(flowGammaAlignment * 0.6 + flowStrength * 0.4);
  }
  score = Math.max(0, Math.min(100, score));

  const { confluenceMinThreshold } = getFlowConfigSync();
  const threshold = confluenceMinThreshold ?? CONFLUENCE_THRESHOLD;
  const tradeGatePasses = score >= threshold;

  let alignment: ConfluenceResult['alignment'] = 'neutral';
  if (signalDirection) {
    const signalBullish = signalDirection === 'long';
    const flowBullish = flowDir === 'bullish';
    const flowBearish = flowDir === 'bearish';
    if (signalBullish && flowBullish) alignment = 'aligned';
    else if (!signalBullish && flowBearish) alignment = 'aligned';
    else if (flowDir !== 'neutral') alignment = 'misaligned';
  }

  const aligned = alignment === 'aligned';

  let positionSizeTier: ConfluenceResult['positionSizeTier'] = 'none';
  let positionSizeMultiplier = 0;
  if (score >= SIZING_TIERS.full) {
    positionSizeTier = 'full';
    positionSizeMultiplier = 1;
  } else if (score >= SIZING_TIERS.half) {
    positionSizeTier = 'half';
    positionSizeMultiplier = 0.5;
  } else if (score >= SIZING_TIERS.quarter) {
    positionSizeTier = 'quarter';
    positionSizeMultiplier = 0.25;
  }

  return {
    score,
    aligned,
    alignment,
    factors,
    tradeGatePasses,
    positionSizeMultiplier,
    positionSizeTier,
  };
}

/**
 * Compute confluence from positioning data (for Flow page, no signal).
 */
export function computeConfluenceFromPositioning(params: {
  optionsFlow: { entries: Array<{ side: string; premium?: number }> } | null;
  gex: { dealerPosition?: string } | null;
}): ConfluenceResult {
  const { optionsFlow, gex } = params;

  let netflow = 0;
  if (optionsFlow?.entries?.length) {
    const callPremium = optionsFlow.entries
      .filter((e) => e.side === 'call')
      .reduce((s, e) => s + Number(e.premium || 0), 0);
    const putPremium = optionsFlow.entries
      .filter((e) => e.side === 'put')
      .reduce((s, e) => s + Number(e.premium || 0), 0);
    netflow = callPremium - putPremium;
  }

  const gammaRegime = getGammaRegime(gex?.dealerPosition);

  return computeConfluence({
    netflow,
    gammaRegime,
    signalDirection: null,
    flowEntriesCount: optionsFlow?.entries?.length ?? 0,
  });
}

export const confluenceService = {
  computeConfluence,
  computeConfluenceFromPositioning,
  getFlowDirection,
  getGammaRegime,
};
