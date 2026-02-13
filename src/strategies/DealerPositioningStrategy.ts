/**
 * DealerPositioningStrategy - Uses GEX + flow from positioning service
 * No Unusual Whales gamma API required. Uses dealer_position, zero_gamma_level, netflow.
 * Operates when GammaDealerStrategy is disabled or UW gamma unavailable.
 */

import { logger } from '../utils/logger.js';
import type { GammaRegime } from './types.js';

export interface DealerPositionContext {
  symbol: string;
  dealerPosition: 'long_gamma' | 'short_gamma' | 'neutral';
  zeroGammaLevel?: number | null;
  netGex: number;
  netflow: number;
  flowDirection: 'bullish' | 'bearish' | 'neutral';
}

export interface DealerPositioningDecision {
  strategy: 'DealerPositioningStrategy';
  regime: GammaRegime;
  direction: 'LONG' | 'SHORT' | 'HOLD';
  confidence_score: number;
  position_size_multiplier: number;
  exit_profile: 'TREND' | 'MEAN_REVERT';
  dealer_context: {
    dealerPosition: string;
    zeroGammaLevel: number | null;
    netflow: number;
    flowDirection: string;
  };
}

function dealerToRegime(pos: string): GammaRegime {
  const p = String(pos || '').toLowerCase();
  if (p === 'long_gamma') return 'LONG_GAMMA';
  if (p === 'short_gamma') return 'SHORT_GAMMA';
  return 'NEUTRAL';
}

function flowDirection(netflow: number): 'bullish' | 'bearish' | 'neutral' {
  if (!Number.isFinite(netflow)) return 'neutral';
  if (netflow > 0) return 'bullish';
  if (netflow < 0) return 'bearish';
  return 'neutral';
}

export class DealerPositioningStrategy {
  evaluate(
    signal: { symbol: string; direction: 'long' | 'short' },
    context: DealerPositionContext | null
  ): DealerPositioningDecision | null {
    if (!context) return null;

    const regime = dealerToRegime(context.dealerPosition);
    const flowDir = context.flowDirection;

    let direction: 'LONG' | 'SHORT' | 'HOLD' = 'HOLD';
    let confidence_score = 0.5;
    let position_size_multiplier = 1.0;
    let exit_profile: 'TREND' | 'MEAN_REVERT' = 'MEAN_REVERT';

    if (regime === 'SHORT_GAMMA') {
      position_size_multiplier = 1.2;
      exit_profile = 'TREND';
      confidence_score = 0.6;
      if (signal.direction === 'long' && flowDir === 'bullish') {
        direction = 'LONG';
        confidence_score = Math.min(0.8, confidence_score + 0.1);
      } else if (signal.direction === 'short' && flowDir === 'bearish') {
        direction = 'SHORT';
        confidence_score = Math.min(0.8, confidence_score + 0.1);
      } else if (signal.direction === 'long' || signal.direction === 'short') {
        direction = signal.direction === 'long' ? 'LONG' : 'SHORT';
      }
    } else if (regime === 'LONG_GAMMA') {
      position_size_multiplier = 0.8;
      exit_profile = 'MEAN_REVERT';
      confidence_score = 0.55;
      if (signal.direction === 'long' || signal.direction === 'short') {
        direction = signal.direction === 'long' ? 'LONG' : 'SHORT';
      }
    } else {
      position_size_multiplier = 0.9;
      confidence_score = 0.5;
      if (signal.direction === 'long' && flowDir === 'bullish') {
        direction = 'LONG';
      } else if (signal.direction === 'short' && flowDir === 'bearish') {
        direction = 'SHORT';
      }
    }

    const decision: DealerPositioningDecision = {
      strategy: 'DealerPositioningStrategy',
      regime,
      direction,
      confidence_score,
      position_size_multiplier,
      exit_profile,
      dealer_context: {
        dealerPosition: context.dealerPosition,
        zeroGammaLevel: context.zeroGammaLevel ?? null,
        netflow: context.netflow,
        flowDirection: context.flowDirection,
      },
    };

    logger.info('DealerPositioningStrategy evaluation', {
      symbol: signal.symbol,
      regime,
      direction,
      confidence_score,
      position_size_multiplier,
    });

    return decision;
  }

  buildContextFromEnrichment(enrichment: {
    gex?: { dealerPosition?: string; zeroGammaLevel?: number; netGex?: number } | null;
    optionsFlow?: { entries?: Array<{ side?: string; premium?: number }> } | null;
  } | null, symbol: string): DealerPositionContext | null {
    if (!enrichment?.gex) return null;

    const gex = enrichment.gex;
    const dealerPosition = (gex.dealerPosition || 'neutral') as 'long_gamma' | 'short_gamma' | 'neutral';

    let netflow = 0;
    if (enrichment.optionsFlow?.entries?.length) {
      const callPremium = enrichment.optionsFlow.entries
        .filter((e) => e.side === 'call')
        .reduce((s, e) => s + Number(e.premium ?? 0), 0);
      const putPremium = enrichment.optionsFlow.entries
        .filter((e) => e.side === 'put')
        .reduce((s, e) => s + Number(e.premium ?? 0), 0);
      netflow = callPremium - putPremium;
    }

    return {
      symbol,
      dealerPosition,
      zeroGammaLevel: gex.zeroGammaLevel ?? null,
      netGex: gex.netGex ?? 0,
      netflow,
      flowDirection: flowDirection(netflow),
    };
  }
}

export const dealerPositioningStrategy = new DealerPositioningStrategy();
