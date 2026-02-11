/**
 * Property-Based Test: Signal processing replay
 * Property 36: Signal processing replay
 * Validates: Requirements 14.6
 */

import fc from 'fast-check';

jest.mock('../../services/database.service.js', () => ({
  db: { query: jest.fn() },
}));

import { eventLogger } from '../../services/event-logger.service.js';
import { db } from '../../services/database.service.js';

describe('Property 36: signal processing replay', () => {
  const biasArb = fc.constantFrom<'bullish' | 'bearish' | 'neutral'>('bullish', 'bearish', 'neutral');
  const confidenceArb = fc.integer({ min: 0, max: 100 });
  const reasonsArb = fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 });
  const agentTypeArb = fc.constantFrom<'core' | 'specialist' | 'subagent'>('core', 'specialist', 'subagent');

  afterEach(() => {
    (db.query as jest.Mock).mockReset();
  });

  test('replay returns same meta decision and outputs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            agent: fc.string({ minLength: 1, maxLength: 10 }),
            bias: biasArb,
            confidence: confidenceArb,
            reasons: reasonsArb,
            block: fc.boolean(),
            agentType: agentTypeArb,
          }),
          { minLength: 1, maxLength: 5 }
        ),
        biasArb,
        confidenceArb,
        reasonsArb,
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), { maxLength: 5 }),
        fc.integer({ min: 0, max: 100 }),
        fc.boolean(),
        async (outputs, finalBias, finalConfidence, metaReasons, contributingAgents, consensusStrength, metaBlock) => {
          const rows = [
            ...outputs.map((output) => ({
              agent_name: output.agent,
              agent_type: output.agentType,
              bias: output.bias,
              confidence: output.confidence,
              reasons: output.reasons,
              block: output.block,
              metadata: { agentType: output.agentType },
            })),
            {
              agent_name: 'meta_decision',
              agent_type: 'core',
              bias: finalBias,
              confidence: finalConfidence,
              reasons: metaReasons,
              block: metaBlock,
              metadata: {
                contributingAgents,
                consensusStrength,
              },
            },
          ];

          (db.query as jest.Mock).mockResolvedValue({ rows });

          const replay = await eventLogger.replayDecision('exp-1', 'sig-1');

          expect(replay.outputs).toHaveLength(outputs.length);
          expect(replay.metaDecision).not.toBeNull();
          expect(replay.metaDecision?.finalBias).toBe(finalBias);
          expect(replay.metaDecision?.finalConfidence).toBe(finalConfidence);
          expect(replay.metaDecision?.reasons).toEqual(metaReasons);
          expect(replay.metaDecision?.contributingAgents).toEqual(contributingAgents);
          expect(replay.metaDecision?.consensusStrength).toBe(consensusStrength);
          expect(replay.metaDecision?.decision).toBe(metaBlock ? 'reject' : 'approve');
        }
      ),
      { numRuns: 20 }
    );
  });
});
