/**
 * Property-Based Tests: Event logger
 * Property 35: Log immutability (append-only inserts)
 * Property 37: Event logging completeness
 */

import fc from 'fast-check';

jest.mock('../../services/database.service.js', () => ({
  db: { query: jest.fn() },
}));

import { eventLogger } from '../../services/event-logger.service.js';
import { db } from '../../services/database.service.js';

describe('Event Logger properties', () => {
  const biasArb = fc.constantFrom<'bullish' | 'bearish' | 'neutral'>('bullish', 'bearish', 'neutral');

  test('Property 35: logger only inserts', async () => {
    await fc.assert(
      fc.asyncProperty(biasArb, async (bias) => {
        const queries: string[] = [];
        (db.query as jest.Mock).mockImplementation(async (text: string) => {
          queries.push(text);
          return { rows: [] };
        });

        await eventLogger.logDecision({
          experimentId: 'exp-1',
          signalId: 'sig-1',
          outputs: [
            { agent: 'technical', bias, confidence: 50, reasons: ['x'], block: false, metadata: { agentType: 'core' } },
          ],
          metaDecision: {
            finalBias: bias,
            finalConfidence: 50,
            contributingAgents: ['technical'],
            consensusStrength: 50,
            decision: 'approve',
            reasons: ['ok'],
          },
        });

        expect(queries.every((q) => q.includes('INSERT INTO agent_decisions'))).toBe(true);
      }),
      { numRuns: 20 }
    );
  });

  test('Property 37: event logging completeness', async () => {
    await fc.assert(
      fc.asyncProperty(biasArb, async (bias) => {
        let callCount = 0;
        (db.query as jest.Mock).mockImplementation(async () => {
          callCount += 1;
          return { rows: [] };
        });

        await eventLogger.logDecision({
          experimentId: 'exp-1',
          signalId: 'sig-1',
          outputs: [
            { agent: 'technical', bias, confidence: 50, reasons: ['x'], block: false, metadata: { agentType: 'core' } },
            { agent: 'risk', bias: 'neutral', confidence: 0, reasons: ['risk'], block: true, metadata: { agentType: 'core' } },
          ],
          metaDecision: {
            finalBias: bias,
            finalConfidence: 50,
            contributingAgents: ['technical', 'risk'],
            consensusStrength: 50,
            decision: 'approve',
            reasons: ['ok'],
          },
        });

        expect(callCount).toBe(3);
      }),
      { numRuns: 20 }
    );
  });
});
