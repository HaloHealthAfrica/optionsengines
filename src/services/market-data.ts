// Market Data Service - Unified interface with caching, fallback, and circuit breaker
import { AlpacaClient } from './providers/alpaca-client.js';
import { TwelveDataClient } from './providers/twelvedata-client.js';
import { MarketDataClient, MarketDataOptionRow } from './providers/marketdata-client.js';
import { PolygonClient } from './providers/polygon-client.js';
import { cache } from './cache.service.js';
import { rateLimiter } from './rate-limiter.service.js';
import { indicators as indicatorService } from './indicators.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { retry } from '../utils/retry.js';
import { CircuitBreaker } from './circuit-breaker.service.js';
import { Candle, GexData, GexStrikeLevel, Indicators, OptionsFlowEntry, OptionsFlowSummary } from '../types/index.js';
import { marketDataStream } from './market-data-stream.service.js';
import { unusualWhalesOptionsService } from './unusual-whales-options.service.js';
import * as Sentry from '@sentry/node';

type Provider = 'alpaca' | 'polygon' | 'marketdata' | 'twelvedata' | 'unusualwhales';

export class MarketDataService {
  private alpaca: AlpacaClient;
  private polygon: PolygonClient;
  private marketData: MarketDataClient;
  private twelveData: TwelveDataClient;
  private circuitBreakers: Map<Provider, CircuitBreaker> = new Map();
  private readonly maxFailures: number = 5;
  private readonly resetTimeout: number = 60000; // 60 seconds
  private readonly maxRetries: number = 2;
  private providerPriority: Provider[] = [];
  private readonly streamEnabled: boolean = config.polygonWsEnabled;

  constructor() {
    this.alpaca = new AlpacaClient();
    this.polygon = new PolygonClient();
    this.marketData = new MarketDataClient();
    this.twelveData = new TwelveDataClient();

    const priorityInput = Array.isArray(config.marketDataProviderPriority)
      ? config.marketDataProviderPriority
      : [];
    const normalizedProviders = priorityInput
      .map((value) => value.toLowerCase())
      .filter((value) => ['alpaca', 'polygon', 'marketdata', 'twelvedata'].includes(value));
    this.providerPriority = (normalizedProviders.length > 0
      ? normalizedProviders
      : ['alpaca', 'twelvedata']) as Provider[];

    // Initialize circuit breakers for all providers
    this.providerPriority.forEach((provider) => {
      this.circuitBreakers.set(
        provider,
        new CircuitBreaker({
          maxFailures: this.maxFailures,
          resetTimeoutMs: this.resetTimeout,
        })
      );
    });

    // Circuit breaker for Unusual Whales options (when enabled)
    if (config.unusualWhalesOptionsEnabled && config.unusualWhalesApiKey) {
      this.circuitBreakers.set(
        'unusualwhales',
        new CircuitBreaker({
          maxFailures: this.maxFailures,
          resetTimeoutMs: this.resetTimeout,
        })
      );
    }

    logger.info('Market Data Service initialized with providers', {
      providers: this.providerPriority,
    });

    if (this.streamEnabled) {
      marketDataStream.start();
      logger.info('Market data WebSocket streaming enabled');
    }
  }

  /**
   * Check circuit breaker state
   */
  private checkCircuitBreaker(provider: Provider): boolean {
    const breaker = this.circuitBreakers.get(provider);
    if (!breaker) return true;
    const canRequest = breaker.canRequest();
    if (!canRequest) {
      logger.debug(`Skipping ${provider} (circuit breaker open)`);
      logger.warn('Market data circuit breaker open', { provider });
    }
    return canRequest;
  }

  /**
   * Record circuit breaker success
   */
  private recordSuccess(provider: Provider): void {
    const breaker = this.circuitBreakers.get(provider);
    if (!breaker) return;
    breaker.recordSuccess();
  }

  /**
   * Record circuit breaker failure
   */
  private recordFailure(provider: Provider): void {
    const breaker = this.circuitBreakers.get(provider);
    if (!breaker) return;
    breaker.recordFailure();
    const status = breaker.getStatus();
    if (status.state === 'open') {
      logger.error(`Circuit breaker opened for ${provider} after ${status.failures} failures`);
      Sentry.addBreadcrumb({
        category: 'market-data',
        message: 'Circuit breaker opened',
        level: 'warning',
        data: { provider, failures: status.failures },
      });
    }
  }

  /**
   * Get candles with caching and fallback through all providers
   */
  async getCandles(
    symbol: string,
    timeframe: string,
    limit: number = 100
  ): Promise<Candle[]> {
    const cacheKey = `candles:${symbol}:${timeframe}:${limit}`;

    // Check cache first
    const cached = cache.get<Candle[]>(cacheKey);
    if (cached) {
      logger.debug('Candles retrieved from cache', { symbol, timeframe });
      return cached;
    }

    // Try providers in priority order
    for (const providerName of this.providerPriority) {
      if (!this.checkCircuitBreaker(providerName)) {
        logger.debug(`Skipping ${providerName} (circuit breaker open)`);
        continue;
      }

      try {
        const candles = await retry(
          async () => {
            // Use correct rate limiter for each provider
            const rateLimiterKey = providerName === 'marketdata' ? 'marketdata' : providerName;
            await rateLimiter.waitForToken(rateLimiterKey);
            switch (providerName) {
              case 'alpaca':
                return this.alpaca.getCandles(symbol, timeframe, limit);
              case 'polygon':
                return this.polygon.getCandles(symbol, timeframe, limit);
              case 'marketdata':
                return this.marketData.getCandles(symbol, timeframe, limit);
              case 'twelvedata':
                return this.twelveData.getCandles(symbol, timeframe, limit);
              default:
                throw new Error('Unsupported provider');
            }
          },
          {
            retries: this.maxRetries,
            providerAware: true,
            onRetry: (error, attempt, delayMs) => {
              logger.warn(`Retry ${attempt} for ${providerName} candles`, { error, delayMs });
            },
          }
        );

        this.recordSuccess(providerName);
        cache.set(cacheKey, candles, 60);
        logger.info(`Candles fetched from ${providerName}`, { symbol, timeframe, count: candles.length });
        Sentry.addBreadcrumb({
          category: 'market-data',
          message: 'Candles fetched',
          level: 'info',
          data: { provider: providerName, symbol, timeframe },
        });
        return candles;
      } catch (error) {
        logger.warn(`${providerName} failed, trying next provider`, { error });
        Sentry.captureException(error, {
          tags: { stage: 'market-data', provider: providerName, symbol },
        });
        this.recordFailure(providerName);
      }
    }

    throw new Error('All market data providers failed');
  }

  /**
   * Get stock price with caching and fallback through all providers
   */
  async getStockPrice(symbol: string): Promise<number> {
    const cacheKey = `price:${symbol}`;

    // Check cache first
    const cached = cache.get<number>(cacheKey);
    if (cached) {
      logger.debug('Price retrieved from cache', { symbol, price: cached });
      return cached;
    }

    if (this.streamEnabled) {
      const streamQuote = marketDataStream.getLatestQuote(symbol);
      if (streamQuote) {
        logger.debug('Price retrieved from WebSocket cache', { symbol, price: streamQuote.mid });
        return streamQuote.mid;
      }
      marketDataStream.ensureSubscribed(symbol);
    }

    // Try providers in priority order
    for (const providerName of this.providerPriority) {
      if (!this.checkCircuitBreaker(providerName)) {
        logger.debug(`Skipping ${providerName} (circuit breaker open)`);
        continue;
      }

      try {
        const price = await retry(
          async () => {
            await rateLimiter.waitForToken(providerName === 'marketdata' ? 'twelvedata' : providerName);
            switch (providerName) {
              case 'alpaca': {
                const alpacaQuote = await this.alpaca.getLatestQuote(symbol);
                return alpacaQuote.mid;
              }
              case 'polygon': {
                const polygonQuote = await this.polygon.getLatestQuote(symbol);
                return polygonQuote.mid;
              }
              case 'marketdata': {
                const marketDataQuote = await this.marketData.getLatestQuote(symbol);
                return marketDataQuote.mid;
              }
              case 'twelvedata': {
                const twelveDataQuote = await this.twelveData.getLatestQuote(symbol);
                return twelveDataQuote.price;
              }
              default:
                throw new Error('Unsupported provider');
            }
          },
          {
            retries: this.maxRetries,
            providerAware: true,
            onRetry: (error, attempt, delayMs) => {
              logger.warn(`Retry ${attempt} for ${providerName} price`, { error, delayMs });
            },
          }
        );

        if (!this.isValidPrice(symbol, price)) {
          logger.warn('Rejected implausible price', { symbol, price, provider: providerName });
          continue;
        }

        this.recordSuccess(providerName);
        cache.set(cacheKey, price, 30);
        logger.info(`Price fetched from ${providerName}`, { symbol, price });
        Sentry.addBreadcrumb({
          category: 'market-data',
          message: 'Price fetched',
          level: 'info',
          data: { provider: providerName, symbol },
        });
        return price;
      } catch (error) {
        logger.warn(`${providerName} price fetch failed, trying next provider`, { error });
        Sentry.captureException(error, {
          tags: { stage: 'market-data', provider: providerName, symbol },
        });
        this.recordFailure(providerName);
      }
    }

    throw new Error('All market data providers failed');
  }

  private isValidPrice(symbol: string, price: number): boolean {
    if (!Number.isFinite(price) || price <= 0) {
      return false;
    }

    const bounds: Record<string, { min: number; max: number }> = {
      SPY: { min: 300, max: 700 },
      QQQ: { min: 200, max: 600 },
      IWM: { min: 100, max: 300 },
    };
    const normalized = symbol.toUpperCase();
    const range = bounds[normalized];
    if (range && (price < range.min || price > range.max)) {
      return false;
    }

    return true;
  }

  /**
   * Get multiple stock prices (batch)
   */
  async getStockPrices(symbols: string[]): Promise<Record<string, number>> {
    const prices: Record<string, number> = {};

    // Fetch prices in parallel
    const promises = symbols.map(async (symbol) => {
      try {
        const price = await this.getStockPrice(symbol);
        prices[symbol] = price;
      } catch (error) {
        logger.error(`Failed to fetch price for ${symbol}`, error);
      }
    });

    await Promise.all(promises);

    return prices;
  }

  /**
   * Get option price with caching (Alpaca and Polygon support options).
   * Returns null when all providers fail or return partial/empty data. Does not throw.
   */
  async getOptionPrice(
    symbol: string,
    strike: number,
    expiration: Date,
    optionType: 'call' | 'put'
  ): Promise<number | null> {
    const cacheKey = `option:${symbol}:${strike}:${expiration.toISOString()}:${optionType}`;

    const cached = cache.get<number>(cacheKey);
    if (cached != null) {
      logger.debug('Option price retrieved from cache', { symbol, strike, optionType });
      return cached;
    }

    const optionProviders: Provider[] = ['alpaca', 'polygon'];
    if (config.unusualWhalesOptionsEnabled && config.unusualWhalesApiKey) {
      optionProviders.push('unusualwhales');
    }

    for (const providerName of optionProviders) {
      if (!this.checkCircuitBreaker(providerName)) {
        logger.debug(`Skipping ${providerName} (circuit breaker open)`);
        continue;
      }

      try {
        const price = await retry(
          async () => {
            if (providerName !== 'unusualwhales') {
              await rateLimiter.waitForToken(providerName);
            }
            switch (providerName) {
              case 'alpaca':
                return this.alpaca.getOptionPrice(symbol, strike, expiration, optionType);
              case 'polygon':
                return this.polygon.getOptionPrice(symbol, strike, expiration, optionType);
              case 'unusualwhales':
                return unusualWhalesOptionsService.getOptionPrice(
                  symbol,
                  strike,
                  expiration,
                  optionType
                );
              default:
                throw new Error('Unsupported provider');
            }
          },
          {
            retries: this.maxRetries,
            providerAware: true,
            onRetry: (error, attempt, delayMs) => {
              logger.warn(`Retry ${attempt} for ${providerName} option price`, { error, delayMs });
            },
          }
        );

        if (price != null && Number.isFinite(price)) {
          this.recordSuccess(providerName);
          cache.set(cacheKey, price, 30);
          logger.info(`Option price fetched from ${providerName}`, { symbol, strike, optionType, price });
          Sentry.addBreadcrumb({
            category: 'market-data',
            message: 'Option price fetched',
            level: 'info',
            data: { provider: providerName, symbol, strike, optionType },
          });
          return price;
        }
        logger.debug(`${providerName} returned null/partial option price`, { symbol, strike, optionType });
      } catch (error) {
        logger.warn(`${providerName} option price fetch failed`, { error });
        Sentry.captureException(error, {
          tags: { stage: 'market-data', provider: providerName, symbol },
        });
        this.recordFailure(providerName);
      }
    }

    logger.warn('All option data providers failed or returned no price', { symbol, strike, optionType });
    return null;
  }

  /**
   * Check if market is open
   */
  async isMarketOpen(): Promise<boolean> {
    const cacheKey = 'market:isOpen';

    // Check cache first
    const cached = cache.get<boolean>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    // Try Alpaca first
    if (this.checkCircuitBreaker('alpaca')) {
      try {
        const isOpen = await retry(() => this.alpaca.isMarketOpen(), {
          retries: this.maxRetries,
          onRetry: (error, attempt, delayMs) => {
            logger.warn(`Retry ${attempt} for alpaca market open`, { error, delayMs });
          },
        });
        this.recordSuccess('alpaca');
        cache.set(cacheKey, isOpen, 60); // Cache for 60 seconds
        return isOpen;
      } catch (error) {
        this.recordFailure('alpaca');
        logger.warn('Alpaca market hours check failed, falling back', { error });
      Sentry.captureException(error, { tags: { stage: 'market-data', provider: 'alpaca' } });
      }
    }

    // Fallback to TwelveData
    try {
      const isOpen = await retry(() => this.twelveData.isMarketOpen(), {
        retries: this.maxRetries,
        onRetry: (error, attempt, delayMs) => {
          logger.warn(`Retry ${attempt} for twelvedata market open`, { error, delayMs });
        },
      });
      this.recordSuccess('twelvedata');
      cache.set(cacheKey, isOpen, 60);
      return isOpen;
    } catch (error) {
      this.recordFailure('twelvedata');
      logger.error('Failed to check market hours', error);
      Sentry.captureException(error, { tags: { stage: 'market-data', provider: 'twelvedata' } });
      return false; // Default to closed on error
    }
  }

  /**
   * Get market hours information
   */
  async getMarketHours(): Promise<{
    isMarketOpen: boolean;
    minutesUntilClose?: number;
    nextOpen?: Date;
    nextClose?: Date;
  }> {
    try {
      const hours = await retry(() => this.alpaca.getMarketHours(), {
        retries: this.maxRetries,
        onRetry: (error, attempt, delayMs) => {
          logger.warn(`Retry ${attempt} for alpaca market hours`, { error, delayMs });
        },
      });
      this.recordSuccess('alpaca');
      
      let minutesUntilClose: number | undefined;
      if (hours.isOpen && hours.nextClose) {
        const now = Date.now();
        const closeTime = hours.nextClose.getTime();
        minutesUntilClose = Math.floor((closeTime - now) / 60000);
      }

      return {
        isMarketOpen: hours.isOpen,
        minutesUntilClose,
        nextOpen: hours.nextOpen,
        nextClose: hours.nextClose,
      };
    } catch (error) {
      this.recordFailure('alpaca');
      logger.error('Failed to get market hours', error);
      Sentry.captureException(error, { tags: { stage: 'market-data', provider: 'alpaca' } });
      return { isMarketOpen: false };
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): ReturnType<typeof cache.getStats> {
    return cache.getStats();
  }

  /**
   * Get rate limiter statistics
   */
  getRateLimiterStats(): ReturnType<typeof rateLimiter.getAllStats> {
    return rateLimiter.getAllStats();
  }

  /**
   * Get indicators derived from candles (no additional API calls)
   */
  async getIndicators(symbol: string, timeframe: string): Promise<Indicators> {
    const cacheKey = `indicators:${symbol}:${timeframe}`;

    // Check cache first
    const cached = cache.get<Indicators>(cacheKey);
    if (cached) {
      logger.debug('Indicators retrieved from cache', { symbol, timeframe });
      return cached;
    }

    // Get candles (will use cache if available)
    const candles = await this.getCandles(symbol, timeframe, 200);

    // Derive indicators from candles (no API calls)
    const derivedIndicators = indicatorService.deriveIndicators(candles);

    // Cache the indicators
    cache.set(cacheKey, derivedIndicators, 60); // 60 second TTL

    logger.debug('Indicators derived and cached', { symbol, timeframe });

    return derivedIndicators;
  }

  /**
   * Get options chain from MarketData.app, with Unusual Whales fallback.
   * Used for GEX and max pain calculations. UW rows have no gamma (GEX will be 0).
   */
  async getOptionsChain(symbol: string): Promise<MarketDataOptionRow[]> {
    const cacheKey = `options-chain:${symbol}`;
    const cached = cache.get<MarketDataOptionRow[]>(cacheKey);
    if (cached) {
      return cached;
    }

    if (this.checkCircuitBreaker('marketdata')) {
      try {
        const rows = await retry(
          async () => {
            await rateLimiter.waitForToken('twelvedata');
            return this.marketData.getOptionsChain(symbol);
          },
          {
            retries: this.maxRetries,
            onRetry: (error, attempt, delayMs) => {
              logger.warn(`Retry ${attempt} for marketdata options chain`, { error, delayMs });
            },
          }
        );

        this.recordSuccess('marketdata');
        cache.set(cacheKey, rows, 60);
        return rows;
      } catch (error) {
        this.recordFailure('marketdata');
        logger.warn('MarketData.app options chain failed, trying Unusual Whales fallback', { symbol, error });
      }
    }

    if (config.unusualWhalesOptionsEnabled && config.unusualWhalesApiKey && this.checkCircuitBreaker('unusualwhales')) {
      try {
        const rows = await unusualWhalesOptionsService.getChainAsMarketDataRows(symbol);
        if (rows.length > 0) {
          this.recordSuccess('unusualwhales');
          cache.set(cacheKey, rows, 60);
          logger.info('Options chain fallback: Unusual Whales', { symbol, count: rows.length });
          return rows;
        }
      } catch (error) {
        this.recordFailure('unusualwhales');
        logger.warn('Unusual Whales options chain fallback failed', { symbol, error });
      }
    }

    throw new Error('Failed to fetch options chain from all providers');
  }

  /**
   * Get Gamma Exposure (GEX) data using MarketData.app
   */
  async getGex(symbol: string): Promise<GexData> {
    const cacheKey = `gex:${symbol}`;
    const cached = cache.get<GexData>(cacheKey);
    if (cached) {
      return cached;
    }

    if (!this.checkCircuitBreaker('marketdata')) {
      throw new Error('MarketData.app unavailable (circuit breaker open)');
    }

    try {
      const [chain, currentPrice] = await retry(
        async () => {
          await rateLimiter.waitForToken('twelvedata');
          const chainRows = await this.getOptionsChain(symbol);
          const price = await this.getStockPrice(symbol);
          return [chainRows, price] as const;
        },
        {
          retries: this.maxRetries,
          onRetry: (error, attempt, delayMs) => {
            logger.warn(`Retry ${attempt} for marketdata gex`, { error, delayMs });
          },
        }
      );

      const levelsMap = new Map<number, GexStrikeLevel>();
      let totalCallGex = 0;
      let totalPutGex = 0;

      for (const row of chain) {
        const gamma = Number(row.gamma ?? 0);
        const openInterest = Number(row.openInterest ?? 0);
        if (!Number.isFinite(gamma) || !Number.isFinite(openInterest)) {
          continue;
        }

        const signedGamma = row.optionType === 'put' ? -gamma : gamma;
        const gex = signedGamma * openInterest * 100 * currentPrice;

        const existing = levelsMap.get(row.strike) || {
          strike: row.strike,
          callGex: 0,
          putGex: 0,
          netGex: 0,
          openInterestCall: 0,
          openInterestPut: 0,
          gammaCall: 0,
          gammaPut: 0,
        };

        if (row.optionType === 'call') {
          existing.callGex += gex;
          existing.openInterestCall = (existing.openInterestCall || 0) + openInterest;
          existing.gammaCall = (existing.gammaCall || 0) + gamma;
          totalCallGex += gex;
        } else {
          existing.putGex += gex;
          existing.openInterestPut = (existing.openInterestPut || 0) + openInterest;
          existing.gammaPut = (existing.gammaPut || 0) + gamma;
          totalPutGex += gex;
        }

        existing.netGex = existing.callGex + existing.putGex;
        levelsMap.set(row.strike, existing);
      }

      const levels = Array.from(levelsMap.values()).sort((a, b) => a.strike - b.strike);
      const netGex = totalCallGex + totalPutGex;
      const zeroGammaLevel =
        levels.length === 0
          ? undefined
          : levels.reduce((closest, level) =>
              Math.abs(level.netGex) < Math.abs(closest.netGex) ? level : closest
            ).strike;

      const totalAbs = Math.abs(totalCallGex) + Math.abs(totalPutGex);
      const dealerPosition: GexData['dealerPosition'] =
        totalAbs === 0 ? 'neutral' : netGex > 0 ? 'long_gamma' : netGex < 0 ? 'short_gamma' : 'neutral';
      const volatilityExpectation: GexData['volatilityExpectation'] =
        totalAbs === 0
          ? 'neutral'
          : netGex > 0
          ? 'compressed'
          : netGex < 0
          ? 'expanding'
          : 'neutral';

      const gexData: GexData = {
        symbol,
        netGex,
        totalCallGex,
        totalPutGex,
        zeroGammaLevel,
        dealerPosition,
        volatilityExpectation,
        updatedAt: new Date(),
        levels,
      };

      this.recordSuccess('marketdata');
      cache.set(cacheKey, gexData, 300); // GEX TTL 300s minimum
      return gexData;
    } catch (error) {
      this.recordFailure('marketdata');
      logger.error('Failed to calculate GEX', error, { symbol });
      Sentry.captureException(error, { tags: { stage: 'market-data', provider: 'marketdata', symbol } });
      throw error;
    }
  }

  /**
   * Get options flow summary using MarketData.app
   */
  async getOptionsFlow(symbol: string, limit: number = 50): Promise<OptionsFlowSummary> {
    const cacheKey = `options-flow:${symbol}:${limit}`;
    const cached = cache.get<OptionsFlowSummary>(cacheKey);
    if (cached) {
      return cached;
    }

    if (!this.checkCircuitBreaker('marketdata')) {
      logger.warn('MarketData.app options flow unavailable (circuit breaker open)', { symbol });
      return {
        symbol,
        entries: [],
        updatedAt: new Date(),
      };
    }

    try {
      const rows = await retry(
        async () => {
          await rateLimiter.waitForToken('twelvedata');
          return this.marketData.getOptionsFlow(symbol, limit);
        },
        {
          retries: this.maxRetries,
          onRetry: (error, attempt, delayMs) => {
            logger.warn(`Retry ${attempt} for marketdata options flow`, { error, delayMs });
          },
        }
      );

      const entries: OptionsFlowEntry[] = rows.map((row) => ({
        optionSymbol: row.optionSymbol,
        side: row.optionType,
        strike: row.strike,
        expiration: new Date(row.expiration),
        volume: Number(row.volume ?? 0),
        openInterest: row.openInterest ? Number(row.openInterest) : undefined,
        premium: row.premium ? Number(row.premium) : undefined,
        sentiment: row.optionType === 'call' ? 'bullish' : 'bearish',
        timestamp: row.timestamp ? new Date(row.timestamp) : new Date(),
      }));

      const summary: OptionsFlowSummary = {
        symbol,
        entries,
        updatedAt: new Date(),
      };

      this.recordSuccess('marketdata');
      cache.set(cacheKey, summary, 60);
      return summary;
    } catch (error) {
      this.recordFailure('marketdata');
      logger.warn('Failed to fetch options flow, returning empty summary', { error, symbol });
      Sentry.captureException(error, { tags: { stage: 'market-data', provider: 'marketdata', symbol } });
      const emptySummary: OptionsFlowSummary = {
        symbol,
        entries: [],
        updatedAt: new Date(),
      };
      cache.set(cacheKey, emptySummary, 15);
      return emptySummary;
    }
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus(): Record<Provider, { state: string; failures: number }> {
    const status: Record<Provider, { state: string; failures: number }> = {} as any;

    this.circuitBreakers.forEach((breaker, provider) => {
      const breakerStatus = breaker.getStatus();
      status[provider] = {
        state: breakerStatus.state,
        failures: breakerStatus.failures,
      };
    });

    return status;
  }
}

// Singleton instance
export const marketData = new MarketDataService();
