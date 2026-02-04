/**
 * Property-Based Test: API Fallback Behavior
 * Property 8: For any market data request, if the primary API (Alpaca) fails,
 * the system should automatically fallback to the backup API (TwelveData)
 * Validates: Requirements 2.2, 18.5
 */

import fc from 'fast-check';
import { MarketDataService } from '../../services/market-data.js';
import { AlpacaClient } from '../../services/providers/alpaca-client.js';
import { TwelveDataClient } from '../../services/providers/twelvedata-client.js';
import { PolygonClient } from '../../services/providers/polygon-client.js';
import { MarketDataClient } from '../../services/providers/marketdata-client.js';
import { cache } from '../../services/cache.service.js';
import { rateLimiter } from '../../services/rate-limiter.service.js';

describe('Property 8: API Fallback Behavior', () => {
  jest.setTimeout(120000);
  function createService() {
    cache.clear();
    rateLimiter.waitForToken = jest.fn().mockResolvedValue(true) as any;
    rateLimiter.getAllStats = jest.fn().mockReturnValue([]) as any;

    const mockAlpaca = {
      getCandles: jest.fn(),
      getLatestQuote: jest.fn(),
      getOptionPrice: jest.fn(),
      isMarketOpen: jest.fn(),
      getMarketHours: jest.fn(),
    } as unknown as jest.Mocked<AlpacaClient>;

    const mockTwelveData = {
      getCandles: jest.fn(),
      getLatestQuote: jest.fn(),
      getOptionPrice: jest.fn(),
      isMarketOpen: jest.fn(),
      getMarketHours: jest.fn(),
    } as unknown as jest.Mocked<TwelveDataClient>;

    const mockPolygon = {
      getCandles: jest.fn(),
      getLatestQuote: jest.fn(),
      getOptionPrice: jest.fn(),
      isMarketOpen: jest.fn(),
      getMarketHours: jest.fn(),
    } as unknown as jest.Mocked<PolygonClient>;

    const mockMarketData = {
      getCandles: jest.fn(),
      getLatestQuote: jest.fn(),
      getOptionPrice: jest.fn(),
      isMarketOpen: jest.fn(),
      getMarketHours: jest.fn(),
    } as unknown as jest.Mocked<MarketDataClient>;

    const marketDataService = new MarketDataService();
    (marketDataService as any).alpaca = mockAlpaca;
    (marketDataService as any).polygon = mockPolygon;
    (marketDataService as any).marketData = mockMarketData;
    (marketDataService as any).twelveData = mockTwelveData;
    (marketDataService as any).providerPriority = ['alpaca', 'twelvedata'];

    return { marketDataService, mockAlpaca, mockTwelveData };
  }

  // Arbitraries
  const symbolArbitrary = fc.constantFrom('SPY', 'QQQ', 'AAPL', 'TSLA', 'MSFT');
  const timeframeArbitrary = fc.constantFrom('1m', '5m', '15m', '1h', '1d');
  const priceArbitrary = fc.float({ min: 100, max: 500, noNaN: true });

  const candleArbitrary = fc.record({
    timestamp: fc.date(),
    open: priceArbitrary,
    high: priceArbitrary,
    low: priceArbitrary,
    close: priceArbitrary,
    volume: fc.integer({ min: 1000, max: 1000000 }),
  });

  test('Property: When Alpaca fails, system falls back to TwelveData for candles', async () => {
    await fc.assert(
      fc.asyncProperty(
        symbolArbitrary,
        timeframeArbitrary,
        fc.array(candleArbitrary, { minLength: 2, maxLength: 10 }),
        async (symbol, timeframe, expectedCandles) => {
          const { marketDataService, mockAlpaca, mockTwelveData } = createService();
          mockAlpaca.getCandles.mockRejectedValue(new Error('Alpaca API error'));
          mockTwelveData.getCandles.mockResolvedValue(expectedCandles);

          // Execute
          const result = await marketDataService.getCandles(symbol, timeframe, 100);

          // Verify: TwelveData was called as fallback
          expect(mockTwelveData.getCandles).toHaveBeenCalledWith(symbol, timeframe, 100);
          expect(result).toEqual(expectedCandles);
        }
      ),
      { numRuns: 3 }
    );
  });

  test('Property: When Alpaca fails, system falls back to TwelveData for prices', async () => {
    await fc.assert(
      fc.asyncProperty(symbolArbitrary, priceArbitrary, async (symbol, expectedPrice) => {
        const { marketDataService, mockAlpaca, mockTwelveData } = createService();
        mockAlpaca.getLatestQuote.mockRejectedValue(new Error('Alpaca API error'));
        mockTwelveData.getLatestQuote.mockResolvedValue({ price: expectedPrice });

        // Execute
        const result = await marketDataService.getStockPrice(symbol);

        // Verify: TwelveData was called as fallback
        expect(mockTwelveData.getLatestQuote).toHaveBeenCalledWith(symbol);
        expect(result).toBe(expectedPrice);
      }),
      { numRuns: 3 }
    );
  });

  test('Property: When Alpaca succeeds, TwelveData is not called', async () => {
    await fc.assert(
      fc.asyncProperty(
        symbolArbitrary,
        timeframeArbitrary,
        fc.array(candleArbitrary, { minLength: 2, maxLength: 10 }),
        async (symbol, timeframe, expectedCandles) => {
          const { marketDataService, mockAlpaca, mockTwelveData } = createService();
          mockAlpaca.getCandles.mockResolvedValue(expectedCandles);

          // Execute
          const result = await marketDataService.getCandles(symbol, timeframe, 100);

          // Verify: Only Alpaca was called, not TwelveData
          expect(mockAlpaca.getCandles).toHaveBeenCalledWith(symbol, timeframe, 100);
          expect(mockTwelveData.getCandles).not.toHaveBeenCalled();
          expect(result).toEqual(expectedCandles);
        }
      ),
      { numRuns: 3 }
    );
  });

  test('Property: When both providers fail, error is thrown', async () => {
    await fc.assert(
      fc.asyncProperty(symbolArbitrary, timeframeArbitrary, async (symbol, timeframe) => {
        const { marketDataService, mockAlpaca, mockTwelveData } = createService();
        mockAlpaca.getCandles.mockRejectedValue(new Error('Alpaca API error'));
        mockTwelveData.getCandles.mockRejectedValue(new Error('TwelveData API error'));

        // Execute & Verify: Error is thrown
        await expect(marketDataService.getCandles(symbol, timeframe, 100)).rejects.toThrow();

        // Both providers should have been attempted
        expect(mockAlpaca.getCandles).toHaveBeenCalled();
        expect(mockTwelveData.getCandles).toHaveBeenCalled();
      }),
      { numRuns: 3 }
    );
  });

  test('Property: Circuit breaker opens after multiple failures', async () => {
    await fc.assert(
      fc.asyncProperty(
        symbolArbitrary,
        timeframeArbitrary,
        fc.array(candleArbitrary, { minLength: 2, maxLength: 10 }),
        async (symbol, timeframe, fallbackCandles) => {
          const { marketDataService, mockAlpaca, mockTwelveData } = createService();
          mockAlpaca.getCandles.mockRejectedValue(new Error('Alpaca API error'));
          mockTwelveData.getCandles.mockResolvedValue(fallbackCandles);

          // Execute: Make 5 requests to trigger circuit breaker
          for (let i = 0; i < 5; i++) {
            cache.clear(); // Clear cache to force API call
            await marketDataService.getCandles(symbol, timeframe, 100);
          }

          // Verify: Circuit breaker should be open for Alpaca
          const status = marketDataService.getCircuitBreakerStatus();
          expect(status.alpaca.state).toBe('open');
          expect(status.alpaca.failures).toBeGreaterThanOrEqual(5);
        }
      ),
      { numRuns: 2 }
    );
  });

  test('Property: Cached data prevents fallback attempts', async () => {
    await fc.assert(
      fc.asyncProperty(
        symbolArbitrary,
        timeframeArbitrary,
        fc.array(candleArbitrary, { minLength: 2, maxLength: 10 }),
        async (symbol, timeframe, expectedCandles) => {
          const { marketDataService, mockAlpaca, mockTwelveData } = createService();
          mockAlpaca.getCandles.mockResolvedValue(expectedCandles);

          // Execute: First call
          await marketDataService.getCandles(symbol, timeframe, 100);

          // Reset mocks
          mockAlpaca.getCandles.mockClear();
          mockTwelveData.getCandles.mockClear();

          // Execute: Second call (should use cache)
          const result = await marketDataService.getCandles(symbol, timeframe, 100);

          // Verify: No API calls were made (cache hit)
          expect(mockAlpaca.getCandles).not.toHaveBeenCalled();
          expect(mockTwelveData.getCandles).not.toHaveBeenCalled();
          expect(result).toEqual(expectedCandles);
        }
      ),
      { numRuns: 2 }
    );
  });
});
