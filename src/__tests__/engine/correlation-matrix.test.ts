jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../config/index', () => ({
  config: { logLevel: 'info', databaseUrl: '', dbPoolMax: 5, slowRequestMs: 1000, polygonApiKey: 'test' },
}));

const mockGetEngineConfig = jest.fn();
jest.mock('../../engine/config/loader', () => ({
  getEngineConfig: () => mockGetEngineConfig(),
}));

const mockDbQuery = jest.fn();
jest.mock('../../services/database.service', () => ({
  db: { query: (...args: any[]) => mockDbQuery(...args) },
}));

const mockGetDailyBars = jest.fn();
jest.mock('../../engine/data/MassiveOptionsService', () => ({
  massiveOptionsService: {
    getDailyBars: (...args: any[]) => mockGetDailyBars(...args),
  },
}));
jest.mock('../../services/redis-cache.service', () => ({
  redisCache: { get: jest.fn().mockResolvedValue(null), set: jest.fn() },
}));

import { CorrelationMatrixJob } from '../../engine/intelligence/CorrelationMatrixJob';

describe('CorrelationMatrixJob', () => {
  let job: CorrelationMatrixJob;

  const defaultConfig = {
    correlation: {
      windowDays: 30,
      calendarDaysToFetch: 45,
      threshold: 0.85,
      coreTickers: ['SPY', 'QQQ'],
      method: 'PEARSON',
    },
    cache: { chainTTLSeconds: 300, snapshotTTLSeconds: 2 },
    timeouts: { massiveHTTPSeconds: 3 },
  };

  beforeEach(() => {
    job = new CorrelationMatrixJob();
    mockGetEngineConfig.mockReturnValue(defaultConfig);
    mockDbQuery.mockReset();
    mockGetDailyBars.mockReset();
  });

  describe('pearson', () => {
    test('returns 1 for identical series', () => {
      const x = [1, 2, 3, 4, 5];
      expect(job.pearson(x, x)).toBeCloseTo(1.0);
    });

    test('returns -1 for perfectly inverse series', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [5, 4, 3, 2, 1];
      expect(job.pearson(x, y)).toBeCloseTo(-1.0);
    });

    test('returns ~0 for uncorrelated series', () => {
      const x = [1, -1, 1, -1, 1, -1, 1, -1];
      const y = [1, 1, -1, -1, 1, 1, -1, -1];
      const r = job.pearson(x, y);
      expect(Math.abs(r)).toBeLessThan(0.3);
    });

    test('handles empty series', () => {
      expect(job.pearson([], [])).toBe(0);
    });

    test('returns 0 for constant series', () => {
      expect(job.pearson([5, 5, 5], [1, 2, 3])).toBe(0);
    });
  });

  describe('computePearsonMatrix', () => {
    test('builds symmetric matrix with 1.0 diagonal', () => {
      const tickers = ['SPY', 'QQQ', 'IWM'];
      const returns = [
        [0.01, 0.02, -0.01, 0.015],
        [0.012, 0.018, -0.008, 0.014],
        [0.005, 0.01, -0.015, 0.008],
      ];

      const matrix = job.computePearsonMatrix(tickers, returns);

      // Diagonal = 1
      expect(matrix['SPY']['SPY']).toBe(1.0);
      expect(matrix['QQQ']['QQQ']).toBe(1.0);
      expect(matrix['IWM']['IWM']).toBe(1.0);

      // Symmetric
      expect(matrix['SPY']['QQQ']).toBe(matrix['QQQ']['SPY']);
      expect(matrix['SPY']['IWM']).toBe(matrix['IWM']['SPY']);

      // SPY/QQQ should be highly correlated with these returns
      expect(matrix['SPY']['QQQ']).toBeGreaterThan(0.9);
    });
  });

  describe('buildUniverse', () => {
    test('combines core tickers with traded tickers', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{ underlying: 'AAPL' }, { underlying: 'MSFT' }],
      });

      const universe = await job.buildUniverse(['SPY', 'QQQ']);

      expect(universe).toContain('SPY');
      expect(universe).toContain('QQQ');
      expect(universe).toContain('AAPL');
      expect(universe).toContain('MSFT');
      expect(universe).toHaveLength(4);
    });

    test('deduplicates tickers', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{ underlying: 'SPY' }, { underlying: 'AAPL' }],
      });

      const universe = await job.buildUniverse(['SPY', 'QQQ']);
      const spyCount = universe.filter(t => t === 'SPY').length;
      expect(spyCount).toBe(1);
    });
  });

  describe('run', () => {
    test('computes matrix and persists', async () => {
      // buildUniverse
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      // getDailyBars for SPY
      mockGetDailyBars.mockResolvedValueOnce(
        Array.from({ length: 31 }, (_, i) => ({
          date: `2026-01-${String(i + 1).padStart(2, '0')}`,
          close: 500 + i * 0.5 + Math.sin(i) * 2,
          open: 499, high: 502, low: 498, volume: 1000000,
        }))
      );
      // getDailyBars for QQQ
      mockGetDailyBars.mockResolvedValueOnce(
        Array.from({ length: 31 }, (_, i) => ({
          date: `2026-01-${String(i + 1).padStart(2, '0')}`,
          close: 400 + i * 0.4 + Math.sin(i) * 1.5,
          open: 399, high: 402, low: 398, volume: 800000,
        }))
      );

      // Insert
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const result = await job.run();

      expect(result.tickers).toHaveLength(2);
      expect(result.tickers).toContain('SPY');
      expect(result.tickers).toContain('QQQ');
      expect(result.matrix['SPY']['QQQ']).toBeDefined();
      expect(result.sampleCount).toBeGreaterThan(0);
      expect(result.method).toBe('PEARSON');
    });

    test('excludes tickers with insufficient data', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ underlying: 'TINY' }] });

      // SPY: good data
      mockGetDailyBars.mockResolvedValueOnce(
        Array.from({ length: 31 }, (_, i) => ({
          date: `2026-01-${String(i + 1).padStart(2, '0')}`,
          close: 500 + i, open: 499, high: 502, low: 498, volume: 1000000,
        }))
      );
      // QQQ: good data
      mockGetDailyBars.mockResolvedValueOnce(
        Array.from({ length: 31 }, (_, i) => ({
          date: `2026-01-${String(i + 1).padStart(2, '0')}`,
          close: 400 + i, open: 399, high: 402, low: 398, volume: 800000,
        }))
      );
      // TINY: only 1 bar
      mockGetDailyBars.mockResolvedValueOnce([
        { date: '2026-01-01', close: 50, open: 49, high: 52, low: 48, volume: 100 },
      ]);

      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // insert

      const result = await job.run();

      expect(result.tickers).not.toContain('TINY');
      expect(result.tickers).toHaveLength(2);
    });
  });

  describe('getLatest', () => {
    test('returns null when empty', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      expect(await job.getLatest()).toBeNull();
    });

    test('maps row correctly', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          id: 'm1', computed_at: '2026-02-20T16:00:00Z',
          window_days: '30', tickers: ['SPY', 'QQQ'],
          matrix: { SPY: { SPY: 1, QQQ: 0.91 }, QQQ: { SPY: 0.91, QQQ: 1 } },
          method: 'PEARSON', sample_count: '28',
          source: 'MASSIVE_AGGS', confidence: '0.93',
        }],
      });

      const result = await job.getLatest();
      expect(result).not.toBeNull();
      expect(result!.matrix['SPY']['QQQ']).toBe(0.91);
      expect(result!.confidence).toBeCloseTo(0.93);
    });
  });
});
