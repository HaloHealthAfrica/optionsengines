import { GreekSource, RejectionCode } from '../../engine/types/enums';

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisIsAvailable = jest.fn().mockReturnValue(true);

jest.mock('../../services/redis-cache.service', () => ({
  redisCache: {
    get: (...args: any[]) => mockRedisGet(...args),
    set: (...args: any[]) => mockRedisSet(...args),
    isAvailable: () => mockRedisIsAvailable(),
  },
}));
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
jest.mock('../../config/index', () => ({
  config: {
    logLevel: 'info', databaseUrl: '', dbPoolMax: 5, slowRequestMs: 1000,
    polygonApiKey: 'test-key',
    polygonBaseUrl: 'https://api.polygon.io',
  },
}));
jest.mock('../../engine/config/loader', () => ({
  getEngineConfig: () => ({
    cache: {
      chainTTLSeconds: 300,
      snapshotTTLSeconds: 2,
      snapshotMaxAgeAtUseSeconds: 30,
      underlyingPriceTTLSeconds: 5,
    },
    timeouts: { massiveHTTPSeconds: 3 },
  }),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import { MassiveOptionsService } from '../../engine/data/MassiveOptionsService';
import type { OptionQuote } from '../../engine/data/MassiveOptionsService';

describe('MassiveOptionsService', () => {
  let service: MassiveOptionsService;

  beforeEach(() => {
    service = new MassiveOptionsService();
    mockRedisGet.mockReset();
    mockRedisSet.mockReset();
    mockFetch.mockReset();
  });

  describe('getOptionsChain', () => {
    test('fetches chain from API and caches result', async () => {
      mockRedisGet.mockResolvedValueOnce(null); // cache miss
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'OK',
          results: [
            { ticker: 'O:SPY260220C00500000', underlying_ticker: 'SPY', contract_type: 'call', expiration_date: '2026-02-20', strike_price: 500 },
            { ticker: 'O:SPY260220P00500000', underlying_ticker: 'SPY', contract_type: 'put', expiration_date: '2026-02-20', strike_price: 500 },
          ],
          count: 2,
        }),
      });

      const result = await service.getOptionsChain('SPY');

      expect(result.underlying).toBe('SPY');
      expect(result.contracts).toHaveLength(2);
      expect(result.fromCache).toBe(false);
      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.stringContaining('chain:SPY'),
        expect.any(Object),
        300 // chainTTLSeconds
      );
    });

    test('returns cached chain on cache hit', async () => {
      const cached = {
        underlying: 'SPY',
        contracts: [{ ticker: 'O:SPY260220C00500000' }],
        fetchedAt: new Date().toISOString(),
        fromCache: false,
      };
      mockRedisGet.mockResolvedValueOnce(cached);

      const result = await service.getOptionsChain('SPY');

      expect(result.fromCache).toBe(true);
      expect(result.contracts).toHaveLength(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('throws NO_CHAIN_DATA when API returns empty results', async () => {
      mockRedisGet.mockResolvedValueOnce(null);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'OK', results: [] }),
      });

      await expect(service.getOptionsChain('INVALID'))
        .rejects.toThrow(expect.objectContaining({ code: RejectionCode.NO_CHAIN_DATA }));
    });
  });

  describe('getOptionsSnapshot', () => {
    test('fetches snapshots and maps to OptionQuote[]', async () => {
      mockRedisGet.mockResolvedValueOnce(null);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'OK',
          results: [{
            details: { ticker: 'O:SPY260220C00500000', contract_type: 'call', expiration_date: '2026-02-20', strike_price: 500 },
            last_quote: { bid: 4.50, ask: 4.70, midpoint: 4.60, last_updated: Date.now() },
            greeks: { delta: 0.45, gamma: 0.03, theta: -0.05, vega: 0.12 },
            implied_volatility: 0.25,
            day: { volume: 1500 },
            open_interest: 8000,
            underlying_asset: { price: 500, ticker: 'SPY' },
          }],
          count: 1,
        }),
      });

      const result = await service.getOptionsSnapshot('SPY');

      expect(result.quotes).toHaveLength(1);
      const q = result.quotes[0];
      expect(q.bid).toBe(4.50);
      expect(q.ask).toBe(4.70);
      expect(q.mid).toBe(4.60);
      expect(q.delta).toBe(0.45);
      expect(q.gamma).toBe(0.03);
      expect(q.iv).toBe(0.25);
      expect(q.volume).toBe(1500);
      expect(q.oi).toBe(8000);
      expect(q.greekSource).toBe(GreekSource.MASSIVE);
      expect(result.fromCache).toBe(false);
    });

    test('maps snapshot without greeks to MISSING source', async () => {
      mockRedisGet.mockResolvedValueOnce(null);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'OK',
          results: [{
            details: { ticker: 'O:SPY260220C00500000', contract_type: 'call', expiration_date: '2026-02-20', strike_price: 500 },
            last_quote: { bid: 4.50, ask: 4.70, midpoint: 4.60, last_updated: Date.now() },
            implied_volatility: 0.25,
            day: { volume: 500 },
            open_interest: 3000,
            underlying_asset: { price: 500, ticker: 'SPY' },
          }],
        }),
      });

      const result = await service.getOptionsSnapshot('SPY');
      expect(result.quotes[0].greekSource).toBe(GreekSource.MISSING);
      expect(result.quotes[0].delta).toBeNull();
    });

    test('throws NO_SNAPSHOT_DATA when empty', async () => {
      mockRedisGet.mockResolvedValueOnce(null);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'OK', results: [] }),
      });

      await expect(service.getOptionsSnapshot('INVALID'))
        .rejects.toThrow(expect.objectContaining({ code: RejectionCode.NO_SNAPSHOT_DATA }));
    });
  });

  describe('getUnderlyingPrice', () => {
    test('fetches price and caches it', async () => {
      mockRedisGet.mockResolvedValueOnce(null);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'OK',
          ticker: {
            day: { c: 500.50, o: 498, h: 502, l: 497, v: 50000000 },
            prevDay: { c: 499.00, o: 497, h: 500, l: 496, v: 45000000 },
            min: { c: 500.25, t: Date.now() },
            updated: Date.now(),
          },
        }),
      });

      const result = await service.getUnderlyingPrice('SPY');

      expect(result.price).toBe(500.25);
      expect(result.prevClose).toBe(499.00);
      expect(result.fromCache).toBe(false);
      expect(mockRedisSet).toHaveBeenCalled();
    });

    test('returns cached price on hit', async () => {
      mockRedisGet.mockResolvedValueOnce({
        price: 500, prevClose: 498, timestamp: new Date().toISOString(),
      });

      const result = await service.getUnderlyingPrice('SPY');
      expect(result.fromCache).toBe(true);
      expect(result.price).toBe(500);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('isQuoteStale', () => {
    test('returns false for fresh quote', () => {
      const quote: OptionQuote = {
        optionTicker: 'O:SPY', underlyingTicker: 'SPY', contractType: 'call',
        expirationDate: '2026-02-20', strikePrice: 500,
        bid: 4.50, ask: 4.70, mid: 4.60,
        volume: 100, oi: 1000, iv: 0.25,
        delta: 0.45, gamma: 0.03, theta: -0.05, vega: 0.12,
        greekSource: GreekSource.MASSIVE,
        quoteTimestamp: new Date(), // fresh
        underlyingPrice: 500,
      };
      expect(service.isQuoteStale(quote)).toBe(false);
    });

    test('returns true for stale quote (> 30s)', () => {
      const quote: OptionQuote = {
        optionTicker: 'O:SPY', underlyingTicker: 'SPY', contractType: 'call',
        expirationDate: '2026-02-20', strikePrice: 500,
        bid: 4.50, ask: 4.70, mid: 4.60,
        volume: 100, oi: 1000, iv: 0.25,
        delta: 0.45, gamma: 0.03, theta: -0.05, vega: 0.12,
        greekSource: GreekSource.MASSIVE,
        quoteTimestamp: new Date(Date.now() - 35000), // 35s old
        underlyingPrice: 500,
      };
      expect(service.isQuoteStale(quote)).toBe(true);
    });
  });

  describe('HTTP error handling', () => {
    test('throws on non-OK HTTP response', async () => {
      mockRedisGet.mockResolvedValueOnce(null);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'Rate limited',
      });

      await expect(service.getOptionsChain('SPY'))
        .rejects.toThrow('Massive API 429');
    });

    test('throws on API ERROR status in response', async () => {
      mockRedisGet.mockResolvedValueOnce(null);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ERROR', error: 'Invalid ticker' }),
      });

      await expect(service.getOptionsChain('BADTICKER'))
        .rejects.toThrow('Invalid ticker');
    });

    test('throws MASSIVE_TIMEOUT on fetch abort', async () => {
      mockRedisGet.mockResolvedValueOnce(null);
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(service.getOptionsChain('SPY'))
        .rejects.toThrow('timeout');
    });
  });

  describe('getDailyBars', () => {
    test('fetches and maps daily bars', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'OK',
          resultsCount: 2,
          results: [
            { t: 1708387200000, o: 498, h: 502, l: 497, c: 500, v: 50000000 },
            { t: 1708473600000, o: 500, h: 505, l: 499, c: 503, v: 48000000 },
          ],
        }),
      });

      const bars = await service.getDailyBars('SPY', '2024-02-19', '2024-02-20');

      expect(bars).toHaveLength(2);
      expect(bars[0].close).toBe(500);
      expect(bars[1].close).toBe(503);
    });

    test('returns empty array when no results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'OK', resultsCount: 0 }),
      });

      const bars = await service.getDailyBars('SPY', '2024-02-19', '2024-02-20');
      expect(bars).toHaveLength(0);
    });
  });
});
