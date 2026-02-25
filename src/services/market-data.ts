// Market Data Service - Unified interface with caching, fallback, and circuit breaker
import { TwelveDataClient } from './providers/twelvedata-client.js';
import { MarketDataClient, MarketDataOptionRow } from './providers/marketdata-client.js';
import type { ProviderHealthStatus } from './providers/market-data-provider.interface.js';
import { PolygonClient } from './providers/polygon-client.js';
import { cache } from './cache.service.js';
import { rateLimiter } from './rate-limiter.service.js';
import { indicators as indicatorService } from './indicators.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { retry } from '../utils/retry.js';
import { CircuitBreaker } from './circuit-breaker.service.js';
import { classifyProviderError } from './provider-error-classifier.js';
import { Candle, GexData, GexStrikeLevel, Indicators, OptionsFlowEntry, OptionsFlowSummary } from '../types/index.js';
import type { Greeks } from '../lib/shared/types.js';
import { adaptOptionChain, approximateGreeks, estimateIV } from './option-chain-adapter.service.js';
import { marketDataStream } from './market-data-stream.service.js';
import { unusualWhalesOptionsService } from './unusual-whales-options.service.js';
import * as Sentry from '@sentry/node';
import { getMarketClock } from '../utils/market-hours.js';

type Provider = 'polygon' | 'marketdata' | 'twelvedata' | 'unusualwhales';

export interface PriceWithStaleness {
  price: number | null;
  stale: boolean;
  ageMs: number;
}

export class MarketDataService {
  private polygon: PolygonClient;
  private marketData: MarketDataClient;
  private twelveData: TwelveDataClient;
  private circuitBreakers: Map<Provider, CircuitBreaker> = new Map();
  private readonly maxFailures: number = 5;
  private readonly resetTimeout: number = 60000;
  private readonly maxRetries: number = 2;
  private readonly entitlementCooldownMs: number = 30 * 60 * 1000; // 30 min
  private providerPriority: Provider[] = [];
  private readonly streamEnabled: boolean = config.polygonWsEnabled;

  // P0: Last-known price fallback for when all providers fail
  private lastKnownStockPrices = new Map<string, { price: number; fetchedAt: number }>();
  private lastKnownOptionPrices = new Map<string, { price: number; fetchedAt: number }>();

  constructor() {
    this.polygon = new PolygonClient();
    this.marketData = new MarketDataClient();
    this.twelveData = new TwelveDataClient();

    const priorityInput = Array.isArray(config.marketDataProviderPriority)
      ? config.marketDataProviderPriority
      : [];
    const normalizedProviders = priorityInput
      .map((value) => value.toLowerCase())
      .filter((value) => ['polygon', 'marketdata', 'twelvedata'].includes(value));
    this.providerPriority = (normalizedProviders.length > 0
      ? normalizedProviders
      : ['twelvedata', 'marketdata']) as Provider[];

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

  /** P0: Wrap a provider call with a hard timeout via AbortSignal */
  private withRequestTimeout<T>(fn: () => Promise<T>, label: string): Promise<T> {
    const timeoutMs = config.marketDataRequestTimeoutMs;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Request timeout: ${label} exceeded ${timeoutMs}ms`)),
        timeoutMs
      );
      fn().then(
        (val) => { clearTimeout(timer); resolve(val); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });
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
   * Record circuit breaker failure, with immediate force-open for entitlement errors.
   */
  private recordFailure(provider: Provider, error?: unknown): void {
    const breaker = this.circuitBreakers.get(provider);
    if (!breaker) return;

    if (error) {
      const classified = classifyProviderError(error);
      if (classified.disableProvider) {
        breaker.forceOpen(this.entitlementCooldownMs);
        logger.error(
          `Circuit breaker force-opened for ${provider} (${classified.type}) — cooldown ${this.entitlementCooldownMs / 60000}min`,
          { provider, errorType: classified.type }
        );
        Sentry.addBreadcrumb({
          category: 'market-data',
          message: 'Circuit breaker force-opened (entitlement)',
          level: 'error',
          data: { provider, errorType: classified.type, cooldownMin: this.entitlementCooldownMs / 60000 },
        });
        return;
      }
    }

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
        this.recordFailure(providerName, error);
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
        this.lastKnownStockPrices.set(symbol, { price, fetchedAt: Date.now() });
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
        this.recordFailure(providerName, error);
      }
    }

    // Implicit Polygon fallback when not already in the priority list
    if (config.polygonApiKey && !this.providerPriority.includes('polygon') && this.checkCircuitBreaker('polygon')) {
      try {
        const polygonQuote = await this.polygon.getLatestQuote(symbol);
        const price = polygonQuote.mid;
        if (this.isValidPrice(symbol, price)) {
          this.recordSuccess('polygon');
          cache.set(cacheKey, price, 30);
          this.lastKnownStockPrices.set(symbol, { price, fetchedAt: Date.now() });
          logger.info('Price fetched from polygon (implicit fallback)', { symbol, price });
          return price;
        }
      } catch (error) {
        logger.warn('Polygon implicit price fallback failed', { error, symbol });
        this.recordFailure('polygon', error);
      }
    }

    // P0: Fall back to last known price if within staleness threshold
    const lastKnown = this.lastKnownStockPrices.get(symbol);
    if (lastKnown && (Date.now() - lastKnown.fetchedAt) < config.staleDataMaxAgeMs) {
      logger.warn('All providers failed — using STALE last-known stock price', {
        symbol,
        price: lastKnown.price,
        ageMs: Date.now() - lastKnown.fetchedAt,
      });
      Sentry.addBreadcrumb({
        category: 'market-data',
        message: 'Using stale stock price fallback',
        level: 'warning',
        data: { symbol, price: lastKnown.price, ageMs: Date.now() - lastKnown.fetchedAt },
      });
      return lastKnown.price;
    }

    throw new Error(`All market data providers failed for ${symbol}`);
  }

  private isValidPrice(symbol: string, price: number): boolean {
    if (!Number.isFinite(price) || price <= 0) {
      return false;
    }

    const bounds: Record<string, { min: number; max: number }> = {
      SPY: { min: 300, max: 900 },
      QQQ: { min: 200, max: 800 },
      IWM: { min: 100, max: 400 },
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
   * Get option price with caching (Polygon and Unusual Whales support options).
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

    const optionProviders: Provider[] = [];
    if (config.unusualWhalesOptionsEnabled && config.unusualWhalesApiKey) {
      optionProviders.push('unusualwhales');
    }
    optionProviders.push('polygon');

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
          this.lastKnownOptionPrices.set(cacheKey, { price, fetchedAt: Date.now() });
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
        this.recordFailure(providerName, error);
      }
    }

    // P0: Fall back to last known option price if within staleness threshold
    const lastKnown = this.lastKnownOptionPrices.get(cacheKey);
    if (lastKnown && (Date.now() - lastKnown.fetchedAt) < config.staleDataMaxAgeMs) {
      logger.warn('All option providers failed — using STALE last-known option price', {
        symbol, strike, optionType,
        price: lastKnown.price,
        ageMs: Date.now() - lastKnown.fetchedAt,
      });
      return lastKnown.price;
    }

    logger.warn('All option data providers failed, no last-known fallback', { symbol, strike, optionType });
    return null;
  }

  /**
   * Get option snapshot (bid, ask, mid, greeks, iv) for exit engine.
   * Fetches options chain, finds matching contract, returns Greeks and spread.
   * Falls back to getOptionPrice + BS approximation when chain unavailable.
   */
  async getOptionSnapshot(
    symbol: string,
    strike: number,
    expiration: Date,
    optionType: 'call' | 'put'
  ): Promise<{
    bid: number;
    ask: number;
    mid: number;
    greeks: Greeks;
    iv: number;
  } | null> {
    const cacheKey = `option-snapshot:${symbol}:${strike}:${expiration.toISOString().slice(0, 10)}:${optionType}`;
    const cached = cache.get<{ bid: number; ask: number; mid: number; greeks: Greeks; iv: number }>(cacheKey);
    if (cached) return cached;

    try {
      const [chain, spotPrice, fallbackMid] = await Promise.all([
        this.getOptionsChain(symbol).catch(() => [] as MarketDataOptionRow[]),
        this.getStockPrice(symbol),
        this.getOptionPrice(symbol, strike, expiration, optionType),
      ]);

      const expiryStr = expiration.toISOString().slice(0, 10);
      const contracts = adaptOptionChain(chain, spotPrice, optionType);
      const match = contracts.find(
        (c) => c.strike === strike && (c.expiry === expiryStr || c.expiry?.startsWith?.(expiryStr))
      );

      if (match) {
        const result = {
          bid: match.bid,
          ask: match.ask,
          mid: match.mid,
          greeks: match.greeks,
          iv: match.iv ?? 0.3,
        };
        cache.set(cacheKey, result, 30);
        return result;
      }

      if (fallbackMid != null && Number.isFinite(fallbackMid) && spotPrice > 0 && strike > 0) {
        const dte = Math.max(0, (expiration.getTime() - Date.now()) / 86400000);
        const dteYears = dte / 365;
        const iv = estimateIV(spotPrice, strike, dteYears, fallbackMid, optionType);
        const greeks = approximateGreeks(spotPrice, strike, dteYears, iv, optionType);
        const spreadFraction = fallbackMid > 1 ? 0.02 : 0.05;
        const halfSpread = fallbackMid * spreadFraction;
        const result = {
          bid: Math.max(0.01, fallbackMid - halfSpread),
          ask: fallbackMid + halfSpread,
          mid: fallbackMid,
          greeks,
          iv,
        };
        cache.set(cacheKey, result, 30);
        return result;
      }
    } catch (error) {
      logger.warn('getOptionSnapshot failed', { symbol, strike, optionType, error });
    }
    return null;
  }

  /**
   * Check if market is open (TwelveData primary, time-based fallback)
   */
  async isMarketOpen(): Promise<boolean> {
    const cacheKey = 'market:isOpen';

    const cached = cache.get<boolean>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

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
      this.recordFailure('twelvedata', error);
      logger.warn('TwelveData market hours check failed, using time-based fallback', { error });
      Sentry.captureException(error, { tags: { stage: 'market-data', provider: 'twelvedata' } });
    }

    const isOpen = this.isMarketOpenByTime();
    cache.set(cacheKey, isOpen, 60);
    return isOpen;
  }

  /**
   * Time-based market open check using centralized getMarketClock().
   * Includes holiday awareness. Used as a last-resort fallback when API checks fail.
   */
  private isMarketOpenByTime(): boolean {
    return getMarketClock().isMarketOpen;
  }

  /**
   * Get market hours information (TwelveData primary, time-based fallback)
   */
  async getMarketHours(): Promise<{
    isMarketOpen: boolean;
    minutesUntilClose?: number;
    nextOpen?: Date;
    nextClose?: Date;
  }> {
    const isOpen = await this.isMarketOpen();
    const clock = getMarketClock();

    return {
      isMarketOpen: isOpen,
      minutesUntilClose: isOpen ? clock.minutesUntilClose ?? undefined : undefined,
    };
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
   * Get options chain. When UnusualWhales options is enabled, UW is primary (options data + flow).
   * Fallback: MarketData.app. UW rows have no gamma (GEX will be 0 when using UW chain).
   */
  async getOptionsChain(symbol: string): Promise<MarketDataOptionRow[]> {
    const cacheKey = `options-chain:${symbol}`;
    const cached = cache.get<MarketDataOptionRow[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Primary: Unusual Whales when options subscription is enabled (flow + options data)
    if (config.unusualWhalesOptionsEnabled && config.unusualWhalesApiKey && this.checkCircuitBreaker('unusualwhales')) {
      try {
        const rows = await unusualWhalesOptionsService.getChainAsMarketDataRows(symbol);
        if (rows.length > 0) {
          this.recordSuccess('unusualwhales');
          cache.set(cacheKey, rows, 60);
          logger.info('Options chain: Unusual Whales (primary)', { symbol, count: rows.length });
          return rows;
        }
      } catch (error) {
        this.recordFailure('unusualwhales', error);
        logger.warn('Unusual Whales options chain failed, trying MarketData.app fallback', { symbol, error });
      }
    }

    // Fallback: MarketData.app
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
        logger.info('Options chain: MarketData.app (fallback)', { symbol, count: rows.length });
        return rows;
      } catch (error) {
        this.recordFailure('marketdata', error);
        logger.warn('MarketData.app options chain failed', { symbol, error });
      }
    }

    // Last resort: Polygon / Massive.com
    if (config.polygonApiKey && this.checkCircuitBreaker('polygon')) {
      try {
        const rows = await retry(
          async () => {
            await rateLimiter.waitForToken('polygon');
            return this.polygon.getOptionsChain(symbol);
          },
          {
            retries: this.maxRetries,
            onRetry: (error, attempt, delayMs) => {
              logger.warn(`Retry ${attempt} for polygon options chain`, { error, delayMs });
            },
          }
        );

        this.recordSuccess('polygon');
        cache.set(cacheKey, rows, 60);
        logger.info('Options chain: Polygon (fallback)', { symbol, count: rows.length });
        return rows;
      } catch (error) {
        this.recordFailure('polygon', error);
        logger.warn('Polygon options chain failed', { symbol, error });
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
      this.recordFailure('marketdata', error);
      logger.error('Failed to calculate GEX', error, { symbol });
      Sentry.captureException(error, { tags: { stage: 'market-data', provider: 'marketdata', symbol } });
      throw error;
    }
  }

  /**
   * Get options flow summary. Primary: Unusual Whales. Fallback: MarketData.app.
   */
  async getOptionsFlow(symbol: string, limit: number = 50): Promise<OptionsFlowSummary> {
    const cacheKey = `options-flow:${symbol}:${limit}`;
    const cached = cache.get<OptionsFlowSummary>(cacheKey);
    if (cached) {
      return cached;
    }

    let flowDebug = '';

    // Primary: Unusual Whales
    if (config.unusualWhalesOptionsEnabled && config.unusualWhalesApiKey && this.checkCircuitBreaker('unusualwhales')) {
      try {
        const uwFlow = await unusualWhalesOptionsService.getOptionsFlow(symbol, limit);
        if (uwFlow && uwFlow.entries.length > 0) {
          this.recordSuccess('unusualwhales');
          cache.set(cacheKey, { ...uwFlow, flowDebug: 'unusualwhales' }, 60);
          logger.info('Options flow: Unusual Whales (primary)', { symbol, count: uwFlow.entries.length });
          return { ...uwFlow, flowDebug: 'unusualwhales' };
        }
        flowDebug = 'unusualwhales_returned_empty';
      } catch (uwError) {
        this.recordFailure('unusualwhales', uwError);
        flowDebug = `unusualwhales_failed: ${(uwError as Error).message}`;
        logger.warn('Unusual Whales options flow failed, trying MarketData.app fallback', { symbol, error: uwError });
      }
    } else if (config.unusualWhalesOptionsEnabled && config.unusualWhalesApiKey && !this.checkCircuitBreaker('unusualwhales')) {
      flowDebug = 'unusualwhales_circuit_breaker_open';
    } else if (!config.unusualWhalesOptionsEnabled || !config.unusualWhalesApiKey) {
      flowDebug = 'unusualwhales_not_configured';
    }

    // Fallback: MarketData.app
    if (this.checkCircuitBreaker('marketdata')) {
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
          source: 'marketdata',
          flowDebug: flowDebug || 'marketdata_fallback',
        };

        this.recordSuccess('marketdata');
        cache.set(cacheKey, summary, 60);
        logger.info('Options flow: MarketData.app (fallback)', { symbol, count: entries.length });
        return summary;
      } catch (error) {
        this.recordFailure('marketdata', error);
        logger.warn('MarketData.app options flow failed', { error, symbol });
        Sentry.captureException(error, { tags: { stage: 'market-data', provider: 'marketdata', symbol } });
      }
    }

    const emptySummary: OptionsFlowSummary = {
      symbol,
      entries: [],
      updatedAt: new Date(),
      flowDebug: flowDebug || 'all_sources_empty',
    };
    cache.set(cacheKey, emptySummary, 15);
    return emptySummary;
  }

  /**
   * P0: Staleness-aware option price fetch for exit monitor.
   * Returns price, staleness flag, and age in ms. Never throws.
   */
  async getOptionPriceWithStaleness(
    symbol: string,
    strike: number,
    expiration: Date,
    optionType: 'call' | 'put'
  ): Promise<PriceWithStaleness> {
    try {
      const price = await this.withRequestTimeout(
        () => this.getOptionPrice(symbol, strike, expiration, optionType),
        `getOptionPrice(${symbol} ${strike} ${optionType})`
      );
      if (price != null) {
        return { price, stale: false, ageMs: 0 };
      }
    } catch (error) {
      logger.warn('getOptionPriceWithStaleness: provider fetch failed', { symbol, strike, optionType, error });
    }

    const cacheKey = `option:${symbol}:${strike}:${expiration.toISOString()}:${optionType}`;
    const lastKnown = this.lastKnownOptionPrices.get(cacheKey);
    if (lastKnown) {
      return { price: lastKnown.price, stale: true, ageMs: Date.now() - lastKnown.fetchedAt };
    }
    return { price: null, stale: true, ageMs: Infinity };
  }

  /**
   * P0: Staleness-aware stock price fetch. Never throws.
   */
  async getStockPriceWithStaleness(symbol: string): Promise<PriceWithStaleness> {
    try {
      const price = await this.withRequestTimeout(
        () => this.getStockPrice(symbol),
        `getStockPrice(${symbol})`
      );
      return { price, stale: false, ageMs: 0 };
    } catch {
      const lastKnown = this.lastKnownStockPrices.get(symbol);
      if (lastKnown) {
        return { price: lastKnown.price, stale: true, ageMs: Date.now() - lastKnown.fetchedAt };
      }
      return { price: null, stale: true, ageMs: Infinity };
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

  /**
   * Phase 3c: Run health checks on all configured providers concurrently.
   * Returns per-provider health status with latency and circuit breaker state.
   */
  async healthCheckAll(): Promise<ProviderHealthStatus[]> {
    const providers: Array<{ name: Provider; client: { healthCheck(symbol?: string): Promise<ProviderHealthStatus> } }> = [];

    for (const p of this.providerPriority) {
      const client = p === 'polygon' ? this.polygon
        : p === 'marketdata' ? this.marketData
        : p === 'twelvedata' ? this.twelveData
        : null;
      if (client) providers.push({ name: p, client: client as any });
    }

    // Include Unusual Whales when configured (options data provider)
    if (config.unusualWhalesOptionsEnabled && config.unusualWhalesApiKey) {
      providers.push({
        name: 'unusualwhales',
        client: unusualWhalesOptionsService as any,
      });
    }

    const results = await Promise.allSettled(
      providers.map(async ({ name, client }) => {
        const result = name === 'unusualwhales'
          ? await (client as any).healthCheck('SPY')
          : await client.healthCheck();
        const breaker = this.circuitBreakers.get(name);
        if (breaker) {
          result.circuitBreakerState = breaker.getStatus().state;
        }
        return result;
      })
    );

    return results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { provider: providers[i].name, healthy: false, latencyMs: 0, lastError: String((r as PromiseRejectedResult).reason) }
    );
  }
}

// Singleton instance
export const marketData = new MarketDataService();
