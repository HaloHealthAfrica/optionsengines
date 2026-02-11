// Satyland Sub-Agent - confirmation signals only
import { BaseAgent } from '../base-agent.js';
import { AgentOutput, EnrichedSignal, MarketData } from '../../types/index.js';
import { featureFlags } from '../../services/feature-flag.service.js';

export class SatylandSubAgent extends BaseAgent {
  constructor() {
    super('satyland_subagent', 'subagent');
  }

  shouldActivate(_signal: EnrichedSignal, _marketData: MarketData): boolean {
    return featureFlags.isEnabled('enable_satyland_subagent');
  }

  async analyze(_signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput> {
    const price = marketData.currentPrice;
    const ema21 = marketData.indicators.ema21[marketData.indicators.ema21.length - 1] ?? price;

    const alignment = price >= ema21 ? 'bullish' : 'bearish';
    let confidence = alignment === 'bullish' ? 70 : 40;
    confidence = Math.max(20, Math.min(90, confidence));

    return this.buildOutput(alignment === 'bullish' ? 'bullish' : 'bearish', confidence, ['satyland_alignment'], false, {
      agentType: 'subagent',
      ribbonAlignment: alignment,
    });
  }
}
