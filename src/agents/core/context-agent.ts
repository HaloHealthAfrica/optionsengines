// Context Agent - market regime and session context
import { BaseAgent } from '../base-agent.js';
import { AgentOutput, EnrichedSignal, MarketData } from '../../types/index.js';

export class ContextAgent extends BaseAgent {
  constructor() {
    super('context', 'core');
  }

  async analyze(_signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput> {
    const { sessionContext, indicators, currentPrice } = marketData;
    const atr = indicators.atr[indicators.atr.length - 1] ?? 0;

    let bias: AgentOutput['bias'] = 'neutral';
    let confidence = 50;
    const reasons: string[] = [];

    if (!sessionContext.isMarketOpen) {
      confidence = 10;
      reasons.push('market_closed');
      return this.buildOutput(bias, confidence, reasons, false);
    }

    const volatilityRatio = currentPrice > 0 ? atr / currentPrice : 0;
    if (volatilityRatio > 0.02) {
      confidence = 35;
      reasons.push('high_volatility');
    } else {
      confidence = 60;
      reasons.push('stable_volatility');
    }

    const gex = marketData.gex;
    if (gex) {
      const { zeroGammaLevel, volatilityExpectation } = gex;
      if (volatilityExpectation === 'compressed') {
        reasons.push('gamma_compressed');
        confidence = Math.min(confidence, 55);
      } else if (volatilityExpectation === 'expanding') {
        reasons.push('gamma_expanding');
      }
      if (zeroGammaLevel != null && currentPrice > 0) {
        const distPct = Math.abs(currentPrice - zeroGammaLevel) / currentPrice;
        if (distPct < 0.01) reasons.push('near_zero_gamma');
      }
    }

    return this.buildOutput(bias, confidence, reasons, false);
  }
}
