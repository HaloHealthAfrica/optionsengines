/**
 * Property-Based Tests: Strategy Router routing behavior
 * Property 21: Variant assignment determinism
 * Property 22: Master feature flag override
 * Property 23: Experiment metadata propagation
 * Validates: Requirements 8.2, 8.4, 8.6
 */

import fc from 'fast-check';

jest.mock('../../services/database.service.js', () => ({
  db: { query: jest.fn() },
}));

jest.mock('../../services/feature-flag.service.js', () => ({
  featureFlags: {
    isEnabled: jest.fn(),
  },
}));

import { StrategyRouter, computeDeterministicHash } from '../../services/strategy-router.service.js';
import { db } from '../../services/database.service.js';
import { featureFlags } from '../../services/feature-flag.service.js';
import { config } from '../../config/index.js';

describe('Strategy Router properties', () => {
  const symbolArb = fc.string({ minLength: 1, maxLength: 10 });
  const timeframeArb = fc.string({ minLength: 1, maxLength: 10 });
  const sessionArb = fc.string({ minLength: 1, maxLength: 20 });

  beforeEach(() => {
    (db.query as jest.Mock).mockReset();
    (featureFlags.isEnabled as jest.Mock).mockReset();
  });

  test('Property 21: Variant assignment determinism', async () => {
    const router = new StrategyRouter();
    (featureFlags.isEnabled as jest.Mock).mockReturnValue(true);
    config.abSplitPercentage = 50;

    (db.query as jest.Mock).mockImplementation(() =>
      Promise.resolve({ rows: [{ experiment_id: 'exp-1' }] })
    );

    await fc.assert(
      fc.asyncProperty(symbolArb, timeframeArb, sessionArb, async (symbol, timeframe, sessionId) => {
        const signal = { signalId: 's-1', symbol, timeframe, sessionId };
        const first = await router.route(signal);
        const second = await router.route(signal);
        expect(first.variant).toBe(second.variant);
        expect(first.assignmentHash).toBe(second.assignmentHash);
      }),
      { numRuns: 50 }
    );
  });

  test('Property 22: Master feature flag override routes to Variant A', async () => {
    const router = new StrategyRouter();
    (featureFlags.isEnabled as jest.Mock).mockReturnValue(false);
    config.abSplitPercentage = 50;

    (db.query as jest.Mock).mockImplementation(() =>
      Promise.resolve({ rows: [{ experiment_id: 'exp-1' }] })
    );

    await fc.assert(
      fc.asyncProperty(symbolArb, timeframeArb, sessionArb, async (symbol, timeframe, sessionId) => {
        const signal = { signalId: 's-1', symbol, timeframe, sessionId };
        const decision = await router.route(signal);
        expect(decision.variant).toBe('A');
        expect(decision.assignmentReason).toBe('variant_b_disabled');
      }),
      { numRuns: 50 }
    );
  });

  test('Property 23: Experiment metadata propagation', async () => {
    const router = new StrategyRouter();
    (featureFlags.isEnabled as jest.Mock).mockReturnValue(true);
    config.abSplitPercentage = 25;

    (db.query as jest.Mock).mockImplementation(() =>
      Promise.resolve({ rows: [{ experiment_id: 'exp-123' }] })
    );

    await fc.assert(
      fc.asyncProperty(symbolArb, timeframeArb, sessionArb, async (symbol, timeframe, sessionId) => {
        const signal = { signalId: 's-1', symbol, timeframe, sessionId };
        const decision = await router.route(signal);
        const expectedHash = computeDeterministicHash(symbol, timeframe, sessionId);

        expect(decision.experimentId).toBe('exp-123');
        expect(decision.assignmentHash).toBe(expectedHash);
        expect(decision.splitPercentage).toBe(25);

        expect(db.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO experiments'),
          [signal.signalId, decision.variant, expectedHash, 25]
        );
      }),
      { numRuns: 30 }
    );
  });
});
