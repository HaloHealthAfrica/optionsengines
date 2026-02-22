import { BaseAgent } from '../base-agent.js';
import { AgentOutput, EnrichedSignal, MarketData } from '../../types/index.js';

type GammaRegimeExpectation = 'mean_reversion' | 'vol_expansion' | 'neutral';

export class ContextAgent extends BaseAgent {
  constructor() {
    super('context', 'core');
  }

  async analyze(_signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput> {
    const { sessionContext, indicators, currentPrice } = marketData;
    const atr = indicators.atr[indicators.atr.length - 1] ?? 0;
    const reasons: string[] = [];
    let bias: AgentOutput['bias'] = 'neutral';
    let confidence = 50;

    if (!sessionContext.isMarketOpen) {
      return this.buildOutput('neutral', 10, ['market_closed'], false, {
        agentType: 'core',
        gammaRegime: 'neutral' as GammaRegimeExpectation,
      });
    }

    const volatilityRatio = currentPrice > 0 ? atr / currentPrice : 0;
    if (volatilityRatio > 0.025) {
      confidence = 30;
      reasons.push('extreme_volatility');
    } else if (volatilityRatio > 0.015) {
      confidence = 40;
      reasons.push('elevated_volatility');
    } else {
      confidence = 60;
      reasons.push('stable_volatility');
    }

    let gammaRegime: GammaRegimeExpectation = 'neutral';
    let distanceToZeroGamma = 0;

    const ema8 = indicators.ema8[indicators.ema8.length - 1] ?? currentPrice;
    const ema21 = indicators.ema21[indicators.ema21.length - 1] ?? currentPrice;
    const priceAboveEma21 = currentPrice > ema21;
    const emaTrendUp = ema8 > ema21;

    const gex = marketData.gex;
    if (gex) {
      const { zeroGammaLevel, volatilityExpectation, netGex, dealerPosition } = gex;

      if (volatilityExpectation === 'compressed') {
        reasons.push('gamma_compressed');
        confidence = Math.min(confidence, 55);
      } else if (volatilityExpectation === 'expanding') {
        reasons.push('gamma_expanding');
      }

      if (zeroGammaLevel != null && currentPrice > 0) {
        distanceToZeroGamma =
          ((currentPrice - zeroGammaLevel) / currentPrice) * 100;
        const absDist = Math.abs(distanceToZeroGamma);
        if (absDist < 0.5) reasons.push('at_zero_gamma_level');
        else if (absDist < 1.0) reasons.push('near_zero_gamma');
      }

      if (netGex != null && Number.isFinite(netGex)) {
        reasons.push(`netGex_${netGex > 0 ? 'positive' : netGex < 0 ? 'negative' : 'neutral'}`);

        if (dealerPosition === 'long_gamma') {
          gammaRegime = 'mean_reversion';
          reasons.push('dealer_long_gamma_mean_revert_regime');

          // Long gamma = mean reversion: fade the current price direction
          if (priceAboveEma21) {
            bias = 'bearish';
            reasons.push('gamma_fade_above_ema21');
          } else {
            bias = 'bullish';
            reasons.push('gamma_fade_below_ema21');
          }
          confidence = Math.min(confidence, 65);
        } else if (dealerPosition === 'short_gamma') {
          gammaRegime = 'vol_expansion';
          reasons.push('dealer_short_gamma_expansion_regime');

          // Short gamma = expansion: follow the EMA trend direction
          if (emaTrendUp) {
            bias = 'bullish';
            reasons.push('gamma_expansion_trend_up');
          } else {
            bias = 'bearish';
            reasons.push('gamma_expansion_trend_down');
          }
          confidence = Math.min(confidence, 85);
        } else {
          gammaRegime = 'neutral';
        }
      }
    }

    if (sessionContext.minutesUntilClose != null && sessionContext.minutesUntilClose < 15) {
      confidence = Math.min(confidence, 30);
      reasons.push('near_market_close');
    }

    return this.buildOutput(bias, Math.round(confidence), reasons, false, {
      agentType: 'core',
      gammaRegime,
      distanceToZeroGamma: Math.round(distanceToZeroGamma * 100) / 100,
      volatilityRatio: Math.round(volatilityRatio * 10000) / 10000,
    });
  }
}
