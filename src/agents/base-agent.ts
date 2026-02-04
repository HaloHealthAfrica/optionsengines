// Agent framework base types and validation
import { z } from 'zod';
import { AgentOutput, EnrichedSignal, MarketData } from '../types/index.js';

export type AgentType = 'core' | 'specialist' | 'subagent';

export interface Agent {
  name: string;
  type: AgentType;
  analyze(signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput>;
  shouldActivate(signal: EnrichedSignal, marketData: MarketData): boolean;
}

const agentOutputSchema = z.object({
  agent: z.string().min(1),
  bias: z.enum(['bullish', 'bearish', 'neutral']),
  confidence: z.number().min(0).max(100),
  reasons: z.array(z.string()),
  block: z.boolean(),
  metadata: z.record(z.any()).optional(),
});

export abstract class BaseAgent implements Agent {
  name: string;
  type: AgentType;

  constructor(name: string, type: AgentType) {
    this.name = name;
    this.type = type;
  }

  shouldActivate(_signal: EnrichedSignal, _marketData: MarketData): boolean {
    return true;
  }

  protected validateOutput(output: AgentOutput): AgentOutput {
    const parsed = agentOutputSchema.safeParse(output);
    if (!parsed.success) {
      const details = parsed.error.errors.map((err) => `${err.path.join('.')}: ${err.message}`);
      throw new Error(`Invalid agent output: ${details.join(', ')}`);
    }
    return parsed.data;
  }

  protected buildOutput(
    bias: AgentOutput['bias'],
    confidence: number,
    reasons: string[],
    block: boolean,
    metadata?: AgentOutput['metadata']
  ): AgentOutput {
    return this.validateOutput({
      agent: this.name,
      bias,
      confidence,
      reasons,
      block,
      metadata,
    });
  }

  abstract analyze(signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput>;
}
