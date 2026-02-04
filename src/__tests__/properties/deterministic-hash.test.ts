/**
 * Property-Based Test: Deterministic hash consistency
 * Property 20: Same inputs produce same hash
 * Validates: Requirements 8.1
 */

import fc from 'fast-check';
import { computeDeterministicHash } from '../../services/strategy-router.service.js';

describe('Property 20: Deterministic hash consistency', () => {
  const symbolArb = fc.string({ minLength: 1, maxLength: 10 });
  const timeframeArb = fc.string({ minLength: 1, maxLength: 10 });
  const sessionIdArb = fc.string({ minLength: 1, maxLength: 20 });

  test('Property: hash is deterministic for same inputs', async () => {
    await fc.assert(
      fc.asyncProperty(symbolArb, timeframeArb, sessionIdArb, async (symbol, timeframe, sessionId) => {
        const hash1 = computeDeterministicHash(symbol, timeframe, sessionId);
        const hash2 = computeDeterministicHash(symbol, timeframe, sessionId);
        expect(hash1).toBe(hash2);
      }),
      { numRuns: 100 }
    );
  });
});
