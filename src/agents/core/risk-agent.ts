// Risk Agent - absolute veto checks
import { BaseAgent } from '../base-agent.js';
import { AgentOutput, EnrichedSignal, MarketData } from '../../types/index.js';

export class RiskAgent extends BaseAgent {
  constructor() {
    super('risk', 'core');
  }

  async analyze(_signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput> {
    const reasons: string[] = [];
    let block = false;

    if (!marketData.sessionContext.isMarketOpen) {
      block = true;
      reasons.push('market_closed');
    }

    const risk = marketData.risk;
    if (risk?.positionLimitExceeded) {
      block = true;
      reasons.push('position_limit_exceeded');
    }

    if (risk?.exposureExceeded) {
      block = true;
      reasons.push('exposure_exceeded');
    }

    const bias: AgentOutput['bias'] = 'neutral';
    const confidence = block ? 0 : 50;

    return this.buildOutput(bias, confidence, reasons, block);
  }
}
