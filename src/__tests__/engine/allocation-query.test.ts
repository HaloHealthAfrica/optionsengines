import { IVRegime, TermShape } from '../../engine/types/enums';

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../config/index', () => ({
  config: { logLevel: 'info', databaseUrl: '', dbPoolMax: 5, slowRequestMs: 1000 },
}));
jest.mock('../../engine/config/loader', () => ({
  getEngineConfig: () => ({
    buckets: { ORB: 0.30, GEX: 0.30, Spread: 0.30, Experimental: 0.10 },
    regime: { ivLowThreshold: 0.33, ivHighThreshold: 0.66, minIVSampleDays: 63, hysteresisCount: 3 },
  }),
}));

const mockDbQuery = jest.fn();
jest.mock('../../services/database.service', () => ({
  db: { query: (...args: any[]) => mockDbQuery(...args) },
}));

const mockGetActivePolicy = jest.fn();
const mockGetLatestSnapshot = jest.fn();
const mockEvaluate = jest.fn();
const mockIsStrategyAllowed = jest.fn();
const mockGetStrategyWeight = jest.fn();
const mockGetGlobalSizeMultiplier = jest.fn();
const mockGetBucketLimit = jest.fn();

jest.mock('../../engine/regime/RegimePolicyEngine', () => ({
  regimePolicyEngine: {
    getActivePolicy: (...args: any[]) => mockGetActivePolicy(...args),
    getLatestSnapshot: (...args: any[]) => mockGetLatestSnapshot(...args),
    evaluate: (...args: any[]) => mockEvaluate(...args),
    isStrategyAllowed: (...args: any[]) => mockIsStrategyAllowed(...args),
    getStrategyWeight: (...args: any[]) => mockGetStrategyWeight(...args),
    getGlobalSizeMultiplier: (...args: any[]) => mockGetGlobalSizeMultiplier(...args),
    getBucketLimit: (...args: any[]) => mockGetBucketLimit(...args),
  },
}));

import { AllocationQueryService } from '../../engine/regime/AllocationQueryService';
import type { RegimeContext } from '../../engine/regime/RegimePolicyEngine';

describe('AllocationQueryService', () => {
  let service: AllocationQueryService;

  const makeSnapshot = (overrides: Record<string, unknown> = {}) => ({
    id: 'snap-1',
    accountId: 'acct-1',
    computedAt: new Date(),
    underlying: null,
    regimeTag: 'HIGH:BACKWARDATION',
    bucketLimits: { Spread: 0.40 },
    strategyWeightOverrides: { SPREAD: 1.2 },
    riskMultipliers: { globalSize: 0.85 },
    denyStrategies: ['LONG_PREMIUM'],
    confidence: 0.9,
    source: 'COMPUTED',
    notes: null,
    ...overrides,
  });

  const makeContext = (): RegimeContext => ({
    ivRegime: IVRegime.HIGH,
    termShape: TermShape.BACKWARDATION,
    ivPercentile: 0.78,
    skew: 0.08,
  });

  beforeEach(() => {
    service = new AllocationQueryService();
    mockDbQuery.mockReset();
    mockGetActivePolicy.mockReset();
    mockGetLatestSnapshot.mockReset();
    mockEvaluate.mockReset();
    mockIsStrategyAllowed.mockReset();
    mockGetStrategyWeight.mockReset();
    mockGetGlobalSizeMultiplier.mockReset();
    mockGetBucketLimit.mockReset();
  });

  describe('getStatus', () => {
    test('returns full status', async () => {
      const policy = { id: 'p1', enabled: true, rules: [] };
      const snapshot = makeSnapshot();

      mockGetActivePolicy.mockResolvedValueOnce(policy);
      mockGetLatestSnapshot.mockResolvedValueOnce(snapshot);

      const result = await service.getStatus('acct-1');

      expect(result.hasActivePolicy).toBe(true);
      expect(result.regimeTag).toBe('HIGH:BACKWARDATION');
      expect(result.latestSnapshot).not.toBeNull();
    });

    test('returns inactive when no policy', async () => {
      mockGetActivePolicy.mockResolvedValueOnce(null);
      mockGetLatestSnapshot.mockResolvedValueOnce(null);

      const result = await service.getStatus('acct-1');

      expect(result.hasActivePolicy).toBe(false);
      expect(result.regimeTag).toBeNull();
    });
  });

  describe('checkTradeAllocation', () => {
    test('allows trade when strategy not denied', async () => {
      const snapshot = makeSnapshot();
      mockGetLatestSnapshot.mockResolvedValueOnce(snapshot);
      mockIsStrategyAllowed.mockReturnValueOnce(true);
      mockGetStrategyWeight.mockReturnValueOnce(1.2);
      mockGetGlobalSizeMultiplier.mockReturnValueOnce(0.85);
      mockGetBucketLimit.mockReturnValueOnce(0.40);

      const result = await service.checkTradeAllocation(
        'acct-1', 'SPREAD', 'Spread', makeContext()
      );

      expect(result.allowed).toBe(true);
      expect(result.strategyWeight).toBe(1.2);
      expect(result.globalSizeMultiplier).toBe(0.85);
      expect(result.denyReason).toBeNull();
    });

    test('denies trade when strategy is denied', async () => {
      const snapshot = makeSnapshot();
      mockGetLatestSnapshot.mockResolvedValueOnce(snapshot);
      mockIsStrategyAllowed.mockReturnValueOnce(false);
      mockGetStrategyWeight.mockReturnValueOnce(1.0);
      mockGetGlobalSizeMultiplier.mockReturnValueOnce(0.85);
      mockGetBucketLimit.mockReturnValueOnce(0.40);

      const result = await service.checkTradeAllocation(
        'acct-1', 'LONG_PREMIUM', 'ORB', makeContext()
      );

      expect(result.allowed).toBe(false);
      expect(result.denyReason).toContain('LONG_PREMIUM');
    });

    test('recomputes when snapshot is stale', async () => {
      const staleSnapshot = makeSnapshot({
        computedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      });
      const freshSnapshot = makeSnapshot();

      mockGetLatestSnapshot.mockResolvedValueOnce(staleSnapshot);
      mockEvaluate.mockResolvedValueOnce(freshSnapshot);
      mockIsStrategyAllowed.mockReturnValueOnce(true);
      mockGetStrategyWeight.mockReturnValueOnce(1.0);
      mockGetGlobalSizeMultiplier.mockReturnValueOnce(1.0);
      mockGetBucketLimit.mockReturnValueOnce(0.30);

      const result = await service.checkTradeAllocation(
        'acct-1', 'ORB', 'ORB', makeContext()
      );

      expect(mockEvaluate).toHaveBeenCalledTimes(1);
      expect(result.allowed).toBe(true);
    });

    test('evaluates fresh when no snapshot exists', async () => {
      const freshSnapshot = makeSnapshot();

      mockGetLatestSnapshot.mockResolvedValueOnce(null);
      mockEvaluate.mockResolvedValueOnce(freshSnapshot);
      mockIsStrategyAllowed.mockReturnValueOnce(true);
      mockGetStrategyWeight.mockReturnValueOnce(1.0);
      mockGetGlobalSizeMultiplier.mockReturnValueOnce(1.0);
      mockGetBucketLimit.mockReturnValueOnce(0.30);

      const result = await service.checkTradeAllocation(
        'acct-1', 'GEX', 'GEX', makeContext()
      );

      expect(mockEvaluate).toHaveBeenCalledTimes(1);
      expect(result.regimeTag).toBe('HIGH:BACKWARDATION');
    });
  });

  describe('getHistory', () => {
    test('returns allocation history', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 's1', account_id: 'acct-1', computed_at: new Date().toISOString(),
            underlying: null, regime_tag: 'HIGH:BACKWARDATION',
            bucket_limits: { Spread: 0.40 }, strategy_weight_overrides: {},
            risk_multipliers: { globalSize: 0.85 }, deny_strategies: [],
            confidence: '0.90', source: 'COMPUTED', notes: null,
          },
        ],
      });

      const history = await service.getHistory('acct-1');
      expect(history).toHaveLength(1);
      expect(history[0].regimeTag).toBe('HIGH:BACKWARDATION');
    });
  });

  describe('getRegimeBreakdown', () => {
    test('returns grouped regime stats', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          { regime_tag: 'HIGH:BACKWARDATION', count: '15', avg_global_size: '0.85', deny_count: '5' },
          { regime_tag: 'NEUTRAL:CONTANGO', count: '30', avg_global_size: '1.0', deny_count: '0' },
        ],
      });

      const breakdown = await service.getRegimeBreakdown('acct-1');

      expect(breakdown).toHaveLength(2);
      expect(breakdown[0].regime).toBe('HIGH:BACKWARDATION');
      expect(breakdown[0].avgGlobalSize).toBe(0.85);
      expect(breakdown[1].denyCount).toBe(0);
    });
  });
});
