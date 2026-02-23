import { GreekSource } from '../../engine/types/enums';
import type { OptionQuote } from '../../engine/data/MassiveOptionsService';

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../config/index', () => ({
  config: { logLevel: 'info', databaseUrl: '', dbPoolMax: 5, slowRequestMs: 1000, polygonApiKey: 'test' },
}));
jest.mock('../../engine/config/loader', () => ({
  getEngineConfig: () => ({
    cache: { chainTTLSeconds: 300, snapshotTTLSeconds: 2, snapshotMaxAgeAtUseSeconds: 30, underlyingPriceTTLSeconds: 5 },
    timeouts: { massiveHTTPSeconds: 3 },
  }),
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
  redisCache: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
}));

import { IVSeriesCollector } from '../../engine/intelligence/IVSeriesCollector';

function makeQuote(overrides: Partial<OptionQuote> = {}): OptionQuote {
  const now = new Date();
  // 21 DTE from now
  const exp = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000);
  const expStr = exp.toISOString().split('T')[0];

  return {
    optionTicker: 'O:SPY260320C00500000',
    underlyingTicker: 'SPY',
    contractType: 'call',
    expirationDate: expStr,
    strikePrice: 500,
    bid: 4.50,
    ask: 4.80,
    mid: 4.65,
    volume: 1200,
    oi: 5000,
    iv: 0.22,
    delta: 0.50,
    gamma: 0.03,
    theta: -0.05,
    vega: 0.15,
    greekSource: GreekSource.MASSIVE,
    quoteTimestamp: now,
    underlyingPrice: 500,
    ...overrides,
  };
}

describe('IVSeriesCollector', () => {
  let collector: IVSeriesCollector;

  beforeEach(() => {
    collector = new IVSeriesCollector();
    mockDbQuery.mockReset();
    mockGetOptionsSnapshot.mockReset();
  });

  describe('collect', () => {
    test('collects ATM IV when valid call and put available', async () => {
      const callQuote = makeQuote({ contractType: 'call', delta: 0.50, iv: 0.22, optionTicker: 'CALL' });
      const putQuote = makeQuote({ contractType: 'put', delta: -0.50, iv: 0.24, optionTicker: 'PUT' });

      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // no existing
      mockGetOptionsSnapshot.mockResolvedValueOnce({ quotes: [callQuote, putQuote] });
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // insert

      const result = await collector.collect('SPY');

      expect(result.success).toBe(true);
      expect(result.row).not.toBeNull();
      expect(result.row!.callIv).toBe(0.22);
      expect(result.row!.putIv).toBe(0.24);
      expect(result.row!.atmIv).toBeCloseTo(0.23);
    });

    test('skips if already collected today', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'existing' }] });

      const result = await collector.collect('SPY');

      expect(result.success).toBe(true);
      expect(result.row).toBeNull();
      expect(result.failureReason).toContain('Already collected');
    });

    test('records failure when no ATM candidates in DTE range', async () => {
      // Quote with far-out DTE
      const farQuote = makeQuote({
        expirationDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      });

      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // no existing
      mockGetOptionsSnapshot.mockResolvedValueOnce({ quotes: [farQuote] });
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // failure record

      const result = await collector.collect('SPY');

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('NO_ATM_CANDIDATES');
    });

    test('records failure when missing put leg', async () => {
      const callOnly = makeQuote({ contractType: 'call', delta: 0.50, iv: 0.22 });

      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      mockGetOptionsSnapshot.mockResolvedValueOnce({ quotes: [callOnly] });
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // failure

      const result = await collector.collect('SPY');

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('MISSING_ATM_LEG');
    });

    test('records failure when IV is null', async () => {
      const callQuote = makeQuote({ contractType: 'call', delta: 0.50, iv: null });
      const putQuote = makeQuote({ contractType: 'put', delta: -0.50, iv: 0.24 });

      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      mockGetOptionsSnapshot.mockResolvedValueOnce({ quotes: [callQuote, putQuote] });
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // failure

      const result = await collector.collect('SPY');

      // Call has no IV → findClosestATM skips it → MISSING_ATM_LEG for call
      expect(result.success).toBe(false);
    });

    test('handles snapshot fetch error', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      mockGetOptionsSnapshot.mockRejectedValueOnce(new Error('Network error'));
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // failure record

      const result = await collector.collect('SPY');

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('COLLECTION_ERROR');
    });
  });

  describe('collectAll', () => {
    test('processes multiple underlyings', async () => {
      const callQuote = makeQuote({ contractType: 'call', delta: 0.50, iv: 0.22 });
      const putQuote = makeQuote({ contractType: 'put', delta: -0.50, iv: 0.24 });

      // SPY
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      mockGetOptionsSnapshot.mockResolvedValueOnce({ quotes: [callQuote, putQuote] });
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      // QQQ
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      mockGetOptionsSnapshot.mockRejectedValueOnce(new Error('fail'));
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const results = await collector.collectAll(['SPY', 'QQQ']);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
    });
  });

  describe('getSeries', () => {
    test('returns mapped series rows', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          { id: 's1', underlying: 'SPY', date: '2026-02-20', atm_dte: '21', call_ticker: 'C1', put_ticker: 'P1', call_iv: '0.22', put_iv: '0.24', atm_iv: '0.23', source: 'MASSIVE_SNAPSHOT', recorded_at: new Date().toISOString() },
          { id: 's2', underlying: 'SPY', date: '2026-02-19', atm_dte: '22', call_ticker: 'C2', put_ticker: 'P2', call_iv: '0.21', put_iv: '0.23', atm_iv: '0.22', source: 'MASSIVE_SNAPSHOT', recorded_at: new Date().toISOString() },
        ],
      });

      const series = await collector.getSeries('SPY', 100);

      expect(series).toHaveLength(2);
      expect(series[0].atmIv).toBe(0.23);
      expect(series[1].atmIv).toBe(0.22);
    });
  });
});
