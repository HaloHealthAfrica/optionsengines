import { MetaDecisionAgent } from '../../agents/core/meta-decision-agent.js';
import type { AgentOutput } from '../../types/index.js';

jest.mock('../../services/dynamic-weight.service.js', () => ({
  getAgentWeights: jest.fn().mockResolvedValue(new Map()),
  getDefaultWeight: jest.fn().mockReturnValue(0.15),
}));

type AgentOutputWithType = AgentOutput & {
  metadata?: AgentOutput['metadata'] & { agentType?: 'core' | 'specialist' | 'subagent' };
};

function makeOutput(opts: Partial<AgentOutputWithType> & { agent: string }): AgentOutputWithType {
  return {
    bias: 'neutral',
    confidence: 50,
    reasons: [],
    block: false,
    metadata: { agentType: 'core' },
    ...opts,
  };
}

describe('MetaDecisionAgent', () => {
  const agent = new MetaDecisionAgent();

  it('rejects when risk agent blocks', () => {
    const outputs: AgentOutputWithType[] = [
      makeOutput({ agent: 'risk', block: true }),
      makeOutput({ agent: 'technical', bias: 'bullish', confidence: 80 }),
      makeOutput({ agent: 'context', bias: 'bullish', confidence: 70 }),
      makeOutput({ agent: 'regime_classifier', bias: 'bullish', confidence: 60 }),
    ];
    const result = agent.aggregate(outputs);
    expect(result.decision).toBe('reject');
    expect(result.reasons).toContain('risk_blocked');
  });

  it('rejects when quorum not met (< 3 directional)', () => {
    const outputs: AgentOutputWithType[] = [
      makeOutput({ agent: 'technical', bias: 'bullish', confidence: 80 }),
      makeOutput({ agent: 'context', bias: 'bullish', confidence: 70 }),
    ];
    const result = agent.aggregate(outputs);
    expect(result.decision).toBe('reject');
    expect(result.reasons[0]).toContain('quorum_not_met');
  });

  it('approves with sufficient directional consensus', () => {
    const outputs: AgentOutputWithType[] = [
      makeOutput({ agent: 'technical', bias: 'bullish', confidence: 80, metadata: { agentType: 'core' } }),
      makeOutput({ agent: 'context', bias: 'bullish', confidence: 70, metadata: { agentType: 'core' } }),
      makeOutput({ agent: 'regime_classifier', bias: 'bullish', confidence: 65, metadata: { agentType: 'core' } }),
      makeOutput({ agent: 'gamma_flow', bias: 'bullish', confidence: 60, metadata: { agentType: 'specialist' } }),
    ];
    const result = agent.aggregate(outputs);
    expect(result.decision).toBe('approve');
    expect(result.finalBias).toBe('bullish');
    expect(result.finalConfidence).toBeGreaterThan(50);
  });

  it('rejects when agents disagree and confidence is low', () => {
    const outputs: AgentOutputWithType[] = [
      makeOutput({ agent: 'technical', bias: 'bullish', confidence: 40, metadata: { agentType: 'core' } }),
      makeOutput({ agent: 'context', bias: 'bearish', confidence: 45, metadata: { agentType: 'core' } }),
      makeOutput({ agent: 'regime_classifier', bias: 'bullish', confidence: 35, metadata: { agentType: 'core' } }),
      makeOutput({ agent: 'gamma_flow', bias: 'bearish', confidence: 50, metadata: { agentType: 'specialist' } }),
    ];
    const result = agent.aggregate(outputs);
    expect(result.consensusStrength).toBeLessThan(50);
  });

  it('async aggregate respects dynamic threshold for high volatility', async () => {
    const outputs: AgentOutputWithType[] = [
      makeOutput({ agent: 'technical', bias: 'bullish', confidence: 55, metadata: { agentType: 'core' } }),
      makeOutput({ agent: 'context', bias: 'bullish', confidence: 55, metadata: { agentType: 'core' } }),
      makeOutput({ agent: 'regime_classifier', bias: 'bullish', confidence: 55, metadata: { agentType: 'core' } }),
    ];
    const marketData = {
      regime: { regime: 'expansion' as const, volatilityState: 'high' as const, trendStrength: 35, confidence: 70 },
    } as any;

    const result = await agent.aggregateAsync(outputs, marketData);
    expect(result.dynamicThreshold).toBeGreaterThan(50);
    expect(result.thresholdAdjustments.length).toBeGreaterThan(0);
  });

  it('handles liquidity agent blocking', () => {
    const outputs: AgentOutputWithType[] = [
      makeOutput({ agent: 'technical', bias: 'bullish', confidence: 80, metadata: { agentType: 'core' } }),
      makeOutput({ agent: 'context', bias: 'bullish', confidence: 70, metadata: { agentType: 'core' } }),
      makeOutput({ agent: 'regime_classifier', bias: 'bullish', confidence: 60, metadata: { agentType: 'core' } }),
      makeOutput({ agent: 'liquidity', bias: 'neutral', confidence: 10, block: true, metadata: { agentType: 'core' } }),
    ];
    const result = agent.aggregate(outputs);
    expect(result.decision).toBe('reject');
  });
});
