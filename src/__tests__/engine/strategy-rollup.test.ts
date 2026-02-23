jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../config/index', () => ({
  config: { logLevel: 'info', databaseUrl: '', dbPoolMax: 5, slowRequestMs: 1000 },
}));
jest.mock('../../engine/config/loader', () => ({
  getEngineConfig: () => ({}),
}));

const mockDbQuery = jest.fn();
jest.mock('../../services/database.service', () => ({
  db: { query: (...args: any[]) => mockDbQuery(...args) },
}));

import { StrategyRollupService } from '../../engine/dashboard/StrategyRollupService';

describe('StrategyRollupService', () => {
  let service: StrategyRollupService;

  beforeEach(() => {
    service = new StrategyRollupService();
    mockDbQuery.mockReset();
  });

  function makeRow(pnl: number, ivRegime: string = 'NEUTRAL', dte: number = 21, hour: number = 14) {
    const entryDate = new Date(`2026-02-10T${hour.toString().padStart(2, '0')}:30:00Z`);
    return {
      realized_pnl: pnl.toString(),
      iv_regime: ivRegime,
      dte_at_entry: dte.toString(),
      entry_date: entryDate.toISOString(),
      entry_price: '4.50',
      slippage_dollars: '2.50',
      holding_period_days: '5',
      max_adverse_excursion: '50.00',
    };
  }

  test('computes rollup with wins and losses', async () => {
    const rows = [
      makeRow(200, 'HIGH', 14, 10),
      makeRow(-100, 'HIGH', 14, 10),
      makeRow(150, 'NEUTRAL', 21, 14),
      makeRow(300, 'NEUTRAL', 7, 14),
      makeRow(-50, 'LOW', 28, 15),
    ];

    mockDbQuery.mockResolvedValueOnce({ rows }); // fetchAttributionRows
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // persistRollup

    const rollup = await service.computeRollup('acct-1', 'ORB', 'ALL');

    expect(rollup.sampleCount).toBe(5);
    expect(rollup.winRate).toBe(0.6);
    expect(rollup.totalPnl).toBe(500);
    expect(rollup.avgPnl).toBe(100);
    expect(rollup.profitFactor).toBeCloseTo(650 / 150, 2);
    expect(rollup.avgSlippage).toBe(2.50);
    expect(rollup.avgHoldingDays).toBe(5);
  });

  test('groups by regime correctly', async () => {
    const rows = [
      makeRow(200, 'HIGH'),
      makeRow(-100, 'HIGH'),
      makeRow(150, 'NEUTRAL'),
    ];

    mockDbQuery.mockResolvedValueOnce({ rows });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const rollup = await service.computeRollup('acct-1', 'SPREAD', 'ALL');

    expect(rollup.byRegime['HIGH']).toBeDefined();
    expect(rollup.byRegime['HIGH'].count).toBe(2);
    expect(rollup.byRegime['HIGH'].winRate).toBe(0.5);
    expect(rollup.byRegime['NEUTRAL']).toBeDefined();
    expect(rollup.byRegime['NEUTRAL'].count).toBe(1);
    expect(rollup.byRegime['NEUTRAL'].winRate).toBe(1.0);
  });

  test('groups by DTE bucket correctly', async () => {
    const rows = [
      makeRow(100, 'NEUTRAL', 5),
      makeRow(200, 'NEUTRAL', 12),
      makeRow(-50, 'NEUTRAL', 25),
    ];

    mockDbQuery.mockResolvedValueOnce({ rows });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const rollup = await service.computeRollup('acct-1', 'ORB', 'ALL');

    expect(rollup.byDteBucket['0-7']).toBeDefined();
    expect(rollup.byDteBucket['0-7'].count).toBe(1);
    expect(rollup.byDteBucket['8-14']).toBeDefined();
    expect(rollup.byDteBucket['8-14'].count).toBe(1);
    expect(rollup.byDteBucket['22-30']).toBeDefined();
    expect(rollup.byDteBucket['22-30'].count).toBe(1);
  });

  test('groups by hour correctly', async () => {
    const rows = [
      makeRow(100, 'NEUTRAL', 21, 10),
      makeRow(200, 'NEUTRAL', 21, 10),
      makeRow(-50, 'NEUTRAL', 21, 14),
    ];

    mockDbQuery.mockResolvedValueOnce({ rows });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const rollup = await service.computeRollup('acct-1', 'GEX', 'ALL');

    expect(rollup.byHour['10:00']).toBeDefined();
    expect(rollup.byHour['10:00'].count).toBe(2);
    expect(rollup.byHour['14:00']).toBeDefined();
    expect(rollup.byHour['14:00'].count).toBe(1);
  });

  test('returns empty rollup for zero trades', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const rollup = await service.computeRollup('acct-1', 'ORB', 'ALL');

    expect(rollup.sampleCount).toBe(0);
    expect(rollup.winRate).toBe(0);
    expect(rollup.totalPnl).toBe(0);
    expect(rollup.sharpe).toBe(0);
  });

  test('computes Sharpe correctly for consistent wins', async () => {
    const rows = Array.from({ length: 10 }, () => makeRow(100));

    mockDbQuery.mockResolvedValueOnce({ rows });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const rollup = await service.computeRollup('acct-1', 'ORB', 'ALL');

    // All same pnl => stdDev = 0 => Sharpe = 0
    expect(rollup.sharpe).toBe(0);
    expect(rollup.winRate).toBe(1.0);
  });

  test('computes max drawdown correctly', async () => {
    // Sequence: +100, +100, -200, -100, +50
    // cumPnl:   100, 200, 0, -100, -50
    // peak:     100, 200, 200, 200, 200
    // DD:       0,   0,   200, 300, 250
    // Max DD: 300 at point 4, pct = 300/200 = 1.5
    const rows = [
      makeRow(100), makeRow(100), makeRow(-200), makeRow(-100), makeRow(50),
    ];

    mockDbQuery.mockResolvedValueOnce({ rows });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const rollup = await service.computeRollup('acct-1', 'SPREAD', 'ALL');

    expect(rollup.maxDrawdown).toBe(300);
    expect(rollup.maxDrawdownPct).toBeCloseTo(1.5, 2);
  });

  test('computeAllRollups iterates over all strategies', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ strategy_tag: 'ORB' }, { strategy_tag: 'SPREAD' }] });
    // ORB
    mockDbQuery.mockResolvedValueOnce({ rows: [makeRow(100)] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    // SPREAD
    mockDbQuery.mockResolvedValueOnce({ rows: [makeRow(-50)] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const rollups = await service.computeAllRollups('acct-1', 'ALL');

    expect(rollups).toHaveLength(2);
    expect(rollups[0].strategyTag).toBe('ORB');
    expect(rollups[1].strategyTag).toBe('SPREAD');
  });

  test('profit factor is Infinity for all wins with no losses', async () => {
    const rows = [makeRow(100), makeRow(200)];

    mockDbQuery.mockResolvedValueOnce({ rows });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const rollup = await service.computeRollup('acct-1', 'ORB', 'ALL');

    expect(rollup.profitFactor).toBe(Infinity);
  });

  test('getLatest maps DB row correctly', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: 'r-1', account_id: 'acct-1', strategy_tag: 'ORB', period: 'ALL',
        computed_at: '2026-02-10T10:00:00Z', sample_count: '50', win_rate: '0.6000',
        avg_pnl: '120.50', total_pnl: '6025.00', avg_r_multiple: '0.0340',
        avg_slippage: '2.5000', sharpe: '1.4500', max_drawdown: '800.00',
        max_drawdown_pct: '0.12000', profit_factor: '2.1000', avg_holding_days: '4.50',
        by_regime: { HIGH: { count: 10, winRate: 0.7, avgPnl: 150, totalPnl: 1500 } },
        by_dte_bucket: { '15-21': { count: 30, winRate: 0.65, avgPnl: 100 } },
        by_hour: { '10:00': { count: 20, winRate: 0.6, avgPnl: 110 } },
      }],
    });

    const rollup = await service.getLatest('acct-1', 'ORB');

    expect(rollup).not.toBeNull();
    expect(rollup!.sampleCount).toBe(50);
    expect(rollup!.winRate).toBeCloseTo(0.6, 3);
    expect(rollup!.sharpe).toBeCloseTo(1.45, 2);
  });
});
