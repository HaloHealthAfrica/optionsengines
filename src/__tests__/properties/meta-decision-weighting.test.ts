/**
 * Property-Based Test: Meta-decision weighting hierarchy
 * Property 30: Specialist > Core > Sub-agent weighting
 * Validates: Requirements 11.5
 */

import fc from 'fast-check';
import { MetaDecisionAgent } from '../../agents/core/meta-decision-agent.js';

describe('Property 30: Meta-decision weighting hierarchy', () => {
  test('Property: specialist signal dominates with higher weight', async () => {
    const agent = new MetaDecisionAgent();

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 60, max: 100 }),
        fc.integer({ min: 0, max: 40 }),
        async (specialistConfidence, coreConfidence) => {
          const outputs = [
            {
              agent: 'orb_specialist',
              bias: 'bullish',
              confidence: specialistConfidence,
              reasons: ['orb'],
              block: false,
              metadata: { agentType: 'specialist' },
            },
            {
              agent: 'technical',
              bias: 'bearish',
              confidence: coreConfidence,
              reasons: ['ema'],
              block: false,
              metadata: { agentType: 'core' },
            },
            {
              agent: 'satyland',
              bias: 'bearish',
              confidence: coreConfidence,
              reasons: ['confirm'],
              block: false,
              metadata: { agentType: 'subagent' },
            },
          ];

          const decision = agent.aggregate(outputs as any);
          expect(decision.finalBias).toBe('bullish');
        }
      ),
      { numRuns: 50 }
    );
  });
});
