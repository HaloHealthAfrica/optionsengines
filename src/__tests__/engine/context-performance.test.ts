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

import { ContextPerformanceService } from '../../engine/dashboard/ContextPerformanceService';

describe('ContextPerformanceService', () => {
  let service: ContextPerformanceService;

  beforeEach(() => {
    service = new ContextPerformanceService();
    mockDbQuery.mockReset();
  });

  function makeTradeRow(
    pnl: number,
    ivRegime: string = 'NEUTRAL',
    termShape: string = 'CONTANGO',
    liquidityScore: number = 0.5,
    slippage: number = 2.0
  ) {
    return {
      realized_pnl: pnl.toString(),
      iv_regime: ivRegime,
      regime_tag: `${ivRegime}:UP`,
      term_shape: termShape,
      liquidity_score_at_entry: liquidityScore.toString(),
      slippage_dollars: slippage.toString(),
    };
  }

  test('computeAll returns breakdowns for all context types', async () => {
    const trades = [
      makeTradeRow(200, 'HIGH', 'BACKWARDATION', 0.8, 1.5),
      makeTradeRow(-100, 'HIGH', 'BACKWARDATION', 0.2, 5.0),
      makeTradeRow(150, 'NEUTRAL', 'CONTANGO', 0.5, 2.0),
    ];

    // fetchTrades (main query with lateral join)
    mockDbQuery.mockResolvedValueOnce({ rows: trades });
    // persistRow for IV_REGIME segments (3 calls: HIGH + NEUTRAL)
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    // computeByIVPercentileBucket query
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        { realized_pnl: '200', slippage_dollars: '1.5', iv_percentile_252d: '0.80' },
        { realized_pnl: '-100', slippage_dollars: '5.0', iv_percentile_252d: '0.80' },
        { realized_pnl: '150', slippage_dollars: '2.0', iv_percentile_252d: '0.40' },
      ],
    });
    // persist IV percentile segments
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    // persist term shape segments
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    // persist liquidity segments
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const breakdowns = await service.computeAll('acct-1', 'SPREAD');

    expect(breakdowns).toHaveLength(4);
    expect(breakdowns.map(b => b.contextType)).toEqual(
      expect.arrayContaining(['IV_REGIME', 'IV_PERCENTILE_BUCKET', 'TERM_SHAPE', 'LIQUIDITY_REGIME'])
    );
  });

  test('groups by IV regime correctly', async () => {
    const trades = [
      makeTradeRow(200, 'HIGH'),
      makeTradeRow(300, 'HIGH'),
      makeTradeRow(-100, 'LOW'),
    ];

    // fetchTrades
    mockDbQuery.mockResolvedValueOnce({ rows: trades });
    // persist HIGH segment
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    // persist LOW segment
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    // IV percentile query
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    // term shape persist
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    // liquidity persist
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const breakdowns = await service.computeAll('acct-1', 'ORB');
    const ivRegime = breakdowns.find(b => b.contextType === 'IV_REGIME');

    expect(ivRegime).toBeDefined();
    const highSeg = ivRegime!.segments.find(s => s.contextValue === 'HIGH');
    expect(highSeg).toBeDefined();
    expect(highSeg!.sampleCount).toBe(2);
    expect(highSeg!.winRate).toBe(1.0);
    expect(highSeg!.totalPnl).toBe(500);

    const lowSeg = ivRegime!.segments.find(s => s.contextValue === 'LOW');
    expect(lowSeg).toBeDefined();
    expect(lowSeg!.sampleCount).toBe(1);
    expect(lowSeg!.winRate).toBe(0);
  });

  test('groups by liquidity regime correctly', async () => {
    const trades = [
      makeTradeRow(100, 'NEUTRAL', 'FLAT', 0.1),
      makeTradeRow(200, 'NEUTRAL', 'FLAT', 0.9),
      makeTradeRow(-50, 'NEUTRAL', 'FLAT', 0.5),
    ];

    mockDbQuery.mockResolvedValueOnce({ rows: trades });
    // IV_REGIME persist
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    // IV percentile query
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    // TERM_SHAPE persist
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    // LIQUIDITY_REGIME persist: LOW, HIGH, MEDIUM
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const breakdowns = await service.computeAll('acct-1', 'GEX');
    const liq = breakdowns.find(b => b.contextType === 'LIQUIDITY_REGIME');

    expect(liq).toBeDefined();
    const lowLiq = liq!.segments.find(s => s.contextValue === 'LOW');
    expect(lowLiq).toBeDefined();
    expect(lowLiq!.sampleCount).toBe(1);

    const highLiq = liq!.segments.find(s => s.contextValue === 'HIGH');
    expect(highLiq).toBeDefined();
    expect(highLiq!.sampleCount).toBe(1);
  });

  test('returns empty array for no trades', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const breakdowns = await service.computeAll('acct-1', 'EMPTY');

    expect(breakdowns).toHaveLength(0);
  });

  test('IV percentile bucket groups correctly', async () => {
    const trades = [makeTradeRow(100)];

    mockDbQuery.mockResolvedValueOnce({ rows: trades });
    // IV_REGIME persist
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    // IV percentile query with known percentile values
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        { realized_pnl: '100', slippage_dollars: '2.0', iv_percentile_252d: '0.20' },
        { realized_pnl: '200', slippage_dollars: '3.0', iv_percentile_252d: '0.50' },
        { realized_pnl: '-50', slippage_dollars: '1.0', iv_percentile_252d: '0.85' },
        { realized_pnl: '80', slippage_dollars: null, iv_percentile_252d: null },
      ],
    });
    // persist IV percentile segments (LOW, MID, HIGH, UNKNOWN)
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    // TERM_SHAPE persist
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    // LIQUIDITY persist
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const breakdowns = await service.computeAll('acct-1', 'SPREAD');
    const ivPct = breakdowns.find(b => b.contextType === 'IV_PERCENTILE_BUCKET');

    expect(ivPct).toBeDefined();
    expect(ivPct!.segments.find(s => s.contextValue === 'LOW_0-33')).toBeDefined();
    expect(ivPct!.segments.find(s => s.contextValue === 'MID_33-66')).toBeDefined();
    expect(ivPct!.segments.find(s => s.contextValue === 'HIGH_66-100')).toBeDefined();
    expect(ivPct!.segments.find(s => s.contextValue === 'UNKNOWN')).toBeDefined();
  });

  test('getLatest maps rows correctly', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: 'cp-1', account_id: 'acct-1', strategy_tag: 'ORB',
        context_type: 'IV_REGIME', context_value: 'HIGH',
        computed_at: '2026-02-10T10:00:00Z', sample_count: '25',
        win_rate: '0.7200', avg_pnl: '150.50', total_pnl: '3762.50',
        sharpe: '1.8000', avg_slippage: '2.0000', notes: null,
      }],
    });

    const rows = await service.getLatest('acct-1', 'ORB', 'IV_REGIME');

    expect(rows).toHaveLength(1);
    expect(rows[0].contextValue).toBe('HIGH');
    expect(rows[0].sampleCount).toBe(25);
    expect(rows[0].winRate).toBeCloseTo(0.72, 2);
  });

  test('computeAllStrategies iterates strategies', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ strategy_tag: 'ORB' }] });

    // fetchTrades for ORB
    mockDbQuery.mockResolvedValueOnce({ rows: [makeTradeRow(100)] });
    // persist IV_REGIME
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    // IV percentile query
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    // TERM_SHAPE persist
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    // LIQUIDITY persist
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const map = await service.computeAllStrategies('acct-1');

    expect(map.has('ORB')).toBe(true);
    expect(map.get('ORB')).toHaveLength(4);
  });
});
