jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../config/index', () => ({
  config: { logLevel: 'info', databaseUrl: '', dbPoolMax: 5, slowRequestMs: 1000 },
}));
jest.mock('../../engine/config/loader', () => ({
  getEngineConfig: () => ({
    research: {
      drift: {
        winRateDropPct: 0.10,
        sharpeDropAbs: 0.5,
        slippageIncreasePct: 0.50,
        pnlMeanDropPct: 0.30,
      },
    },
  }),
}));

const mockDbQuery = jest.fn();
jest.mock('../../services/database.service', () => ({
  db: { query: (...args: any[]) => mockDbQuery(...args) },
}));

import { DriftDetectionEngine } from '../../engine/dashboard/DriftDetectionEngine';

describe('DriftDetectionEngine', () => {
  let engine: DriftDetectionEngine;

  beforeEach(() => {
    engine = new DriftDetectionEngine();
    mockDbQuery.mockReset();
  });

  function makeTradeRow(pnl: number, slippage: number = 2.0) {
    return { realized_pnl: pnl.toString(), slippage_dollars: slippage.toString() };
  }

  test('returns empty drifts when insufficient data', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: Array.from({ length: 50 }, () => makeTradeRow(100)) });

    const result = await engine.detect('acct-1', 'ORB', 30, 100);

    expect(result.driftsDetected).toHaveLength(0);
    expect(result.strategyTag).toBe('ORB');
  });

  test('detects win rate drift', async () => {
    // Recent 30: all losses => winRate = 0
    // Baseline 100: all wins => winRate = 1.0
    // Delta = 1.0 > 0.10 threshold
    const recentLosses = Array.from({ length: 30 }, () => makeTradeRow(-100));
    const baselineWins = Array.from({ length: 100 }, () => makeTradeRow(100));
    const allRows = [...recentLosses, ...baselineWins];

    mockDbQuery.mockResolvedValueOnce({ rows: allRows }); // fetchRecentTrades
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // persist drift event

    const result = await engine.detect('acct-1', 'SPREAD', 30, 100);

    const winRateDrift = result.driftsDetected.find(d => d.driftType === 'WIN_RATE');
    expect(winRateDrift).toBeDefined();
    expect(winRateDrift!.baselineValue).toBe(1.0);
    expect(winRateDrift!.currentValue).toBe(0);
    expect(winRateDrift!.severity).toBe('CRITICAL');
  });

  test('detects slippage drift', async () => {
    // Recent 30: slippage = 10 each
    // Baseline 100: slippage = 2 each
    // Increase = (10-2)/2 = 4.0 > 0.50 threshold
    const recentRows = Array.from({ length: 30 }, () => makeTradeRow(100, 10));
    const baselineRows = Array.from({ length: 100 }, () => makeTradeRow(100, 2));
    const allRows = [...recentRows, ...baselineRows];

    mockDbQuery.mockResolvedValueOnce({ rows: allRows });
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // persist

    const result = await engine.detect('acct-1', 'ORB', 30, 100);

    const slipDrift = result.driftsDetected.find(d => d.driftType === 'SLIPPAGE');
    expect(slipDrift).toBeDefined();
    expect(slipDrift!.baselineValue).toBe(2);
    expect(slipDrift!.currentValue).toBe(10);
  });

  test('detects PnL mean drift', async () => {
    // Recent 30: avg PnL = 10
    // Baseline 100: avg PnL = 100
    // Drop = (100-10)/100 = 0.90 > 0.30 threshold
    const recentRows = Array.from({ length: 30 }, () => makeTradeRow(10));
    const baselineRows = Array.from({ length: 100 }, () => makeTradeRow(100));
    const allRows = [...recentRows, ...baselineRows];

    mockDbQuery.mockResolvedValueOnce({ rows: allRows });
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // persist

    const result = await engine.detect('acct-1', 'GEX', 30, 100);

    const pnlDrift = result.driftsDetected.find(d => d.driftType === 'PNL_MEAN');
    expect(pnlDrift).toBeDefined();
    expect(pnlDrift!.delta).toBeCloseTo(0.9, 2);
  });

  test('no drift when performance is stable', async () => {
    const stableRows = Array.from({ length: 130 }, () => makeTradeRow(50));

    mockDbQuery.mockResolvedValueOnce({ rows: stableRows });

    const result = await engine.detect('acct-1', 'ORB', 30, 100);

    expect(result.driftsDetected).toHaveLength(0);
  });

  test('severity is CRITICAL when delta exceeds 2x threshold', async () => {
    // Win rate drop: baseline = 0.8 (80 wins / 100), recent = 0 (0 wins / 30)
    // delta = 0.8 > 0.10 * 2 = 0.20 => CRITICAL
    const recentLosses = Array.from({ length: 30 }, () => makeTradeRow(-50));
    const baselineMixed = [
      ...Array.from({ length: 80 }, () => makeTradeRow(100)),
      ...Array.from({ length: 20 }, () => makeTradeRow(-50)),
    ];
    const allRows = [...recentLosses, ...baselineMixed];

    mockDbQuery.mockResolvedValueOnce({ rows: allRows });
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // persist

    const result = await engine.detect('acct-1', 'SPREAD', 30, 100);

    const winRateDrift = result.driftsDetected.find(d => d.driftType === 'WIN_RATE');
    expect(winRateDrift).toBeDefined();
    expect(winRateDrift!.severity).toBe('CRITICAL');
  });

  test('severity is WARNING when delta is moderate', async () => {
    // Win rate: baseline = 0.6 (60/100), recent = 0.4667 (14/30)
    // delta = 0.1333 > 0.10 => drift detected
    // delta < 0.10*2 = 0.20 => WARNING
    const recentRows = [
      ...Array.from({ length: 14 }, () => makeTradeRow(100)),
      ...Array.from({ length: 16 }, () => makeTradeRow(-50)),
    ];
    const baselineRows = [
      ...Array.from({ length: 60 }, () => makeTradeRow(100)),
      ...Array.from({ length: 40 }, () => makeTradeRow(-50)),
    ];
    const allRows = [...recentRows, ...baselineRows];

    mockDbQuery.mockResolvedValueOnce({ rows: allRows });
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // persist

    const result = await engine.detect('acct-1', 'ORB', 30, 100);

    const winRateDrift = result.driftsDetected.find(d => d.driftType === 'WIN_RATE');
    expect(winRateDrift).toBeDefined();
    expect(winRateDrift!.severity).toBe('WARNING');
  });

  test('detectAll iterates over all strategies', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ strategy_tag: 'ORB' }, { strategy_tag: 'SPREAD' }] });
    // ORB - insufficient data
    mockDbQuery.mockResolvedValueOnce({ rows: Array.from({ length: 10 }, () => makeTradeRow(100)) });
    // SPREAD - insufficient data
    mockDbQuery.mockResolvedValueOnce({ rows: Array.from({ length: 10 }, () => makeTradeRow(100)) });

    const results = await engine.detectAll('acct-1', 30, 100);

    expect(results).toHaveLength(2);
    expect(results[0].strategyTag).toBe('ORB');
    expect(results[1].strategyTag).toBe('SPREAD');
  });

  test('getUnresolvedDrifts returns unresolved events', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: 'd-1', account_id: 'acct-1', strategy_tag: 'ORB',
        detected_at: '2026-02-10T10:00:00Z', drift_type: 'WIN_RATE',
        baseline_value: '0.70000', current_value: '0.40000',
        delta: '0.30000', threshold: '0.10000',
        baseline_window: '100', rolling_window: '30',
        severity: 'CRITICAL', resolved: false, resolved_at: null,
        metadata: null,
      }],
    });

    const drifts = await engine.getUnresolvedDrifts('acct-1');

    expect(drifts).toHaveLength(1);
    expect(drifts[0].driftType).toBe('WIN_RATE');
    expect(drifts[0].resolved).toBe(false);
  });

  test('resolveDrift updates the row', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    await engine.resolveDrift('d-1');

    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE oe_drift_events'),
      ['d-1']
    );
  });
});
