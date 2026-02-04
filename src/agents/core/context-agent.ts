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

    return this.buildOutput(bias, confidence, reasons, false);
  }
}
