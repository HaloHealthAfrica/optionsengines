/**
 * Integration Test: Feature flag override behavior
 * Validates: Requirements 13.1 through 13.6
 */

jest.mock('../../services/database.service.js', () => ({
  db: { query: jest.fn() },
}));

jest.mock('../../services/feature-flag.service.js', () => ({
  featureFlags: {
    isEnabled: jest.fn(),
  },
}));

import { strategyRouter } from '../../services/strategy-router.service.js';
import { db } from '../../services/database.service.js';
import { featureFlags } from '../../services/feature-flag.service.js';

describe('Integration: Feature flag override', () => {
  beforeEach(() => {
    (db.query as jest.Mock).mockReset();
    (featureFlags.isEnabled as jest.Mock).mockReset();
  });

  test('returns Variant A when enable_variant_b is false', async () => {
    (featureFlags.isEnabled as jest.Mock).mockReturnValue(false);
    (db.query as jest.Mock).mockResolvedValue({ rows: [{ experiment_id: 'exp-1' }] });

    const decision = await strategyRouter.route({
      signalId: 'sig-1',
      symbol: 'SPY',
      timeframe: '5m',
      sessionId: 'session-1',
    });

    expect(decision.variant).toBe('A');
  });
});
