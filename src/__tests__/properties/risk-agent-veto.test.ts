/**
 * Property-Based Test: Risk Agent absolute veto
 * Property 26: Meta-decision rejects when risk agent blocks
 * Validates: Requirements 9.5
 */

import fc from 'fast-check';
import { MetaDecisionAgent } from '../../agents/core/meta-decision-agent.js';

describe('Property 26: Risk Agent absolute veto', () => {
  test('Property: any risk block forces rejection', async () => {
    const agent = new MetaDecisionAgent();

    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (block) => {
        const outputs = [
          { agent: 'technical', bias: 'bullish', confidence: 80, reasons: ['x'], block: false, metadata: { agentType: 'core' } },
          { agent: 'risk', bias: 'neutral', confidence: 0, reasons: ['risk'], block, metadata: { agentType: 'core' } },
        ];

        const decision = agent.aggregate(outputs as any);
        if (block) {
          expect(decision.decision).toBe('reject');
          expect(decision.reasons).toContain('risk_agent_blocked');
        } else {
          expect(decision.decision).toBeDefined();
        }
      }),
      { numRuns: 50 }
    );
  });
});
