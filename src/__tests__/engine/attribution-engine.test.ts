import { IVRegime, TermShape } from '../../engine/types/enums';

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../config/index', () => ({
  config: { logLevel: 'info', databaseUrl: '', dbPoolMax: 5, slowRequestMs: 1000 },
}));
jest.mock('../../engine/config/loader', () => ({
  getEngineConfig: () => ({ metaLearner: { minSampleCount: 50 } }),
}));

const mockDbQuery = jest.fn();
jest.mock('../../services/database.service', () => ({
  db: { query: (...args: any[]) => mockDbQuery(...args) },
}));

import { AttributionEngine } from '../../engine/attribution/AttributionEngine';

describe('AttributionEngine', () => {
  let engine: AttributionEngine;

  beforeEach(() => {
    engine = new AttributionEngine();
    mockDbQuery.mockReset();
  });

  describe('recordAttribution', () => {
    test('records attribution row and computes holding period', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // insert

      const entryDate = new Date('2026-02-01');
      const exitDate = new Date('2026-02-15');

      const result = await engine.recordAttribution({
        accountId: 'acct-1',
        positionId: 'pos-1',
        strategyTag: 'ORB',
        underlying: 'SPY',
        structure: 'LONG_CALL',
        ivRegime: IVRegime.NEUTRAL,
        termShape: TermShape.CONTANGO,
        entryDate,
        exitDate,
        dteAtEntry: 21,
        deltaAtEntry: 0.45,
        contracts: 2,
        entryPrice: 4.60,
        exitPrice: 6.80,
        realizedPnl: 440,
        maxFavorableExcursion: 550,
        maxAdverseExcursion: -120,
        slippageDollars: 0.05,
        liquidityScoreAtEntry: 0.70,
        regimeTag: 'NEUTRAL:CONTANGO',
      });

      expect(result.holdingPeriodDays).toBe(14);
      expect(result.realizedPnl).toBe(440);
      expect(result.strategyTag).toBe('ORB');
      expect(mockDbQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('getStrategyPerformance', () => {
    test('returns empty performance for no data', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const perf = await engine.getStrategyPerformance('acct-1', 'ORB');

      expect(perf.sampleCount).toBe(0);
      expect(perf.winRate).toBe(0);
      expect(perf.edgeScore).toBe(0);
    });

    test('computes correct performance metrics', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          { realized_pnl: '200', holding_period_days: '10', slippage_dollars: '0.05', iv_regime: 'NEUTRAL' },
          { realized_pnl: '-100', holding_period_days: '5', slippage_dollars: '0.10', iv_regime: 'NEUTRAL' },
          { realized_pnl: '150', holding_period_days: '8', slippage_dollars: '0.03', iv_regime: 'HIGH' },
          { realized_pnl: '50', holding_period_days: '12', slippage_dollars: '0.04', iv_regime: 'NEUTRAL' },
        ],
      });

      const perf = await engine.getStrategyPerformance('acct-1', 'ORB');

      expect(perf.sampleCount).toBe(4);
      expect(perf.winRate).toBe(0.75); // 3/4
      expect(perf.totalPnl).toBe(300); // 200 - 100 + 150 + 50
      expect(perf.avgPnl).toBe(75); // 300/4
      expect(perf.avgHoldingDays).toBeCloseTo(8.75, 1);
      expect(perf.profitFactor).toBe(4.0); // 400/100
      expect(perf.byRegime.size).toBe(2);
    });

    test('handles all losses', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          { realized_pnl: '-100', holding_period_days: '5', slippage_dollars: '0.10', iv_regime: 'LOW' },
          { realized_pnl: '-200', holding_period_days: '3', slippage_dollars: '0.15', iv_regime: 'LOW' },
        ],
      });

      const perf = await engine.getStrategyPerformance('acct-1', 'BAD');

      expect(perf.winRate).toBe(0);
      expect(perf.profitFactor).toBe(0);
      expect(perf.totalPnl).toBe(-300);
    });
  });

  describe('detectEdgeDecay', () => {
    test('returns not decaying when insufficient samples', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // getStrategyPerformance

      const result = await engine.detectEdgeDecay('acct-1', 'ORB', 20, 0.10);

      expect(result.decaying).toBe(false);
    });

    test('detects decay when recent win rate drops', async () => {
      // Overall: 60 trades, 40 wins = 66.7% WR
      const allRows = Array.from({ length: 60 }, (_, i) => ({
        realized_pnl: String(i < 40 ? 100 : -50),
        holding_period_days: '10',
        slippage_dollars: '0.05',
        iv_regime: 'NEUTRAL',
      }));

      mockDbQuery
        .mockResolvedValueOnce({ rows: allRows }) // getStrategyPerformance
        .mockResolvedValueOnce({
          // Recent 20: only 8 wins = 40% WR (delta = 0.267 > 0.10)
          rows: Array.from({ length: 20 }, (_, i) => ({
            realized_pnl: String(i < 8 ? 100 : -50),
          })),
        });

      const result = await engine.detectEdgeDecay('acct-1', 'ORB', 20, 0.10);

      expect(result.decaying).toBe(true);
      expect(result.recentWinRate).toBe(0.40);
      expect(result.delta).toBeGreaterThan(0.10);
    });
  });

  describe('computeEdgeScore', () => {
    test('returns high score for strong strategy', () => {
      const score = engine.computeEdgeScore(0.70, 150, 100, 2.5);
      expect(score).toBeGreaterThan(0.5);
      expect(score).toBeLessThanOrEqual(1);
    });

    test('returns low score for weak strategy', () => {
      const score = engine.computeEdgeScore(0.30, -50, 20, 0.5);
      expect(score).toBeLessThan(0.3);
    });

    test('clamps to 0-1 range', () => {
      expect(engine.computeEdgeScore(1, 1000, 500, 10)).toBeLessThanOrEqual(1);
      expect(engine.computeEdgeScore(0, -1000, 0, 0)).toBeGreaterThanOrEqual(0);
    });
  });
});
