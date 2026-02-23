jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../config/index', () => ({
  config: { logLevel: 'info', databaseUrl: '', dbPoolMax: 5, slowRequestMs: 1000 },
}));

const mockDbQuery = jest.fn();
jest.mock('../../services/database.service', () => ({
  db: { query: (...args: any[]) => mockDbQuery(...args) },
}));

jest.mock('../../engine/config/loader', () => ({
  getEngineConfig: () => ({}),
}));

import { DashboardQueryService } from '../../engine/dashboard/DashboardQueryService';

describe('DashboardQueryService', () => {
  let service: DashboardQueryService;

  beforeEach(() => {
    service = new DashboardQueryService();
    mockDbQuery.mockReset();
  });

  describe('getAccountSummary', () => {
    test('returns account details with drawdown', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          total_equity: '95000',
          current_cash: '80000',
          reserved_capital: '15000',
          realized_pnl: '-5000',
          unrealized_pnl: '0',
          peak_equity: '100000',
          entry_frozen: false,
        }],
      });

      const summary = await service.getAccountSummary('acct-1');

      expect(summary.totalEquity).toBe(95000);
      expect(summary.drawdownPct).toBeCloseTo(0.05); // (100k - 95k) / 100k
      expect(summary.entryFrozen).toBe(false);
    });

    test('returns defaults for missing account', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const summary = await service.getAccountSummary('missing');

      expect(summary.totalEquity).toBe(0);
      expect(summary.entryFrozen).toBe(true);
    });
  });

  describe('getOpenPositions', () => {
    test('maps open positions', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          position_id: 'pos-1',
          underlying: 'SPY',
          structure: 'LONG_CALL',
          strategy_tag: 'ORB',
          state: 'OPEN',
          target_qty: '2',
          entry_avg_price: '4.60',
          unrealized_pnl: '200',
          realized_pnl: null,
          opened_at: '2026-02-10T14:00:00Z',
          closed_at: null,
        }],
      });

      const positions = await service.getOpenPositions('acct-1');

      expect(positions).toHaveLength(1);
      expect(positions[0].underlying).toBe('SPY');
      expect(positions[0].contracts).toBe(2);
      expect(positions[0].unrealizedPnl).toBe(200);
      expect(positions[0].daysOpen).toBeGreaterThan(0);
    });
  });

  describe('getPnlSummary', () => {
    test('computes P&L aggregates', async () => {
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{
            total_realized: '1500',
            win_count: '7',
            loss_count: '3',
            avg_win: '300',
            avg_loss: '-150',
            best_trade: '600',
            worst_trade: '-200',
            gross_profit: '2100',
            gross_loss: '450',
          }],
        })
        .mockResolvedValueOnce({
          rows: [{ total_unrealized: '350' }],
        });

      const pnl = await service.getPnlSummary('acct-1');

      expect(pnl.totalRealizedPnl).toBe(1500);
      expect(pnl.totalUnrealizedPnl).toBe(350);
      expect(pnl.totalPnl).toBe(1850);
      expect(pnl.winRate).toBeCloseTo(0.70);
      expect(pnl.profitFactor).toBeCloseTo(4.667, 1);
      expect(pnl.bestTrade).toBe(600);
      expect(pnl.worstTrade).toBe(-200);
    });

    test('handles zero trades', async () => {
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{
            total_realized: '0', win_count: '0', loss_count: '0',
            avg_win: '0', avg_loss: '0', best_trade: '0', worst_trade: '0',
            gross_profit: '0', gross_loss: '0',
          }],
        })
        .mockResolvedValueOnce({
          rows: [{ total_unrealized: '0' }],
        });

      const pnl = await service.getPnlSummary('acct-1');

      expect(pnl.winRate).toBe(0);
      expect(pnl.profitFactor).toBe(0);
    });
  });

  describe('getActiveRegimes', () => {
    test('returns latest regime per underlying', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          { underlying: 'SPY', iv_regime: 'NEUTRAL', term_shape: 'CONTANGO', iv_percentile: '0.55', confidence: '0.90', computed_at: '2026-02-20T16:00:00Z' },
          { underlying: 'QQQ', iv_regime: 'HIGH', term_shape: 'BACKWARDATION', iv_percentile: '0.78', confidence: '0.85', computed_at: '2026-02-20T16:00:00Z' },
        ],
      });

      const regimes = await service.getActiveRegimes('acct-1');

      expect(regimes).toHaveLength(2);
      expect(regimes[0].underlying).toBe('SPY');
      expect(regimes[0].ivRegime).toBe('NEUTRAL');
      expect(regimes[1].ivPercentile).toBe(0.78);
    });
  });

  describe('getRecentTraces', () => {
    test('maps trace snapshots', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          decision_trace_id: 'dt-1',
          signal_id: 'sig-1',
          is_replay: false,
          trade_intent_snapshot: { underlying: 'SPY', strategyTag: 'ORB' },
          governor_result: { decision: 'APPROVE' },
          pnl_outcome: '150',
          created_at: '2026-02-20T14:00:00Z',
        }],
      });

      const traces = await service.getRecentTraces('acct-1', 5);

      expect(traces).toHaveLength(1);
      expect(traces[0].underlying).toBe('SPY');
      expect(traces[0].strategyTag).toBe('ORB');
      expect(traces[0].finalDecision).toBe('APPROVE');
      expect(traces[0].pnlOutcome).toBe(150);
    });
  });

  describe('getStrategyDashboard', () => {
    test('aggregates strategy data', async () => {
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{ weight: '0.85', edge_score: '0.72', cooldown_remaining: '3' }],
        })
        .mockResolvedValueOnce({
          rows: [{ trade_count: '40', avg_pnl: '75.50', total_pnl: '3020', wins: '28' }],
        })
        .mockResolvedValueOnce({
          rows: [
            { position_id: 'pos-1', underlying: 'SPY', realized_pnl: '200', exit_date: '2026-02-18T15:00:00Z' },
            { position_id: 'pos-2', underlying: 'QQQ', realized_pnl: '-80', exit_date: '2026-02-17T15:00:00Z' },
          ],
        });

      const dashboard = await service.getStrategyDashboard('acct-1', 'ORB');

      expect(dashboard.strategyTag).toBe('ORB');
      expect(dashboard.weight).toBe(0.85);
      expect(dashboard.tradeCount).toBe(40);
      expect(dashboard.winRate).toBe(0.70);
      expect(dashboard.edgeScore).toBe(0.72);
      expect(dashboard.cooldownRemaining).toBe(3);
      expect(dashboard.recentTrades).toHaveLength(2);
    });

    test('returns defaults when no weight exists', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [] }) // no weight
        .mockResolvedValueOnce({ rows: [{ trade_count: '0', avg_pnl: '0', total_pnl: '0', wins: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const dashboard = await service.getStrategyDashboard('acct-1', 'NEW');

      expect(dashboard.weight).toBe(1.0);
      expect(dashboard.edgeScore).toBeNull();
      expect(dashboard.tradeCount).toBe(0);
    });
  });

  describe('getClosedPositions', () => {
    test('queries closed positions with date range', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          position_id: 'pos-1',
          underlying: 'SPY',
          structure: 'CREDIT_PUT_SPREAD',
          strategy_tag: 'SPREAD',
          state: 'CLOSED',
          target_qty: '5',
          entry_avg_price: '1.20',
          unrealized_pnl: '0',
          realized_pnl: '400',
          opened_at: '2026-02-01T14:00:00Z',
          closed_at: '2026-02-15T15:00:00Z',
        }],
      });

      const positions = await service.getClosedPositions(
        'acct-1',
        new Date('2026-02-01'),
        new Date('2026-02-28'),
        20
      );

      expect(positions).toHaveLength(1);
      expect(positions[0].state).toBe('CLOSED');
      expect(positions[0].realizedPnl).toBe(400);
      expect(positions[0].daysOpen).toBe(14);
    });
  });
});
