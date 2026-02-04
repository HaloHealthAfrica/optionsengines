// TTM Specialist Agent - TTM Squeeze momentum alignment
import { BaseAgent } from '../base-agent.js';
import { AgentOutput, EnrichedSignal, MarketData } from '../../types/index.js';
import { featureFlags } from '../../services/feature-flag.service.js';

export class TTMSpecialist extends BaseAgent {
  constructor() {
    super('ttm_specialist', 'specialist');
  }

  shouldActivate(signal: EnrichedSignal, marketData: MarketData): boolean {
    if (!featureFlags.isEnabled('enable_ttm_specialist')) {
      return false;
    }
    const squeeze = marketData.indicators.ttmSqueeze;
    if (squeeze.state !== 'off') {
      return false;
    }
    const momentumAligned =
      (signal.direction === 'long' && squeeze.momentum >= 0) ||
      (signal.direction === 'short' && squeeze.momentum <= 0);
    return momentumAligned;
  }

  async analyze(signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput> {
    const squeeze = marketData.indicators.ttmSqueeze;
    const momentumAligned =
      (signal.direction === 'long' && squeeze.momentum >= 0) ||
      (signal.direction === 'short' && squeeze.momentum <= 0);

    const bias: AgentOutput['bias'] = signal.direction === 'long' ? 'bullish' : 'bearish';
    let confidence = momentumAligned ? 70 : 20;
    confidence = Math.max(0, Math.min(80, confidence));

    const reasons = momentumAligned ? ['momentum_aligned'] : ['momentum_not_aligned'];

    return this.buildOutput(bias, confidence, reasons, false, {
      agentType: 'specialist',
      squeezeState: squeeze.state,
      momentumDirection: squeeze.momentum >= 0 ? 'bullish' : 'bearish',
    });
  }
}
