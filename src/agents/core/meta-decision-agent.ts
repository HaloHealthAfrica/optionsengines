import { BaseAgent, AgentType } from '../base-agent.js';
import {
  AgentOutput,
  EnrichedSignal,
  MarketData,
  MetaDecision,
  RegimeContext,
} from '../../types/index.js';
import { getAgentWeights, getDefaultWeight } from '../../services/dynamic-weight.service.js';

const FALLBACK_WEIGHTS: Record<AgentType, number> = {
  specialist: 0.30,
  core: 0.45,
  subagent: 0.25,
};

const MIN_DIRECTIONAL_AGENTS = 3;
const MIN_CORE_AGENTS = 1;

const BASE_THRESHOLD = 50;

type AgentOutputWithType = AgentOutput & {
  metadata?: AgentOutput['metadata'] & { agentType?: AgentType };
};

interface ThresholdAdjustment {
  source: string;
  adjustment: number;
}

function computeDynamicThreshold(
  regime?: RegimeContext | null,
  correlation?: { directionalExposure?: number } | null,
  liquidity?: { liquidityScore?: number } | null,
  _hasBlockingAgent?: boolean
): { threshold: number; adjustments: ThresholdAdjustment[] } {
  let threshold = BASE_THRESHOLD;
  const adjustments: ThresholdAdjustment[] = [];

  if (regime) {
    if (regime.volatilityState === 'high') {
      threshold += 10;
      adjustments.push({ source: 'high_volatility', adjustment: 10 });
    } else if (regime.volatilityState === 'low' && regime.regime === 'compression') {
      threshold += 5;
      adjustments.push({ source: 'compression_requires_confirmation', adjustment: 5 });
    }

    if (regime.regime === 'transitional') {
      threshold += 5;
      adjustments.push({ source: 'transitional_regime', adjustment: 5 });
    }
  }

  if (correlation?.directionalExposure != null) {
    if (Math.abs(correlation.directionalExposure) > 0.5) {
      threshold += 5;
      adjustments.push({ source: 'elevated_correlation_exposure', adjustment: 5 });
    }
  }

  if (liquidity?.liquidityScore != null && liquidity.liquidityScore < 40) {
    threshold += 5;
    adjustments.push({ source: 'low_liquidity', adjustment: 5 });
  }

  return { threshold: Math.min(80, threshold), adjustments };
}

export class MetaDecisionAgent extends BaseAgent {
  constructor() {
    super('meta-decision', 'core');
  }

  async aggregateAsync(
    outputs: AgentOutputWithType[],
    marketData?: MarketData
  ): Promise<MetaDecision & { dynamicThreshold: number; thresholdAdjustments: ThresholdAdjustment[]; agentWeightsUsed: Record<string, number> }> {
    const riskBlocked = outputs.some((o) => o.block);
    const blockingAgents = outputs.filter((o) => o.block).map((o) => o.agent);

    if (riskBlocked) {
      return {
        finalBias: 'neutral',
        finalConfidence: 0,
        contributingAgents: outputs.map((o) => o.agent),
        consensusStrength: 0,
        decision: 'reject',
        reasons: blockingAgents.map((a) => `${a}_blocked`),
        dynamicThreshold: BASE_THRESHOLD,
        thresholdAdjustments: [],
        agentWeightsUsed: {},
      };
    }

    const directionalOutputs = outputs.filter((o) => o.bias !== 'neutral' && !o.block);

    const coreAgents = directionalOutputs.filter(
      (o) => (o.metadata?.agentType ?? 'core') === 'core'
    );
    if (directionalOutputs.length < MIN_DIRECTIONAL_AGENTS) {
      return {
        finalBias: 'neutral',
        finalConfidence: 0,
        contributingAgents: outputs.map((o) => o.agent),
        consensusStrength: 0,
        decision: 'reject',
        reasons: [`quorum_not_met_need_${MIN_DIRECTIONAL_AGENTS}_got_${directionalOutputs.length}`],
        dynamicThreshold: BASE_THRESHOLD,
        thresholdAdjustments: [],
        agentWeightsUsed: {},
      };
    }

    if (coreAgents.length < MIN_CORE_AGENTS) {
      return {
        finalBias: 'neutral',
        finalConfidence: 0,
        contributingAgents: outputs.map((o) => o.agent),
        consensusStrength: 0,
        decision: 'reject',
        reasons: ['no_core_agent_directional'],
        dynamicThreshold: BASE_THRESHOLD,
        thresholdAdjustments: [],
        agentWeightsUsed: {},
      };
    }

    let dynamicWeights: Map<string, { weight: number }>;
    try {
      dynamicWeights = await getAgentWeights();
    } catch {
      dynamicWeights = new Map();
    }

    const scores: Record<'bullish' | 'bearish', number> = { bullish: 0, bearish: 0 };
    const weightSums: Record<'bullish' | 'bearish', number> = { bullish: 0, bearish: 0 };
    const agentWeightsUsed: Record<string, number> = {};

    for (const output of directionalOutputs) {
      const agentName = output.agent;
      const agentType = output.metadata?.agentType ?? 'core';

      let weight: number;
      const dynW = dynamicWeights.get(agentName);
      if (dynW) {
        weight = dynW.weight;
      } else {
        weight = getDefaultWeight(agentName) || FALLBACK_WEIGHTS[agentType] || 0.10;
      }

      agentWeightsUsed[agentName] = weight;
      const bias = output.bias as 'bullish' | 'bearish';
      scores[bias] += weight * output.confidence;
      weightSums[bias] += weight;
    }

    const finalBias: MetaDecision['finalBias'] =
      scores.bullish >= scores.bearish ? 'bullish' : 'bearish';
    const oppositeBias = finalBias === 'bullish' ? 'bearish' : 'bullish';

    const finalConfidence =
      weightSums[finalBias] > 0 ? scores[finalBias] / weightSums[finalBias] : 0;

    const totalDirectionalScore = scores.bullish + scores.bearish;
    const consensusStrength =
      totalDirectionalScore > 0
        ? ((scores[finalBias] - scores[oppositeBias]) / totalDirectionalScore) * 100
        : 0;

    const { threshold: dynamicThreshold, adjustments: thresholdAdjustments } =
      computeDynamicThreshold(
        marketData?.regime,
        marketData?.correlation,
        marketData?.liquidity,
        riskBlocked
      );

    const decision: MetaDecision['decision'] =
      finalConfidence >= dynamicThreshold ? 'approve' : 'reject';

    const reasons: string[] = ['weighted_consensus'];
    if (decision === 'reject') {
      reasons.push(`confidence_${Math.round(finalConfidence)}_below_threshold_${dynamicThreshold}`);
    }
    if (thresholdAdjustments.length > 0) {
      reasons.push(`threshold_adjusted_by_${thresholdAdjustments.map((a) => a.source).join(',')}`);
    }

    return {
      finalBias,
      finalConfidence: Math.round(finalConfidence),
      contributingAgents: outputs.map((o) => o.agent),
      consensusStrength: Math.round(consensusStrength),
      decision,
      reasons,
      dynamicThreshold,
      thresholdAdjustments,
      agentWeightsUsed,
    };
  }

  aggregate(outputs: AgentOutputWithType[]): MetaDecision {
    const riskBlocked = outputs.some((o) => o.block);
    if (riskBlocked) {
      const blockingAgents = outputs.filter((o) => o.block).map((o) => o.agent);
      return {
        finalBias: 'neutral',
        finalConfidence: 0,
        contributingAgents: outputs.map((o) => o.agent),
        consensusStrength: 0,
        decision: 'reject',
        reasons: blockingAgents.map((a) => `${a}_blocked`),
      };
    }

    const directionalOutputs = outputs.filter((o) => o.bias !== 'neutral' && !o.block);

    if (directionalOutputs.length < MIN_DIRECTIONAL_AGENTS) {
      return {
        finalBias: 'neutral',
        finalConfidence: 0,
        contributingAgents: outputs.map((o) => o.agent),
        consensusStrength: 0,
        decision: 'reject',
        reasons: [`quorum_not_met_need_${MIN_DIRECTIONAL_AGENTS}_got_${directionalOutputs.length}`],
      };
    }

    const scores: Record<'bullish' | 'bearish', number> = { bullish: 0, bearish: 0 };
    const weightSums: Record<'bullish' | 'bearish', number> = { bullish: 0, bearish: 0 };

    for (const output of directionalOutputs) {
      const agentType = output.metadata?.agentType ?? 'core';
      const weight = getDefaultWeight(output.agent) || FALLBACK_WEIGHTS[agentType] || 0.10;
      const bias = output.bias as 'bullish' | 'bearish';
      scores[bias] += weight * output.confidence;
      weightSums[bias] += weight;
    }

    const finalBias: MetaDecision['finalBias'] =
      scores.bullish >= scores.bearish ? 'bullish' : 'bearish';
    const oppositeBias = finalBias === 'bullish' ? 'bearish' : 'bullish';

    const finalConfidence =
      weightSums[finalBias] > 0 ? scores[finalBias] / weightSums[finalBias] : 0;

    const totalDirectionalScore = scores.bullish + scores.bearish;
    const consensusStrength =
      totalDirectionalScore > 0
        ? ((scores[finalBias] - scores[oppositeBias]) / totalDirectionalScore) * 100
        : 0;

    return {
      finalBias,
      finalConfidence: Math.round(finalConfidence),
      contributingAgents: outputs.map((o) => o.agent),
      consensusStrength: Math.round(consensusStrength),
      decision: finalConfidence >= BASE_THRESHOLD ? 'approve' : 'reject',
      reasons: ['weighted_consensus'],
    };
  }

  async analyze(_signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput> {
    const outputs = (marketData as any).agentOutputs as AgentOutputWithType[] | undefined;
    if (!outputs || outputs.length === 0) {
      return this.buildOutput('neutral', 0, ['no_agent_outputs'], true);
    }

    const decision = this.aggregate(outputs);
    return this.buildOutput(
      decision.finalBias,
      decision.finalConfidence,
      decision.reasons,
      decision.decision === 'reject',
      { agentType: 'core' }
    );
  }
}
