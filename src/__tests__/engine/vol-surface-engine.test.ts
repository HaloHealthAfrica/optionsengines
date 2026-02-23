import { IVRegime, TermShape, GreekSource } from '../../engine/types/enums';
import type { OptionQuote } from '../../engine/data/MassiveOptionsService';

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

const mockGetOptionsSnapshot = jest.fn();
jest.mock('../../engine/data/MassiveOptionsService', () => ({
  massiveOptionsService: {
    getOptionsSnapshot: (...args: any[]) => mockGetOptionsSnapshot(...args),
  },
}));
jest.mock('../../services/redis-cache.service', () => ({
  redisCache: { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() },
}));

const mockGetSeries = jest.fn();
jest.mock('../../engine/intelligence/IVSeriesCollector', () => ({
  ivSeriesCollector: {
    getSeries: (...args: any[]) => mockGetSeries(...args),
  },
}));

import { VolSurfaceEngine } from '../../engine/intelligence/VolSurfaceEngine';

describe('VolSurfaceEngine', () => {
  let engine: VolSurfaceEngine;

  const defaultConfig = {
    volSurface: {
      termEpsilon: 0.02,
      frontDTERange: [7, 14],
      midDTE: 21,
      backDTERange: [45, 60],
      backFallbackRange: [30, 45],
      redisTTLMarketHours: 600,
      redisTTLAfterHours: 3600,
    },
    regime: {
      ivLowThreshold: 0.33,
      ivHighThreshold: 0.66,
      minIVSampleDays: 63,
    },
    cache: { chainTTLSeconds: 300, snapshotTTLSeconds: 2, snapshotMaxAgeAtUseSeconds: 30 },
    timeouts: { massiveHTTPSeconds: 3 },
  };

  beforeEach(() => {
    engine = new VolSurfaceEngine();
    mockGetEngineConfig.mockReturnValue(defaultConfig);
    mockDbQuery.mockReset();
    mockGetOptionsSnapshot.mockReset();
    mockGetSeries.mockReset();
  });

  describe('classifyTermShape', () => {
    test('CONTANGO when front < back - epsilon', () => {
      const result = engine.classifyTermShape(0.20, 0.30, 0.02);
      expect(result.termShape).toBe(TermShape.CONTANGO);
      expect(result.termSlope).toBeCloseTo(-0.10);
    });

    test('BACKWARDATION when front > back + epsilon', () => {
      const result = engine.classifyTermShape(0.30, 0.20, 0.02);
      expect(result.termShape).toBe(TermShape.BACKWARDATION);
      expect(result.termSlope).toBeCloseTo(0.10);
    });

    test('FLAT when within epsilon', () => {
      const result = engine.classifyTermShape(0.25, 0.26, 0.02);
      expect(result.termShape).toBe(TermShape.FLAT);
    });

    test('UNKNOWN when either anchor is null', () => {
      expect(engine.classifyTermShape(null, 0.25, 0.02).termShape).toBe(TermShape.UNKNOWN);
      expect(engine.classifyTermShape(0.25, null, 0.02).termShape).toBe(TermShape.UNKNOWN);
      expect(engine.classifyTermShape(null, null, 0.02).termShape).toBe(TermShape.UNKNOWN);
    });
  });

  describe('computeIVPercentile', () => {
    test('computes correct percentile', () => {
      const series = [0.15, 0.18, 0.20, 0.22, 0.25, 0.28, 0.30, 0.32, 0.35, 0.40];
      // current = 0.28 → 6 below (0.15,0.18,0.20,0.22,0.25,0.28 ... wait, 0.28 is not < 0.28)
      // below: 0.15, 0.18, 0.20, 0.22, 0.25 = 5 of 10 = 0.50
      const result = engine.computeIVPercentile(series, 0.28);
      expect(result).toBeCloseTo(0.50);
    });

    test('returns 0 when current is lowest', () => {
      const series = [0.20, 0.25, 0.30];
      expect(engine.computeIVPercentile(series, 0.10)).toBeCloseTo(0);
    });

    test('returns near 1 when current is highest', () => {
      const series = [0.10, 0.15, 0.20];
      expect(engine.computeIVPercentile(series, 0.50)).toBeCloseTo(1.0);
    });

    test('returns null when current is null', () => {
      expect(engine.computeIVPercentile([0.20], null)).toBeNull();
    });

    test('returns null when series is empty', () => {
      expect(engine.computeIVPercentile([], 0.20)).toBeNull();
    });
  });

  describe('classifyIVRegime', () => {
    test('LOW when percentile < threshold', () => {
      const result = engine.classifyIVRegime(0.20, 100, { ivLowThreshold: 0.33, ivHighThreshold: 0.66, minIVSampleDays: 63 });
      expect(result).toBe(IVRegime.LOW);
    });

    test('NEUTRAL when between thresholds', () => {
      const result = engine.classifyIVRegime(0.50, 100, { ivLowThreshold: 0.33, ivHighThreshold: 0.66, minIVSampleDays: 63 });
      expect(result).toBe(IVRegime.NEUTRAL);
    });

    test('HIGH when above threshold', () => {
      const result = engine.classifyIVRegime(0.80, 100, { ivLowThreshold: 0.33, ivHighThreshold: 0.66, minIVSampleDays: 63 });
      expect(result).toBe(IVRegime.HIGH);
    });

    test('UNKNOWN when insufficient samples', () => {
      const result = engine.classifyIVRegime(0.50, 30, { ivLowThreshold: 0.33, ivHighThreshold: 0.66, minIVSampleDays: 63 });
      expect(result).toBe(IVRegime.UNKNOWN);
    });

    test('UNKNOWN when percentile is null', () => {
      const result = engine.classifyIVRegime(null, 100, { ivLowThreshold: 0.33, ivHighThreshold: 0.66, minIVSampleDays: 63 });
      expect(result).toBe(IVRegime.UNKNOWN);
    });
  });

  describe('computeAndPersist', () => {
    test('computes full vol surface with series data', async () => {
      const now = new Date();
      const makeQ = (type: 'call' | 'put', dte: number, delta: number, iv: number): OptionQuote => {
        const exp = new Date(now.getTime() + dte * 24 * 60 * 60 * 1000);
        return {
          optionTicker: `O:SPY:${type}:${dte}`,
          underlyingTicker: 'SPY',
          contractType: type,
          expirationDate: exp.toISOString().split('T')[0],
          strikePrice: 500,
          bid: 4.00, ask: 4.40, mid: 4.20,
          volume: 1000, oi: 5000,
          iv, delta,
          gamma: 0.03, theta: -0.05, vega: 0.15,
          greekSource: GreekSource.MASSIVE,
          quoteTimestamp: now,
          underlyingPrice: 500,
        };
      };

      const quotes: OptionQuote[] = [
        makeQ('call', 10, 0.50, 0.28),
        makeQ('put', 10, -0.50, 0.30),
        makeQ('call', 21, 0.50, 0.25),
        makeQ('put', 21, -0.50, 0.27),
        makeQ('call', 50, 0.50, 0.22),
        makeQ('put', 50, -0.50, 0.24),
        makeQ('call', 21, 0.25, 0.20), // 25d call for skew
        makeQ('put', 21, -0.25, 0.32), // 25d put for skew
      ];

      mockGetOptionsSnapshot.mockResolvedValueOnce({ quotes });

      // 100 days of series data
      const series = Array.from({ length: 100 }, (_, i) => ({
        id: `s${i}`, underlying: 'SPY', date: `2026-01-${String(i + 1).padStart(2, '0')}`,
        atmDte: 21, callTicker: 'C', putTicker: 'P',
        callIv: 0.20 + i * 0.002, putIv: 0.22 + i * 0.002,
        atmIv: 0.21 + i * 0.002, source: 'MASSIVE_SNAPSHOT', recordedAt: new Date(),
      }));
      mockGetSeries.mockResolvedValueOnce(series);
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // insert

      const result = await engine.computeAndPersist({ underlying: 'SPY' });

      expect(result.underlying).toBe('SPY');
      expect(result.termShape).not.toBe(TermShape.UNKNOWN);
      expect(result.ivRegime).not.toBe(IVRegime.UNKNOWN);
      expect(result.sampleCount).toBe(100);
      expect(result.confidence).toBeCloseTo(100 / 252, 2);
      expect(result.skew25dRR).not.toBeNull();
    });

    test('handles snapshot fetch failure gracefully', async () => {
      mockGetOptionsSnapshot.mockRejectedValueOnce(new Error('API down'));
      mockGetSeries.mockResolvedValueOnce([]); // no series
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // insert

      const result = await engine.computeAndPersist({ underlying: 'SPY' });

      expect(result.termShape).toBe(TermShape.UNKNOWN);
      expect(result.ivRegime).toBe(IVRegime.UNKNOWN);
      expect(result.notes).toContain('Snapshot fetch failed');
    });

    test('handles empty series (UNKNOWN regime)', async () => {
      mockGetOptionsSnapshot.mockResolvedValueOnce({ quotes: [] });
      mockGetSeries.mockResolvedValueOnce([]);
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const result = await engine.computeAndPersist({ underlying: 'NEW' });

      expect(result.ivRegime).toBe(IVRegime.UNKNOWN);
      expect(result.sampleCount).toBe(0);
      expect(result.confidence).toBe(0);
    });
  });

  describe('getLatest', () => {
    test('returns null when no snapshots', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const result = await engine.getLatest('SPY');
      expect(result).toBeNull();
    });

    test('maps DB row correctly', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          id: 'snap-1', underlying: 'SPY', computed_at: '2026-02-20T16:00:00Z',
          window_days: '252', front_dte: '7', mid_dte: '21', back_dte: '45',
          iv_front: '0.28', iv_mid: '0.25', iv_back: '0.22',
          term_slope: '0.06', term_shape: 'BACKWARDATION',
          skew_25d_rr: '0.08', iv_percentile_252d: '0.55',
          iv_regime: 'NEUTRAL', sample_count: '200', confidence: '0.79',
          source: 'COMPUTED_FROM_MASSIVE', notes: null,
        }],
      });

      const result = await engine.getLatest('SPY');

      expect(result).not.toBeNull();
      expect(result!.termShape).toBe(TermShape.BACKWARDATION);
      expect(result!.ivFront).toBe(0.28);
      expect(result!.ivPercentile252d).toBe(0.55);
      expect(result!.confidence).toBeCloseTo(0.79);
    });
  });
});
