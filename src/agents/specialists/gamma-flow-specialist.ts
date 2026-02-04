import { BaseAgent } from '../base-agent.js';
import { AgentOutput, EnrichedSignal, MarketData } from '../../types/index.js';

export class GammaFlowSpecialist extends BaseAgent {
  constructor() {
    super('gamma_flow', 'specialist');
  }

  shouldActivate(_signal: EnrichedSignal, marketData: MarketData): boolean {
    return Boolean(marketData.gex || marketData.optionsFlow);
  }

  async analyze(_signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput> {
    const reasons: string[] = [];
    let score = 0;

    if (marketData.gex) {
      const netGex = marketData.gex.netGex;
      if (netGex > 0) {
        score += 1;
        reasons.push('Net GEX positive (long gamma regime)');
      } else if (netGex < 0) {
        score -= 1;
        reasons.push('Net GEX negative (short gamma regime)');
      } else {
        reasons.push('Net GEX neutral');
      }
    } else {
      reasons.push('GEX data unavailable');
    }

    if (marketData.optionsFlow?.entries?.length) {
      const callVol = marketData.optionsFlow.entries
        .filter((entry) => entry.side === 'call')
        .reduce((sum, entry) => sum + entry.volume, 0);
      const putVol = marketData.optionsFlow.entries
        .filter((entry) => entry.side === 'put')
        .reduce((sum, entry) => sum + entry.volume, 0);

      if (callVol > putVol) {
        score += 1;
        reasons.push('Options flow skewed to calls');
      } else if (putVol > callVol) {
        score -= 1;
        reasons.push('Options flow skewed to puts');
      } else {
        reasons.push('Options flow balanced');
      }
    } else {
      reasons.push('Options flow data unavailable');
    }

    const bias = score > 0 ? 'bullish' : score < 0 ? 'bearish' : 'neutral';
    const confidence = Math.min(90, 45 + Math.abs(score) * 20);

    return this.buildOutput(bias, confidence, reasons, false, {
      gex: marketData.gex ?? null,
      flowSampleSize: marketData.optionsFlow?.entries?.length ?? 0,
    });
  }
}
