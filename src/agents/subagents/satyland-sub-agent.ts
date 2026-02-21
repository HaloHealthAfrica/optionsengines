/**
 * @deprecated Replaced by MultiTimeframeTrendAgent in Engine B rebuild.
 * Kept for backward compatibility with existing experiment data.
 * New deployments should use MultiTimeframeTrendAgent instead.
 */
import { BaseAgent } from '../base-agent.js';
import { AgentOutput, EnrichedSignal, MarketData } from '../../types/index.js';

export class SatylandSubAgent extends BaseAgent {
  constructor() {
    super('satyland_subagent', 'subagent');
  }

  shouldActivate(): boolean {
    return false;
  }

  async analyze(_signal: EnrichedSignal, _marketData: MarketData): Promise<AgentOutput> {
    return this.buildOutput('neutral', 0, ['deprecated_agent'], false, {
      agentType: 'subagent',
      deprecated: true,
    });
  }
}
