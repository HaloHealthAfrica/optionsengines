import { IVRegime, TermShape } from '../../engine/types/enums';
import type { VolSurfaceSnapshot } from '../../engine/intelligence/VolSurfaceEngine';
import { OptionsEngineError } from '../../engine/types/errors';

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../config/index', () => ({
  config: { logLevel: 'info', databaseUrl: '', dbPoolMax: 5, slowRequestMs: 1000, polygonApiKey: 'test' },
}));
jest.mock('../../engine/config/loader', () => ({
  getEngineConfig: () => ({
    volSurface: {
      termEpsilon: 0.02,
      frontDTERange: [7, 14],
      midDTE: 21,
      backDTERange: [45, 60],
      backFallbackRange: [30, 45],
      redisTTLMarketHours: 600,
      redisTTLAfterHours: 3600,
    },
    regime: { ivLowThreshold: 0.33, ivHighThreshold: 0.66, minIVSampleDays: 63 },
    cache: { chainTTLSeconds: 300, snapshotTTLSeconds: 2 },
    timeouts: { massiveHTTPSeconds: 3 },
  }),
}));

const mockDbQuery = jest.fn();
jest.mock('../../services/database.service', () => ({
  db: { query: (...args: any[]) => mockDbQuery(...args) },
}));

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
jest.mock('../../services/redis-cache.service', () => ({
  redisCache: {
    get: (...args: any[]) => mockRedisGet(...args),
    set: (...args: any[]) => mockRedisSet(...args),
  },
}));

jest.mock('../../engine/data/MassiveOptionsService', () => ({
  massiveOptionsService: {},
}));
jest.mock('../../engine/intelligence/IVSeriesCollector', () => ({
  ivSeriesCollector: { getSeries: jest.fn().mockResolvedValue([]) },
}));

import { VolSurfaceQueryService } from '../../engine/intelligence/VolSurfaceQueryService';

function makeSnapshot(overrides: Partial<VolSurfaceSnapshot> = {}): VolSurfaceSnapshot {
  return {
    id: 'snap-1',
    underlying: 'SPY',
    computedAt: new Date(),
    windowDays: 252,
    frontDte: 7, midDte: 21, backDte: 45,
    ivFront: 0.28, ivMid: 0.25, ivBack: 0.22,
    termSlope: 0.06, termShape: TermShape.BACKWARDATION,
    skew25dRR: 0.08,
    ivPercentile252d: 0.55,
    ivRegime: IVRegime.NEUTRAL,
    sampleCount: 200,
    confidence: 0.79,
    source: 'COMPUTED_FROM_MASSIVE',
    notes: null,
    ...overrides,
  };
}

describe('VolSurfaceQueryService', () => {
  let service: VolSurfaceQueryService;

  beforeEach(() => {
    service = new VolSurfaceQueryService();
    mockDbQuery.mockReset();
    mockRedisGet.mockReset();
    mockRedisSet.mockReset();
  });

  describe('getVolSurface', () => {
    test('returns from Redis cache when available', async () => {
      const snap = makeSnapshot();
      mockRedisGet.mockResolvedValueOnce(snap);

      const result = await service.getVolSurface('SPY');

      expect(result.source).toBe('REDIS');
      expect(result.snapshot.underlying).toBe('SPY');
      expect(mockDbQuery).not.toHaveBeenCalled();
    });

    test('falls back to DB when Redis miss', async () => {
      mockRedisGet.mockResolvedValueOnce(null);

      const snap = makeSnapshot();
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          id: snap.id, underlying: snap.underlying,
          computed_at: snap.computedAt.toISOString(),
          window_days: '252', front_dte: '7', mid_dte: '21', back_dte: '45',
          iv_front: '0.28', iv_mid: '0.25', iv_back: '0.22',
          term_slope: '0.06', term_shape: 'BACKWARDATION',
          skew_25d_rr: '0.08', iv_percentile_252d: '0.55',
          iv_regime: 'NEUTRAL', sample_count: '200', confidence: '0.79',
          source: 'COMPUTED_FROM_MASSIVE', notes: null,
        }],
      });

      const result = await service.getVolSurface('SPY');

      expect(result.source).toBe('DB');
      expect(result.snapshot.termShape).toBe(TermShape.BACKWARDATION);
      expect(mockRedisSet).toHaveBeenCalled(); // repopulates cache
    });

    test('throws ANALYTICS_UNAVAILABLE when both miss', async () => {
      mockRedisGet.mockResolvedValueOnce(null);
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      await expect(service.getVolSurface('SPY'))
        .rejects
        .toThrow(OptionsEngineError);
    });
  });

  describe('getForTradeDecision', () => {
    test('returns snapshot for decision path', async () => {
      const snap = makeSnapshot();
      mockRedisGet.mockResolvedValueOnce(snap);

      const result = await service.getForTradeDecision('SPY');
      expect(result.underlying).toBe('SPY');
    });
  });

  describe('getForDashboard', () => {
    test('returns null instead of throwing', async () => {
      mockRedisGet.mockResolvedValueOnce(null);
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const result = await service.getForDashboard('MISSING');
      expect(result).toBeNull();
    });
  });

  describe('getBatch', () => {
    test('returns results for multiple underlyings', async () => {
      mockRedisGet.mockResolvedValueOnce(makeSnapshot({ underlying: 'SPY' }));
      mockRedisGet.mockResolvedValueOnce(null);
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // QQQ misses both

      const results = await service.getBatch(['SPY', 'QQQ']);

      expect(results.get('SPY')).not.toBeNull();
      expect(results.get('QQQ')).toBeNull();
    });
  });

  describe('invalidateCache', () => {
    test('expires Redis key', async () => {
      await service.invalidateCache('SPY');
      expect(mockRedisSet).toHaveBeenCalledWith('volsurface:SPY', null, 1);
    });
  });
});
