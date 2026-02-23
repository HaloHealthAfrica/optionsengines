jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../config/index', () => ({
  config: { logLevel: 'info', databaseUrl: '', dbPoolMax: 5, slowRequestMs: 1000, polygonApiKey: 'test' },
}));
jest.mock('../../engine/config/loader', () => ({
  getEngineConfig: () => ({
    correlation: { windowDays: 30, threshold: 0.85, coreTickers: ['SPY', 'QQQ', 'IWM', 'DIA'], method: 'PEARSON' },
  }),
}));

const mockDbQuery = jest.fn();
jest.mock('../../services/database.service', () => ({
  db: { query: (...args: any[]) => mockDbQuery(...args) },
}));
jest.mock('../../services/redis-cache.service', () => ({
  redisCache: { get: jest.fn().mockResolvedValue(null), set: jest.fn() },
}));
jest.mock('../../engine/data/MassiveOptionsService', () => ({
  massiveOptionsService: {},
}));

const mockMatrixGetLatest = jest.fn();
jest.mock('../../engine/intelligence/CorrelationMatrixJob', () => ({
  correlationMatrixJob: {
    getLatest: (...args: any[]) => mockMatrixGetLatest(...args),
  },
}));

const mockBucketGetLatest = jest.fn();
const mockBucketToBucketMap = jest.fn();
const mockBucketFindTicker = jest.fn();
jest.mock('../../engine/intelligence/CorrelationBucketService', () => ({
  correlationBucketService: {
    getLatest: (...args: any[]) => mockBucketGetLatest(...args),
    toBucketMap: (...args: any[]) => mockBucketToBucketMap(...args),
    findBucketForTicker: (...args: any[]) => mockBucketFindTicker(...args),
  },
}));

import { CorrelationQueryService } from '../../engine/intelligence/CorrelationQueryService';

describe('CorrelationQueryService', () => {
  let service: CorrelationQueryService;

  beforeEach(() => {
    service = new CorrelationQueryService();
    mockDbQuery.mockReset();
    mockMatrixGetLatest.mockReset();
    mockBucketGetLatest.mockReset();
    mockBucketToBucketMap.mockReset();
    mockBucketFindTicker.mockReset();
  });

  describe('getBucketsForGovernor', () => {
    test('returns dynamic buckets when available', async () => {
      const buckets = {
        id: 'b1', computedAt: new Date(),
        windowDays: 30, bucketVersion: '1.0.1',
        buckets: [{ id: 'B1', tickers: ['SPY', 'QQQ'], centroid: 'SPY' }],
        threshold: 0.85, notes: null,
      };

      mockBucketGetLatest.mockResolvedValueOnce(buckets);
      const mockMap = new Map([['B1', ['SPY', 'QQQ']]]);
      mockBucketToBucketMap.mockReturnValueOnce(mockMap);

      const result = await service.getBucketsForGovernor();

      expect(result.source).toBe('DYNAMIC');
      expect(result.bucketMap.get('B1')).toEqual(['SPY', 'QQQ']);
      expect(result.confidence).toBeGreaterThan(0);
    });

    test('falls back to static when no dynamic and limits enabled', async () => {
      mockBucketGetLatest.mockResolvedValueOnce(null);

      const result = await service.getBucketsForGovernor(true);

      expect(result.source).toBe('STATIC_FALLBACK');
      expect(result.notes).toContain('CORR_FALLBACK_STATIC');
      expect(result.bucketMap.size).toBeGreaterThan(0);
    });

    test('returns empty when no dynamic and limits disabled', async () => {
      mockBucketGetLatest.mockResolvedValueOnce(null);

      const result = await service.getBucketsForGovernor(false);

      expect(result.source).toBe('STATIC_FALLBACK');
      expect(result.bucketMap.size).toBe(0);
    });
  });

  describe('getTickerInfo', () => {
    test('returns bucket and correlations for ticker', async () => {
      mockMatrixGetLatest.mockResolvedValueOnce({
        matrix: {
          SPY: { SPY: 1, QQQ: 0.91, IWM: 0.60 },
        },
        tickers: ['SPY', 'QQQ', 'IWM'],
      });

      const bucket = { id: 'B1', tickers: ['SPY', 'QQQ'], centroid: 'SPY' };
      mockBucketGetLatest.mockResolvedValueOnce({
        buckets: [bucket, { id: 'B2', tickers: ['IWM'], centroid: 'IWM' }],
      });
      mockBucketFindTicker.mockReturnValueOnce(bucket);

      const result = await service.getTickerInfo('SPY');

      expect(result.ticker).toBe('SPY');
      expect(result.bucket?.id).toBe('B1');
      expect(result.correlatedTickers).toHaveLength(2);
      // Sorted by absolute correlation descending
      expect(result.correlatedTickers[0].otherTicker).toBe('QQQ');
      expect(result.correlatedTickers[0].correlation).toBe(0.91);
    });

    test('handles missing matrix', async () => {
      mockMatrixGetLatest.mockResolvedValueOnce(null);
      mockBucketGetLatest.mockResolvedValueOnce(null);
      mockBucketFindTicker.mockReturnValueOnce(null);

      const result = await service.getTickerInfo('UNKNOWN');

      expect(result.bucket).toBeNull();
      expect(result.correlatedTickers).toHaveLength(0);
    });
  });

  describe('getPairwiseCorrelation', () => {
    test('returns correlation between two tickers', async () => {
      mockMatrixGetLatest.mockResolvedValueOnce({
        matrix: { SPY: { QQQ: 0.91 } },
      });

      const result = await service.getPairwiseCorrelation('SPY', 'QQQ');
      expect(result).toBe(0.91);
    });

    test('returns null when no matrix', async () => {
      mockMatrixGetLatest.mockResolvedValueOnce(null);
      expect(await service.getPairwiseCorrelation('SPY', 'QQQ')).toBeNull();
    });

    test('returns null when ticker not in matrix', async () => {
      mockMatrixGetLatest.mockResolvedValueOnce({
        matrix: { SPY: { QQQ: 0.91 } },
      });
      expect(await service.getPairwiseCorrelation('SPY', 'TSLA')).toBeNull();
    });
  });
});
