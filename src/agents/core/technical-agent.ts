// Technical Agent - price action and indicator alignment
import { BaseAgent } from '../base-agent.js';
import { AgentOutput, EnrichedSignal, MarketData } from '../../types/index.js';

export class TechnicalAgent extends BaseAgent {
  constructor() {
    super('technical', 'core');
  }

  async analyze(_signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput> {
    const indicators = marketData.indicators;
    const price = marketData.currentPrice;

    const ema8 = indicators.ema8[indicators.ema8.length - 1] ?? price;
    const ema21 = indicators.ema21[indicators.ema21.length - 1] ?? price;

    let bias: AgentOutput['bias'] = 'neutral';
    let confidence = 40;
    const reasons: string[] = [];

    if (ema8 > ema21 && price >= ema21) {
      bias = 'bullish';
      confidence = 75;
      reasons.push('price_above_fast_emas');
    } else if (ema8 < ema21 && price <= ema21) {
      bias = 'bearish';
      confidence = 75;
      reasons.push('price_below_fast_emas');
    } else {
      reasons.push('mixed_ema_alignment');
    }

    return this.buildOutput(bias, confidence, reasons, false);
  }
}
