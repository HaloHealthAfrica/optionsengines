// Meta-Decision Agent - aggregates all agent outputs
import { BaseAgent, AgentType } from '../base-agent.js';
import { AgentOutput, EnrichedSignal, MarketData, MetaDecision } from '../../types/index.js';

const weights: Record<AgentType, number> = {
  specialist: 0.4,
  core: 0.35,
  subagent: 0.25,
};

type AgentOutputWithType = AgentOutput & {
  metadata?: AgentOutput['metadata'] & { agentType?: AgentType };
};

export class MetaDecisionAgent extends BaseAgent {
  constructor() {
    super('meta-decision', 'core');
  }

  aggregate(outputs: AgentOutputWithType[]): MetaDecision {
    const riskBlocked = outputs.some((o) => o.agent === 'risk' && o.block);
    if (riskBlocked) {
      return {
        finalBias: 'neutral',
        finalConfidence: 0,
        contributingAgents: outputs.map((o) => o.agent),
        consensusStrength: 0,
        decision: 'reject',
        reasons: ['risk_agent_blocked'],
      };
    }

    const scores: Record<MetaDecision['finalBias'], number> = {
      bullish: 0,
      bearish: 0,
      neutral: 0,
    };

    let totalWeight = 0;
    for (const output of outputs) {
      const agentType = output.metadata?.agentType ?? 'core';
      const weight = weights[agentType] ?? weights.core;
      totalWeight += weight;
      scores[output.bias] += weight * output.confidence;
    }

    const finalBias = (Object.keys(scores) as MetaDecision['finalBias'][]).reduce((best, key) =>
      scores[key] > scores[best] ? key : best
    );

    const finalConfidence = totalWeight > 0 ? scores[finalBias] / totalWeight : 0;
    const consensusStrength = totalWeight > 0 ? (scores[finalBias] / (totalWeight * 100)) * 100 : 0;

    return {
      finalBias,
      finalConfidence: Math.round(finalConfidence),
      contributingAgents: outputs.map((o) => o.agent),
      consensusStrength: Math.round(consensusStrength),
      decision: finalConfidence >= 50 ? 'approve' : 'reject',
      reasons: ['weighted_consensus'],
    };
  }

  async analyze(_signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput> {
    const outputs = (marketData as any).agentOutputs as AgentOutputWithType[] | undefined;
    if (!outputs || outputs.length === 0) {
      return this.buildOutput('neutral', 0, ['no_agent_outputs'], true);
    }

    const decision = this.aggregate(outputs);
    return this.buildOutput(decision.finalBias, decision.finalConfidence, decision.reasons, decision.decision === 'reject', {
      agentType: 'core',
    });
  }
}
