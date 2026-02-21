import { BaseAgent } from '../base-agent.js';
import { AgentOutput, EnrichedSignal, MarketData } from '../../types/index.js';

type GammaRegimeExpectation = 'mean_reversion' | 'vol_expansion' | 'neutral';

export class ContextAgent extends BaseAgent {
  constructor() {
    super('context', 'core');
  }

  async analyze(signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput> {
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

        const setupType = signal.setupType ?? 'momentum';
        const isBreakout = setupType === 'breakout' || setupType === 'momentum';
        const isPullback = setupType === 'pullback' || setupType === 'mean_revert';

        if (dealerPosition === 'long_gamma') {
          gammaRegime = 'mean_reversion';
          reasons.push('dealer_long_gamma_mean_revert_regime');

          bias = signal.direction === 'long' ? 'bullish' : 'bearish';

          if (isPullback) {
            confidence = Math.min(confidence + 10, 65);
            reasons.push('gamma_supports_pullback');
          } else if (isBreakout) {
            confidence = Math.max(confidence - 10, 25);
            reasons.push('gamma_resists_breakout');
          }
          confidence = Math.min(confidence, 65);
        } else if (dealerPosition === 'short_gamma') {
          gammaRegime = 'vol_expansion';
          reasons.push('dealer_short_gamma_expansion_regime');

          bias = signal.direction === 'long' ? 'bullish' : 'bearish';

          if (isBreakout) {
            confidence = Math.min(confidence + 15, 85);
            reasons.push('gamma_supports_breakout');
          } else if (isPullback) {
            confidence = Math.max(confidence - 5, 30);
            reasons.push('gamma_fades_pullback');
          }
          confidence = Math.min(confidence, 85);
        } else {
          gammaRegime = 'neutral';
          bias = signal.direction === 'long' ? 'bullish' : 'bearish';
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
