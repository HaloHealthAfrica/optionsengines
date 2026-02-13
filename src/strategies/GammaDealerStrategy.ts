/**
 * GammaDealerStrategy - Gamma-aware trading strategy
 * Integrates Unusual Whales gamma exposure + dealer positioning.
 * Operates alongside Engine A and Engine B without modifying them.
 */

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { unusualWhalesGammaProvider, GammaContext } from '../services/providers/unusualwhales-gamma.js';
import type {
  GammaRegime,
  StrategyDirection,
  ExitProfile,
  GammaStrategyDecision,
  StrikeAdjustment,
  SignalLike,
  MarketDataLike,
} from './types.js';

export class GammaDealerStrategy {
  private get enabled(): boolean {
    return config.enableDealerUwGamma;
  }

  private get threshold(): number {
    return config.dealerUwNeutralThreshold;
  }

  classifyRegime(netGamma: number): GammaRegime {
    if (Math.abs(netGamma) < this.threshold) return 'NEUTRAL';
    return netGamma > 0 ? 'LONG_GAMMA' : 'SHORT_GAMMA';
  }

  async evaluate(
    signal: SignalLike,
    _marketData: MarketDataLike,
    gammaContext: GammaContext | null
  ): Promise<GammaStrategyDecision | null> {
    if (!this.enabled) return null;
    if (!gammaContext) {
      logger.debug('GammaDealerStrategy skipped: no gamma context', { symbol: signal.symbol });
      return null;
    }

    const regime = this.classifyRegime(gammaContext.net_gamma);

    let direction: StrategyDirection = 'HOLD';
    let confidence_score = 0.5;
    let position_size_multiplier = 1.0;
    let exit_profile: ExitProfile = 'MEAN_REVERT';
    const strike_adjustment: StrikeAdjustment = {
      gammaInfluencedStrike: false,
      gammaTargetStrike: null,
    };

    if (regime === 'SHORT_GAMMA') {
      position_size_multiplier = 1.2;
      exit_profile = 'TREND';
      confidence_score = 0.65;
      if (signal.direction === 'long') {
        direction = gammaContext.dealer_bias === 'short' ? 'LONG' : 'HOLD';
        if (direction === 'LONG') confidence_score = Math.min(0.85, confidence_score + 0.15);
      } else if (signal.direction === 'short') {
        direction = gammaContext.dealer_bias === 'long' ? 'SHORT' : 'HOLD';
        if (direction === 'SHORT') confidence_score = Math.min(0.85, confidence_score + 0.15);
      }
      if (gammaContext.gamma_flip != null) {
        strike_adjustment.gammaInfluencedStrike = true;
        strike_adjustment.gammaTargetStrike = gammaContext.gamma_flip;
      }
    } else if (regime === 'LONG_GAMMA') {
      position_size_multiplier = 0.7;
      exit_profile = 'MEAN_REVERT';
      confidence_score = 0.55;
      if (signal.direction === 'long' || signal.direction === 'short') {
        direction = signal.direction === 'long' ? 'LONG' : 'SHORT';
      }
      const topStrike = gammaContext.top_gamma_strikes[0];
      if (topStrike) {
        strike_adjustment.gammaInfluencedStrike = true;
        strike_adjustment.gammaTargetStrike = topStrike.strike;
      }
    } else {
      position_size_multiplier = 0.8;
      confidence_score = 0.5;
    }

    const decision: GammaStrategyDecision = {
      strategy: 'GammaDealerStrategy',
      regime,
      direction,
      confidence_score,
      position_size_multiplier,
      strike_adjustment,
      exit_profile,
      gamma_context: {
        net_gamma: gammaContext.net_gamma,
        gamma_flip: gammaContext.gamma_flip,
        dealer_bias: gammaContext.dealer_bias,
        top_gamma_strikes: gammaContext.top_gamma_strikes,
      },
    };

    logger.info('GammaDealerStrategy evaluation', {
      symbol: signal.symbol,
      regime,
      direction,
      confidence_score,
      position_size_multiplier,
    });

    return decision;
  }

  async getGammaContext(symbol: string): Promise<GammaContext | null> {
    if (!this.enabled || !config.unusualWhalesApiKey) return null;
    return unusualWhalesGammaProvider.getGammaContext(symbol);
  }
}

export const gammaDealerStrategy = new GammaDealerStrategy();
