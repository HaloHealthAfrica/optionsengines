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

import { CorrelationBucketService } from '../../engine/intelligence/CorrelationBucketService';
import type { CorrelationMatrix } from '../../engine/intelligence/CorrelationMatrixJob';

describe('CorrelationBucketService', () => {
  let service: CorrelationBucketService;

  const makeMatrix = (matrixData: Record<string, Record<string, number>>): CorrelationMatrix => ({
    id: 'matrix-1',
    computedAt: new Date(),
    windowDays: 30,
    tickers: Object.keys(matrixData),
    matrix: matrixData,
    method: 'PEARSON',
    sampleCount: 28,
    source: 'MASSIVE_AGGS',
    confidence: 0.93,
  });

  beforeEach(() => {
    service = new CorrelationBucketService();
    mockDbQuery.mockReset();
  });

  describe('buildAndPersist', () => {
    test('groups highly correlated tickers into same bucket', async () => {
      const matrix = makeMatrix({
        SPY: { SPY: 1, QQQ: 0.91, IWM: 0.60, AAPL: 0.40 },
        QQQ: { SPY: 0.91, QQQ: 1, IWM: 0.55, AAPL: 0.35 },
        IWM: { SPY: 0.60, QQQ: 0.55, IWM: 1, AAPL: 0.30 },
        AAPL: { SPY: 0.40, QQQ: 0.35, IWM: 0.30, AAPL: 1 },
      });

      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // getLatestVersion
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // insert

      const result = await service.buildAndPersist(matrix);

      // SPY and QQQ should be in same bucket (corr 0.91 > 0.85)
      const spyBucket = result.buckets.find(b => b.tickers.includes('SPY'));
      expect(spyBucket!.tickers).toContain('QQQ');

      // IWM and AAPL should be in separate buckets
      const iwmBucket = result.buckets.find(b => b.tickers.includes('IWM'));
      const aaplBucket = result.buckets.find(b => b.tickers.includes('AAPL'));
      expect(iwmBucket!.tickers).not.toContain('AAPL');
      expect(aaplBucket!.tickers).not.toContain('IWM');
    });

    test('assigns centroid as ticker with highest avg correlation', async () => {
      const matrix = makeMatrix({
        SPY: { SPY: 1, QQQ: 0.92, IWM: 0.88 },
        QQQ: { SPY: 0.92, QQQ: 1, IWM: 0.90 },
        IWM: { SPY: 0.88, QQQ: 0.90, IWM: 1 },
      });

      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const result = await service.buildAndPersist(matrix);

      // All in one bucket since all correlations > 0.85
      expect(result.buckets).toHaveLength(1);
      // QQQ has highest avg corr: (0.92+0.90)/2 = 0.91
      expect(result.buckets[0].centroid).toBe('QQQ');
    });

    test('single-ticker components have ticker as centroid', async () => {
      const matrix = makeMatrix({
        SPY: { SPY: 1, TSLA: 0.30 },
        TSLA: { SPY: 0.30, TSLA: 1 },
      });

      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const result = await service.buildAndPersist(matrix);

      expect(result.buckets).toHaveLength(2);
      const spyBucket = result.buckets.find(b => b.tickers.includes('SPY'))!;
      expect(spyBucket.centroid).toBe('SPY');
    });

    test('increments version', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ bucket_version: '1.0.5' }] });
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const matrix = makeMatrix({
        SPY: { SPY: 1, QQQ: 0.90 },
        QQQ: { SPY: 0.90, QQQ: 1 },
      });

      const result = await service.buildAndPersist(matrix);
      expect(result.bucketVersion).toBe('1.0.6');
    });
  });

  describe('toBucketMap', () => {
    test('converts to Map for governor', () => {
      const bucketsResult = {
        id: 'b1', computedAt: new Date(), windowDays: 30,
        bucketVersion: '1.0.1',
        buckets: [
          { id: 'B1', tickers: ['SPY', 'QQQ'], centroid: 'SPY' },
          { id: 'B2', tickers: ['IWM'], centroid: 'IWM' },
        ],
        threshold: 0.85, notes: null,
      };

      const map = service.toBucketMap(bucketsResult);
      expect(map.get('B1')).toEqual(['SPY', 'QQQ']);
      expect(map.get('B2')).toEqual(['IWM']);
    });
  });

  describe('findBucketForTicker', () => {
    test('finds correct bucket', () => {
      const bucketsResult = {
        id: 'b1', computedAt: new Date(), windowDays: 30,
        bucketVersion: '1.0.1',
        buckets: [
          { id: 'B1', tickers: ['SPY', 'QQQ'], centroid: 'SPY' },
          { id: 'B2', tickers: ['IWM'], centroid: 'IWM' },
        ],
        threshold: 0.85, notes: null,
      };

      expect(service.findBucketForTicker('QQQ', bucketsResult)?.id).toBe('B1');
      expect(service.findBucketForTicker('IWM', bucketsResult)?.id).toBe('B2');
      expect(service.findBucketForTicker('TSLA', bucketsResult)).toBeNull();
    });
  });

  describe('getLatest', () => {
    test('returns null when empty', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      expect(await service.getLatest()).toBeNull();
    });

    test('maps row correctly', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          id: 'b1', computed_at: '2026-02-20T16:00:00Z',
          window_days: '30', bucket_version: '1.0.3',
          buckets: [{ id: 'B1', tickers: ['SPY', 'QQQ'], centroid: 'SPY' }],
          threshold: '0.85', notes: '1 bucket from 2 tickers',
        }],
      });

      const result = await service.getLatest();
      expect(result).not.toBeNull();
      expect(result!.buckets[0].tickers).toContain('SPY');
      expect(result!.threshold).toBe(0.85);
    });
  });
});
