/**
 * GammaDealerStrategy - Type definitions
 */

export type GammaRegime = 'LONG_GAMMA' | 'SHORT_GAMMA' | 'NEUTRAL';
export type StrategyDirection = 'LONG' | 'SHORT' | 'HOLD';
export type ExitProfile = 'TREND' | 'MEAN_REVERT';

export interface StrikeAdjustment {
  gammaInfluencedStrike: boolean;
  gammaTargetStrike: number | null;
}

export interface GammaStrategyDecision {
  strategy: 'GammaDealerStrategy';
  regime: GammaRegime;
  direction: StrategyDirection;
  confidence_score: number;
  position_size_multiplier: number;
  strike_adjustment: StrikeAdjustment;
  exit_profile: ExitProfile;
  gamma_context: {
    net_gamma: number;
    gamma_flip: number | null;
    dealer_bias: string;
    top_gamma_strikes: Array<{ strike: number; netGamma: number }>;
  };
}

export interface SignalLike {
  signal_id: string;
  symbol: string;
  direction: 'long' | 'short';
  timeframe: string;
  raw_payload?: Record<string, unknown>;
}

export interface MarketDataLike {
  currentPrice?: number;
  gex?: { zeroGammaLevel?: number; dealerPosition?: string };
  optionsFlow?: { entries?: unknown[] };
}
