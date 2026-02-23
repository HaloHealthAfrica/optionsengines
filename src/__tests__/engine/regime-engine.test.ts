import { IVRegime, TermShape } from '../../engine/types/enums';

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../config/index', () => ({
  config: { logLevel: 'info', databaseUrl: '', dbPoolMax: 5, slowRequestMs: 1000 },
}));

const mockGetEngineConfig = jest.fn();
jest.mock('../../engine/config/loader', () => ({
  getEngineConfig: () => mockGetEngineConfig(),
}));

const mockDbQuery = jest.fn();
jest.mock('../../services/database.service', () => ({
  db: { query: (...args: any[]) => mockDbQuery(...args) },
}));

import { RegimeEngine } from '../../engine/regime/RegimeEngine';

describe('RegimeEngine', () => {
  let engine: RegimeEngine;

  const defaultConfig = {
    regime: {
      ivLowThreshold: 0.33,
      ivHighThreshold: 0.66,
      minIVSampleDays: 63,
      hysteresisCount: 3,
      blockTradesOnUnknownIV: false,
    },
    volSurface: {
      termEpsilon: 0.02,
    },
  };

  beforeEach(() => {
    engine = new RegimeEngine();
    mockGetEngineConfig.mockReturnValue(defaultConfig);
    mockDbQuery.mockReset();
  });

  // ─── IV Percentile ───

  describe('computeIVPercentile', () => {
    test('returns correct percentile', () => {
      const series = [0.15, 0.18, 0.20, 0.22, 0.25, 0.28, 0.30, 0.32, 0.35, 0.40];
      // current = 0.27, 5 values below (0.15, 0.18, 0.20, 0.22, 0.25)
      expect(engine.computeIVPercentile(series, 0.27)).toBe(0.5);
    });

    test('returns 0 when current is lowest', () => {
      const series = [0.20, 0.25, 0.30];
      expect(engine.computeIVPercentile(series, 0.10)).toBe(0);
    });

    test('returns 1 when current is highest', () => {
      const series = [0.10, 0.15, 0.20];
      expect(engine.computeIVPercentile(series, 0.50)).toBe(1);
    });

    test('returns null when currentIV is null', () => {
      expect(engine.computeIVPercentile([0.20, 0.25], null)).toBeNull();
    });

    test('returns null when series is empty', () => {
      expect(engine.computeIVPercentile([], 0.25)).toBeNull();
    });
  });

  // ─── IV Regime Classification ───

  describe('classifyIVRegime', () => {
    const cfg = { ivLowThreshold: 0.33, ivHighThreshold: 0.66, minIVSampleDays: 63 };

    test('LOW when percentile < 0.33', () => {
      expect(engine.classifyIVRegime(0.20, 100, cfg)).toBe(IVRegime.LOW);
    });

    test('NEUTRAL when percentile between thresholds', () => {
      expect(engine.classifyIVRegime(0.50, 100, cfg)).toBe(IVRegime.NEUTRAL);
    });

    test('HIGH when percentile > 0.66', () => {
      expect(engine.classifyIVRegime(0.80, 100, cfg)).toBe(IVRegime.HIGH);
    });

    test('UNKNOWN when percentile is null', () => {
      expect(engine.classifyIVRegime(null, 100, cfg)).toBe(IVRegime.UNKNOWN);
    });

    test('UNKNOWN when sample count below minimum', () => {
      expect(engine.classifyIVRegime(0.50, 30, cfg)).toBe(IVRegime.UNKNOWN);
    });

    test('boundary: exactly at low threshold → LOW', () => {
      expect(engine.classifyIVRegime(0.32, 100, cfg)).toBe(IVRegime.LOW);
    });

    test('boundary: exactly at high threshold → NEUTRAL', () => {
      expect(engine.classifyIVRegime(0.66, 100, cfg)).toBe(IVRegime.NEUTRAL);
    });
  });

  // ─── Term Shape ───

  describe('classifyTermShape', () => {
    test('CONTANGO when front < back by more than epsilon', () => {
      expect(engine.classifyTermShape(0.20, 0.25)).toBe(TermShape.CONTANGO);
    });

    test('BACKWARDATION when front > back by more than epsilon', () => {
      expect(engine.classifyTermShape(0.30, 0.25)).toBe(TermShape.BACKWARDATION);
    });

    test('FLAT when within epsilon band', () => {
      expect(engine.classifyTermShape(0.25, 0.26)).toBe(TermShape.FLAT);
    });

    test('UNKNOWN when frontIV is null', () => {
      expect(engine.classifyTermShape(null, 0.25)).toBe(TermShape.UNKNOWN);
    });

    test('UNKNOWN when backIV is null', () => {
      expect(engine.classifyTermShape(0.25, null)).toBe(TermShape.UNKNOWN);
    });
  });

  // ─── Confidence ───

  describe('computeConfidence', () => {
    test('returns 1.0 for 252+ samples', () => {
      expect(engine.computeConfidence(252)).toBe(1);
      expect(engine.computeConfidence(300)).toBe(1);
    });

    test('returns proportional value for fewer samples', () => {
      expect(engine.computeConfidence(126)).toBeCloseTo(0.5, 2);
    });

    test('returns 0 for 0 samples', () => {
      expect(engine.computeConfidence(0)).toBe(0);
    });
  });

  // ─── Block Trade Check ───

  describe('shouldBlockTrade', () => {
    test('does not block when blockTradesOnUnknownIV is false', () => {
      const regime = {
        id: '1', underlying: 'SPY', computedAt: new Date(),
        ivPercentile: null, ivRegime: IVRegime.UNKNOWN, termShape: TermShape.UNKNOWN,
        confidence: 0, hysteresisCount: 0, source: 'COMPUTED',
      };
      expect(engine.shouldBlockTrade(regime).blocked).toBe(false);
    });

    test('blocks when UNKNOWN and blockTradesOnUnknownIV is true', () => {
      mockGetEngineConfig.mockReturnValue({
        ...defaultConfig,
        regime: { ...defaultConfig.regime, blockTradesOnUnknownIV: true },
      });

      const regime = {
        id: '1', underlying: 'SPY', computedAt: new Date(),
        ivPercentile: null, ivRegime: IVRegime.UNKNOWN, termShape: TermShape.UNKNOWN,
        confidence: 0, hysteresisCount: 0, source: 'COMPUTED',
      };
      expect(engine.shouldBlockTrade(regime).blocked).toBe(true);
    });

    test('does not block NEUTRAL regime', () => {
      mockGetEngineConfig.mockReturnValue({
        ...defaultConfig,
        regime: { ...defaultConfig.regime, blockTradesOnUnknownIV: true },
      });

      const regime = {
        id: '1', underlying: 'SPY', computedAt: new Date(),
        ivPercentile: 0.50, ivRegime: IVRegime.NEUTRAL, termShape: TermShape.CONTANGO,
        confidence: 0.5, hysteresisCount: 0, source: 'COMPUTED',
      };
      expect(engine.shouldBlockTrade(regime).blocked).toBe(false);
    });
  });

  // ─── Compute and Persist (full pipeline) ───

  describe('computeAndPersist', () => {
    test('computes and persists regime snapshot (no prior snapshot)', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [] }) // getLatest
        .mockResolvedValueOnce({ rows: [] }); // persist

      const series = Array.from({ length: 100 }, (_, i) => 0.15 + (i / 100) * 0.30);
      const result = await engine.computeAndPersist({
        underlying: 'SPY',
        currentATMIV: 0.30,
        ivDailySeries: series,
        frontIV: 0.22,
        midIV: 0.25,
        backIV: 0.28,
      });

      expect(result.underlying).toBe('SPY');
      expect(result.ivRegime).not.toBe(IVRegime.UNKNOWN);
      expect(result.termShape).toBe(TermShape.CONTANGO);
      expect(result.confidence).toBeCloseTo(100 / 252, 2);
      expect(result.hysteresisCount).toBe(0);
      expect(mockDbQuery).toHaveBeenCalledTimes(2);
    });

    test('applies hysteresis when regime changes', async () => {
      // Previous snapshot was HIGH
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 'prev-1', underlying: 'SPY', computed_at: new Date().toISOString(),
            iv_percentile: '0.80', iv_regime: 'HIGH', term_shape: 'CONTANGO',
            confidence: '0.50', hysteresis_count: '0', source: 'COMPUTED',
          }],
        })
        .mockResolvedValueOnce({ rows: [] }); // persist

      // Now computing LOW (percentile < 0.33)
      const series = Array.from({ length: 100 }, (_, i) => 0.15 + (i / 100) * 0.30);
      const result = await engine.computeAndPersist({
        underlying: 'SPY',
        currentATMIV: 0.16, // very low
        ivDailySeries: series,
        frontIV: 0.16,
        midIV: null,
        backIV: null,
      });

      // Should keep HIGH (hysteresis not yet exceeded — count=1 < threshold=3)
      expect(result.ivRegime).toBe(IVRegime.HIGH);
      expect(result.hysteresisCount).toBe(1);
    });
  });
});
