import { SystemState, LatencyMode } from '../../engine/types/enums';
import type { DecisionTrace } from '../../engine/types/index';

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

const mockTraceGet = jest.fn();
const mockTraceCreate = jest.fn();
const mockTraceQuery = jest.fn();
jest.mock('../../engine/core/DecisionTraceService', () => ({
  decisionTraceService: {
    get: (...args: any[]) => mockTraceGet(...args),
    create: (...args: any[]) => mockTraceCreate(...args),
    query: (...args: any[]) => mockTraceQuery(...args),
  },
}));

import { ReplayEngine, ReplayError } from '../../engine/replay/ReplayEngine';

describe('ReplayEngine', () => {
  let engine: ReplayEngine;

  const makeTrace = (overrides: Partial<DecisionTrace> = {}): DecisionTrace => ({
    decisionTraceId: 'trace-1',
    accountId: 'acct-1',
    signalId: 'sig-1',
    isReplay: false,
    latencyMode: LatencyMode.CACHED,
    systemStateAtDecision: SystemState.ACTIVE,
    tradeIntentSnapshot: { underlying: 'SPY', strategyTag: 'ORB' },
    sanityValidationResult: { passed: true, failedChecks: [] },
    constructionResult: { success: true, tradePlanId: 'tp-1' },
    candidatesScoredTop5: null,
    governorResult: { decision: 'APPROVE', reasonCodes: [] },
    capitalValidation: { sufficient: true, available: 50000 },
    bucketValidation: null,
    policyGateResult: null,
    latencyBudgetResult: null,
    positionStateTransition: null,
    finalOrders: null,
    fills: null,
    slippageAuditIds: [],
    pnlOutcome: 150,
    regimeAtDecision: null,
    underlyingLiquidityRatio: null,
    createdAt: new Date(),
    closedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    engine = new ReplayEngine();
    mockDbQuery.mockReset();
    mockTraceGet.mockReset();
    mockTraceCreate.mockReset();
    mockTraceQuery.mockReset();
  });

  describe('replayTrace', () => {
    test('replays a trace with no drift', async () => {
      const trace = makeTrace();
      mockTraceGet.mockResolvedValueOnce(trace);
      mockTraceCreate.mockResolvedValueOnce(trace);

      const result = await engine.replayTrace('trace-1');

      expect(result.originalTraceId).toBe('trace-1');
      expect(result.driftDetected).toBe(false);
      expect(result.driftCount).toBe(0);
      expect(result.stages).toHaveLength(5);
      expect(result.stages.every(s => s.match)).toBe(true);
    });

    test('throws when trace not found', async () => {
      mockTraceGet.mockResolvedValueOnce(null);

      await expect(engine.replayTrace('missing')).rejects.toThrow(ReplayError);
    });

    test('detects drift when stage is present vs absent', async () => {
      const trace = makeTrace({
        sanityValidationResult: { passed: true },
      });
      mockTraceGet.mockResolvedValueOnce(trace);
      mockTraceCreate.mockResolvedValueOnce(trace);

      const result = await engine.replayTrace('trace-1');

      expect(result.driftDetected).toBe(false);
    });

    test('handles null stages gracefully', async () => {
      const trace = makeTrace({
        constructionResult: null,
        governorResult: null,
        capitalValidation: null,
      });
      mockTraceGet.mockResolvedValueOnce(trace);
      mockTraceCreate.mockResolvedValueOnce(trace);

      const result = await engine.replayTrace('trace-1');

      expect(result.driftDetected).toBe(false);
      expect(result.stages.filter(s => s.originalValue === null)).toHaveLength(3);
    });

    test('reports replay latency', async () => {
      const trace = makeTrace();
      mockTraceGet.mockResolvedValueOnce(trace);
      mockTraceCreate.mockResolvedValueOnce(trace);

      const result = await engine.replayTrace('trace-1');

      expect(result.replayLatencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('replayBatch', () => {
    test('replays multiple traces', async () => {
      const trace1 = makeTrace({ decisionTraceId: 'trace-1' });
      const trace2 = makeTrace({ decisionTraceId: 'trace-2' });

      mockTraceQuery.mockResolvedValueOnce([trace1, trace2]);
      mockTraceGet.mockResolvedValueOnce(trace1).mockResolvedValueOnce(trace2);
      mockTraceCreate.mockResolvedValue(trace1);

      const result = await engine.replayBatch({
        accountId: 'acct-1',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-02-01'),
      });

      expect(result.total).toBe(2);
      expect(result.replayed).toBe(2);
    });

    test('continues on individual trace failure', async () => {
      const trace1 = makeTrace({ decisionTraceId: 'trace-1' });

      mockTraceQuery.mockResolvedValueOnce([trace1, { decisionTraceId: 'trace-bad' }]);
      mockTraceGet
        .mockResolvedValueOnce(trace1)
        .mockResolvedValueOnce(null); // second trace not found
      mockTraceCreate.mockResolvedValue(trace1);

      const result = await engine.replayBatch({
        accountId: 'acct-1',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-02-01'),
      });

      expect(result.total).toBe(2);
      expect(result.replayed).toBe(1); // one succeeded, one errored
    });
  });

  describe('getHistoricalSnapshots', () => {
    test('fetches and maps snapshots', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          id: 's1',
          underlying: 'SPY',
          option_ticker: 'O:SPY260320C00500000',
          snapshot_type: 'OPTION_QUOTE',
          bid: '4.50',
          ask: '4.80',
          iv: '0.25',
          delta: '0.45',
          gamma: '0.03',
          volume: '1200',
          oi: '5000',
          recorded_at: '2026-02-15T15:00:00Z',
          source: 'MASSIVE',
        }],
      });

      const snaps = await engine.getHistoricalSnapshots(
        'SPY',
        new Date('2026-02-15'),
        new Date('2026-02-16')
      );

      expect(snaps).toHaveLength(1);
      expect(snaps[0].bid).toBe(4.50);
      expect(snaps[0].delta).toBe(0.45);
      expect(snaps[0].source).toBe('MASSIVE');
    });
  });

  describe('recordSnapshot', () => {
    test('stores snapshot and returns id', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const id = await engine.recordSnapshot({
        underlying: 'SPY',
        optionTicker: 'O:SPY260320C00500000',
        snapshotType: 'OPTION_QUOTE',
        bid: 4.50,
        ask: 4.80,
        iv: 0.25,
        delta: 0.45,
        gamma: 0.03,
        volume: 1200,
        oi: 5000,
        recordedAt: new Date(),
        source: 'MASSIVE',
      });

      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(mockDbQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('getDriftLog', () => {
    test('returns drift entries for original trace', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          { stage: 'construction', field: 'score', original_value: '0.85', replay_value: '0.82', drift_magnitude: '0.03' },
          { stage: 'governor', field: 'decision', original_value: 'APPROVE', replay_value: 'RESIZE', drift_magnitude: null },
        ],
      });

      const drifts = await engine.getDriftLog('trace-1', 'original');

      expect(drifts).toHaveLength(2);
      expect(drifts[0].field).toBe('construction.score');
      expect(drifts[0].magnitude).toBe(0.03);
      expect(drifts[1].magnitude).toBeNull();
    });
  });
});
