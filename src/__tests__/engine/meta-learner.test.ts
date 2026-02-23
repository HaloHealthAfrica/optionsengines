jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../config/index', () => ({
  config: { logLevel: 'info', databaseUrl: '', dbPoolMax: 5, slowRequestMs: 1000 },
}));

const mockGetEngineConfig = jest.fn();
jest.mock('../../engine/config/loader', () => ({
  getEngineConfig: () => mockGetEngineConfig(),
}));

const mockDbQuery = jest.fn();
jest.mock('../../services/database.service', () => ({
  db: { query: (...args: any[]) => mockDbQuery(...args) },
}));

import { MetaLearner } from '../../engine/attribution/MetaLearner';

describe('MetaLearner', () => {
  let learner: MetaLearner;

  const defaultConfig = {
    metaLearner: {
      minSampleCount: 50,
      degradationThreshold: 0.10,
      adjustmentFactor: 0.80,
      cooldownTrades: 10,
      weightFloor: 0.50,
      weightCeiling: 1.50,
    },
  };

  beforeEach(() => {
    learner = new MetaLearner();
    mockGetEngineConfig.mockReturnValue(defaultConfig);
    mockDbQuery.mockReset();
  });

  describe('getWeight', () => {
    test('returns 1.0 when no weight record exists', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const weight = await learner.getWeight('acct-1', 'ORB');
      expect(weight).toBe(1.0);
    });

    test('returns stored weight', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{ weight: '0.80', cooldown_remaining: '0' }],
      });
      const weight = await learner.getWeight('acct-1', 'ORB');
      expect(weight).toBe(0.80);
    });
  });

  describe('getAllWeights', () => {
    test('returns all strategy weights for account', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          { id: 'w1', account_id: 'acct-1', strategy_tag: 'ORB', weight: '1.00', sample_count: '60', win_rate: '0.65', avg_pnl: '80', edge_score: '0.70', last_updated: new Date().toISOString(), cooldown_remaining: '0' },
          { id: 'w2', account_id: 'acct-1', strategy_tag: 'GEX', weight: '0.80', sample_count: '55', win_rate: '0.55', avg_pnl: '40', edge_score: '0.50', last_updated: new Date().toISOString(), cooldown_remaining: '5' },
        ],
      });

      const weights = await learner.getAllWeights('acct-1');
      expect(weights).toHaveLength(2);
      expect(weights[0].strategyTag).toBe('ORB');
      expect(weights[1].weight).toBe(0.80);
      expect(weights[1].cooldownRemaining).toBe(5);
    });
  });

  describe('runLearningCycle', () => {
    test('returns empty adjustments when no strategies', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // distinct strategies

      const adjustments = await learner.runLearningCycle('acct-1');
      expect(adjustments).toHaveLength(0);
    });

    test('skips strategies with insufficient samples', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ strategy_tag: 'ORB' }] }) // distinct strategies
        .mockResolvedValueOnce({ rows: Array.from({ length: 20 }, () => ({ realized_pnl: '100', holding_period_days: '10', slippage_dollars: '0.05', iv_regime: 'NEUTRAL' })) }) // performance (only 20 < 50 min)
        ;

      const adjustments = await learner.runLearningCycle('acct-1');
      expect(adjustments).toHaveLength(0);
    });

    test('reduces weight on edge decay', async () => {
      // 60 trades, overall WR ~66%, recent 20 only 40% → decay
      const allRows = Array.from({ length: 60 }, (_, i) => ({
        realized_pnl: String(i < 40 ? 100 : -50),
        holding_period_days: '10',
        slippage_dollars: '0.05',
        iv_regime: 'NEUTRAL',
      }));

      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ strategy_tag: 'ORB' }] }) // distinct strategies
        .mockResolvedValueOnce({ rows: allRows }) // getStrategyPerformance
        .mockResolvedValueOnce({ rows: [{ weight: '1.00', cooldown_remaining: '0' }] }) // getWeight
        .mockResolvedValueOnce({ rows: [{ cooldown_remaining: '0' }] }) // getCooldownRemaining
        .mockResolvedValueOnce({ rows: allRows }) // detectEdgeDecay → getStrategyPerformance
        .mockResolvedValueOnce({
          rows: Array.from({ length: 20 }, (_, i) => ({
            realized_pnl: String(i < 8 ? 100 : -50),
          })),
        }) // detectEdgeDecay → recent
        .mockResolvedValueOnce({ rows: [] }) // upsertWeight
        .mockResolvedValueOnce({ rows: [] }); // logWeightChange

      const adjustments = await learner.runLearningCycle('acct-1');

      expect(adjustments).toHaveLength(1);
      expect(adjustments[0].strategyTag).toBe('ORB');
      expect(adjustments[0].fromWeight).toBe(1.00);
      expect(adjustments[0].toWeight).toBe(0.80); // 1.0 * 0.80 adjustmentFactor
      expect(adjustments[0].reason).toContain('Edge decay');
    });

    test('respects weight floor', async () => {
      // Strategy already at floor, decay detected → stays at floor
      const allRows = Array.from({ length: 60 }, (_, i) => ({
        realized_pnl: String(i < 40 ? 100 : -50),
        holding_period_days: '10',
        slippage_dollars: '0.05',
        iv_regime: 'NEUTRAL',
      }));

      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ strategy_tag: 'ORB' }] })
        .mockResolvedValueOnce({ rows: allRows })
        .mockResolvedValueOnce({ rows: [{ weight: '0.50', cooldown_remaining: '0' }] }) // already at floor
        .mockResolvedValueOnce({ rows: [{ cooldown_remaining: '0' }] })
        .mockResolvedValueOnce({ rows: allRows })
        .mockResolvedValueOnce({
          rows: Array.from({ length: 20 }, (_, i) => ({
            realized_pnl: String(i < 8 ? 100 : -50),
          })),
        });

      const adjustments = await learner.runLearningCycle('acct-1');

      // 0.50 * 0.80 = 0.40 → clamped to floor 0.50 → no change (< 0.01 diff)
      expect(adjustments).toHaveLength(0);
    });

    test('skips when in cooldown', async () => {
      const allRows = Array.from({ length: 60 }, (_, i) => ({
        realized_pnl: String(i < 40 ? 100 : -50),
        holding_period_days: '10',
        slippage_dollars: '0.05',
        iv_regime: 'NEUTRAL',
      }));

      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ strategy_tag: 'ORB' }] })
        .mockResolvedValueOnce({ rows: allRows })
        .mockResolvedValueOnce({ rows: [{ weight: '0.80', cooldown_remaining: '0' }] })
        .mockResolvedValueOnce({ rows: [{ cooldown_remaining: '5' }] }) // in cooldown
        .mockResolvedValueOnce({ rows: [] }); // decrementCooldown

      const adjustments = await learner.runLearningCycle('acct-1');
      expect(adjustments).toHaveLength(0);
    });
  });
});
