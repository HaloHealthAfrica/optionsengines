/**
 * Property-Based Test: Indicator Derivation Without API Calls
 * Property 7: For any cached OHLCV data, deriving technical indicators
 * (EMA, ATR, Bollinger Bands, Keltner Channels) should not trigger additional API calls
 * Validates: Requirements 2.5
 */

import fc from 'fast-check';
import { MarketDataService } from '../../services/market-data.js';
import { IndicatorService } from '../../services/indicators.js';
import { AlpacaClient } from '../../services/providers/alpaca-client.js';
import { MarketDataClient } from '../../services/providers/marketdata-client.js';
import { TwelveDataClient } from '../../services/providers/twelvedata-client.js';
import { cache } from '../../services/cache.service.js';

// Mock the provider clients
jest.mock('../../services/providers/alpaca-client.js');
jest.mock('../../services/providers/marketdata-client.js');
jest.mock('../../services/providers/twelvedata-client.js');

describe('Property 7: Indicator Derivation Without API Calls', () => {
  let marketDataService: MarketDataService;
  let indicatorService: IndicatorService;
  let mockAlpaca: jest.Mocked<AlpacaClient>;
  let mockMarketData: jest.Mocked<MarketDataClient>;
  let mockTwelveData: jest.Mocked<TwelveDataClient>;

  beforeEach(() => {
    cache.clear();

    mockAlpaca = new AlpacaClient() as jest.Mocked<AlpacaClient>;
    mockMarketData = new MarketDataClient() as jest.Mocked<MarketDataClient>;
    mockTwelveData = new TwelveDataClient() as jest.Mocked<TwelveDataClient>;

    marketDataService = new MarketDataService();
    indicatorService = new IndicatorService();

    (marketDataService as any).alpaca = mockAlpaca;
    (marketDataService as any).marketData = mockMarketData;
    (marketDataService as any).twelveData = mockTwelveData;
  });

  afterEach(() => {
    cache.clear();
  });

  // Arbitraries
  const priceArbitrary = fc.float({ min: 100, max: 500, noNaN: true });

  const candleArbitrary = fc.record({
    timestamp: fc.date(),
    open: priceArbitrary,
    high: priceArbitrary,
    low: priceArbitrary,
    close: priceArbitrary,
    volume: fc.integer({ min: 1000, max: 1000000 }),
  });

  const candlesArbitrary = fc.array(candleArbitrary, { minLength: 200, maxLength: 200 });

  test('Property: Deriving indicators from cached candles does not trigger API calls', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('SPY', 'QQQ', 'AAPL'),
        fc.constantFrom('5m', '15m', '1h'),
        candlesArbitrary,
        async (symbol, timeframe, candles) => {
          // Setup: Cache candles (simulate previous API call)
          mockMarketData.getCandles.mockResolvedValue(candles);
          await marketDataService.getCandles(symbol, timeframe, 200);

          // Clear mock call history
          mockMarketData.getCandles.mockClear();
          mockAlpaca.getCandles.mockClear();
          mockTwelveData.getCandles.mockClear();

          // Execute: Get indicators (should use cached candles)
          const indicators = await marketDataService.getIndicators(symbol, timeframe);

          // Verify: No additional API calls were made
          expect(mockMarketData.getCandles).not.toHaveBeenCalled();
          expect(mockAlpaca.getCandles).not.toHaveBeenCalled();
          expect(mockTwelveData.getCandles).not.toHaveBeenCalled();

          // Verify: Indicators were calculated
          expect(indicators.ema8).toBeDefined();
          expect(indicators.ema13).toBeDefined();
          expect(indicators.ema21).toBeDefined();
          expect(indicators.ema48).toBeDefined();
          expect(indicators.ema200).toBeDefined();
          expect(indicators.atr).toBeDefined();
          expect(indicators.bollingerBands).toBeDefined();
          expect(indicators.keltnerChannels).toBeDefined();
          expect(indicators.ttmSqueeze).toBeDefined();
        }
      ),
      { numRuns: 30 }
    );
  });

  test('Property: EMA calculation is deterministic', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(priceArbitrary, { minLength: 50, maxLength: 100 }),
        fc.integer({ min: 8, max: 50 }),
        async (prices, period) => {
          // Execute: Calculate EMA twice with same inputs
          const ema1 = indicatorService.calculateEMA(prices, period);
          const ema2 = indicatorService.calculateEMA(prices, period);

          // Verify: Results are identical
          expect(ema1).toEqual(ema2);
          expect(ema1.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('Property: ATR calculation requires no external data', async () => {
    await fc.assert(
      fc.asyncProperty(candlesArbitrary, async (candles) => {
        // Execute: Calculate ATR from candles only
        const atr = indicatorService.calculateATR(candles, 14);

        // Verify: ATR was calculated
        expect(atr).toBeDefined();
        expect(Array.isArray(atr)).toBe(true);

        // Verify: ATR values are non-negative
        atr.forEach((value) => {
          expect(value).toBeGreaterThanOrEqual(0);
        });
      }),
      { numRuns: 30 }
    );
  });

  test('Property: Bollinger Bands calculation is self-contained', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(priceArbitrary, { minLength: 50, maxLength: 100 }),
        async (prices) => {
          // Execute: Calculate Bollinger Bands
          const bb = indicatorService.calculateBollingerBands(prices, 20, 2);

          // Verify: All bands calculated
          expect(bb.upper).toBeDefined();
          expect(bb.middle).toBeDefined();
          expect(bb.lower).toBeDefined();

          // Verify: Upper > Middle > Lower (for all values)
          for (let i = 0; i < bb.upper.length; i++) {
            expect(bb.upper[i]).toBeGreaterThanOrEqual(bb.middle[i]);
            expect(bb.middle[i]).toBeGreaterThanOrEqual(bb.lower[i]);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  test('Property: Keltner Channels calculation uses only candle data', async () => {
    await fc.assert(
      fc.asyncProperty(candlesArbitrary, async (candles) => {
        // Execute: Calculate Keltner Channels
        const kc = indicatorService.calculateKeltnerChannels(candles, 20, 1.5);

        // Verify: All channels calculated
        expect(kc.upper).toBeDefined();
        expect(kc.middle).toBeDefined();
        expect(kc.lower).toBeDefined();

        // Verify: Upper > Middle > Lower
        for (let i = 0; i < kc.upper.length; i++) {
          expect(kc.upper[i]).toBeGreaterThanOrEqual(kc.middle[i]);
          expect(kc.middle[i]).toBeGreaterThanOrEqual(kc.lower[i]);
        }
      }),
      { numRuns: 30 }
    );
  });

  test('Property: TTM Squeeze state is binary (on or off)', async () => {
    await fc.assert(
      fc.asyncProperty(candlesArbitrary, async (candles) => {
        // Execute: Calculate TTM Squeeze
        const ttm = indicatorService.calculateTTMSqueeze(candles);

        // Verify: State is either 'on' or 'off'
        expect(['on', 'off']).toContain(ttm.state);

        // Verify: Momentum is a number
        expect(typeof ttm.momentum).toBe('number');
        expect(isNaN(ttm.momentum)).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test('Property: Indicator caching prevents redundant calculations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('SPY', 'QQQ'),
        fc.constantFrom('5m', '1h'),
        candlesArbitrary,
        async (symbol, timeframe, candles) => {
          // Setup: First call calculates and caches
          mockMarketData.getCandles.mockResolvedValue(candles);
          const indicators1 = await marketDataService.getIndicators(symbol, timeframe);

          // Clear API mocks
          mockMarketData.getCandles.mockClear();
          mockAlpaca.getCandles.mockClear();

          // Execute: Second call should use cache
          const indicators2 = await marketDataService.getIndicators(symbol, timeframe);

          // Verify: No API calls on second request
          expect(mockMarketData.getCandles).not.toHaveBeenCalled();
          expect(mockAlpaca.getCandles).not.toHaveBeenCalled();

          // Verify: Same indicators returned
          expect(indicators1).toEqual(indicators2);
        }
      ),
      { numRuns: 20 }
    );
  });

  test('Property: All indicators have consistent array lengths', async () => {
    await fc.assert(
      fc.asyncProperty(candlesArbitrary, async (candles) => {
        // Execute: Derive all indicators
        const indicators = indicatorService.deriveIndicators(candles);

        // Verify: Bollinger Bands arrays have same length
        expect(indicators.bollingerBands.upper.length).toBe(
          indicators.bollingerBands.middle.length
        );
        expect(indicators.bollingerBands.middle.length).toBe(
          indicators.bollingerBands.lower.length
        );

        // Verify: Keltner Channels arrays have same length
        expect(indicators.keltnerChannels.upper.length).toBe(
          indicators.keltnerChannels.middle.length
        );
        expect(indicators.keltnerChannels.middle.length).toBe(
          indicators.keltnerChannels.lower.length
        );
      }),
      { numRuns: 30 }
    );
  });
});
