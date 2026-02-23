import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { redisCache } from '../../services/redis-cache.service.js';
import * as Sentry from '@sentry/node';
import { getEngineConfig } from '../config/loader.js';
import { GreekSource, RejectionCode } from '../types/enums.js';
import { OptionsEngineError } from '../types/errors.js';

// ─── Massive API Response Types ───

export interface MassiveOptionContract {
  ticker: string;
  underlying_ticker: string;
  contract_type: 'call' | 'put';
  expiration_date: string;
  strike_price: number;
  cfi?: string;
  exercise_style?: string;
  shares_per_contract?: number;
  primary_exchange?: string;
}

export interface MassiveOptionSnapshot {
  break_even_price?: number;
  day?: {
    change: number;
    change_percent: number;
    close: number;
    high: number;
    last_updated: number;
    low: number;
    open: number;
    previous_close: number;
    volume: number;
    vwap: number;
  };
  details?: {
    contract_type: string;
    exercise_style: string;
    expiration_date: string;
    shares_per_contract: number;
    strike_price: number;
    ticker: string;
  };
  greeks?: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
  };
  implied_volatility?: number;
  last_quote?: {
    ask: number;
    ask_size: number;
    bid: number;
    bid_size: number;
    last_updated: number;
    midpoint: number;
    timeframe?: string;
  };
  open_interest?: number;
  underlying_asset?: {
    change_to_break_even: number;
    last_updated: number;
    price: number;
    ticker: string;
    timeframe?: string;
  };
}

export interface OptionQuote {
  optionTicker: string;
  underlyingTicker: string;
  contractType: 'call' | 'put';
  expirationDate: string;
  strikePrice: number;
  bid: number;
  ask: number;
  mid: number;
  volume: number;
  oi: number;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  greekSource: GreekSource;
  quoteTimestamp: Date;
  underlyingPrice: number | null;
}

export interface ChainResult {
  underlying: string;
  contracts: MassiveOptionContract[];
  fetchedAt: Date;
  fromCache: boolean;
}

export interface SnapshotResult {
  underlying: string;
  quotes: OptionQuote[];
  fetchedAt: Date;
  fromCache: boolean;
}

// ─── Service ───

export class MassiveOptionsService {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor() {
    this.apiKey = config.polygonApiKey || '';
    this.baseUrl = (config.polygonBaseUrl || 'https://api.polygon.io').replace(/\/+$/, '');

    if (!this.apiKey) {
      logger.warn('Massive/Polygon API key not configured — MassiveOptionsService will reject all calls');
    }
  }

  // ─── Options Chain Discovery ───

  async getOptionsChain(
    underlying: string,
    params: {
      expirationDateGte?: string;
      expirationDateLte?: string;
      strikePrice?: number;
      contractType?: 'call' | 'put';
      limit?: number;
    } = {}
  ): Promise<ChainResult> {
    const engineCfg = getEngineConfig();
    const cacheKey = `chain:${underlying}:${params.expirationDateGte ?? ''}:${params.expirationDateLte ?? ''}`;

    // Check cache
    const cached = await redisCache.get<ChainResult>(cacheKey);
    if (cached) {
      logger.debug('Chain cache hit', { underlying, cacheKey });
      return { ...cached, fromCache: true };
    }

    // Build query params
    const qp = new URLSearchParams({
      underlying_ticker: underlying,
      limit: String(params.limit ?? 250),
      order: 'asc',
      sort: 'expiration_date',
    });
    if (params.expirationDateGte) qp.set('expiration_date.gte', params.expirationDateGte);
    if (params.expirationDateLte) qp.set('expiration_date.lte', params.expirationDateLte);
    if (params.contractType) qp.set('contract_type', params.contractType);
    if (params.strikePrice) qp.set('strike_price', String(params.strikePrice));

    const endpoint = `/v3/reference/options/contracts?${qp.toString()}`;

    interface ChainResponse {
      status: string;
      results?: MassiveOptionContract[];
      count?: number;
      next_url?: string;
    }

    const data = await this.request<ChainResponse>(endpoint);

    if (!data.results || data.results.length === 0) {
      throw new OptionsEngineError(
        RejectionCode.NO_CHAIN_DATA,
        `No option contracts found for ${underlying}`,
        { underlying, params }
      );
    }

    const result: ChainResult = {
      underlying,
      contracts: data.results,
      fetchedAt: new Date(),
      fromCache: false,
    };

    await redisCache.set(cacheKey, result, engineCfg.cache.chainTTLSeconds);
    logger.info('Options chain fetched', { underlying, count: data.results.length });

    return result;
  }

  // ─── Options Snapshots (bid/ask/IV/OI/volume + greeks) ───

  async getOptionsSnapshot(underlying: string): Promise<SnapshotResult> {
    const engineCfg = getEngineConfig();
    const cacheKey = `snapshot:options:${underlying}`;

    const cached = await redisCache.get<SnapshotResult>(cacheKey);
    if (cached) {
      logger.debug('Snapshot cache hit', { underlying });
      return { ...cached, fromCache: true };
    }

    const endpoint = `/v3/snapshot/options/${underlying}?limit=250`;

    interface SnapshotResponse {
      status: string;
      results?: MassiveOptionSnapshot[];
      count?: number;
    }

    const data = await this.request<SnapshotResponse>(endpoint);

    if (!data.results || data.results.length === 0) {
      throw new OptionsEngineError(
        RejectionCode.NO_SNAPSHOT_DATA,
        `No option snapshots found for ${underlying}`,
        { underlying }
      );
    }

    const quotes = data.results.map(snap => this.mapSnapshotToQuote(snap, underlying));
    const result: SnapshotResult = {
      underlying,
      quotes,
      fetchedAt: new Date(),
      fromCache: false,
    };

    await redisCache.set(cacheKey, result, engineCfg.cache.snapshotTTLSeconds);
    logger.info('Options snapshot fetched', { underlying, quoteCount: quotes.length });

    return result;
  }

  // ─── Single Contract Snapshot ───

  async getContractSnapshot(optionTicker: string): Promise<OptionQuote> {
    const engineCfg = getEngineConfig();
    const cacheKey = `snapshot:contract:${optionTicker}`;

    const cached = await redisCache.get<OptionQuote>(cacheKey);
    if (cached) {
      return cached;
    }

    const endpoint = `/v3/snapshot/options/${optionTicker}`;

    interface SingleSnapshotResponse {
      status: string;
      results?: MassiveOptionSnapshot;
    }

    const data = await this.request<SingleSnapshotResponse>(endpoint);

    if (!data.results) {
      throw new OptionsEngineError(
        RejectionCode.NO_SNAPSHOT_DATA,
        `No snapshot for ${optionTicker}`,
        { optionTicker }
      );
    }

    const underlying = data.results.underlying_asset?.ticker ?? '';
    const quote = this.mapSnapshotToQuote(data.results, underlying);

    await redisCache.set(cacheKey, quote, engineCfg.cache.snapshotTTLSeconds);
    return quote;
  }

  // ─── Underlying Price ───

  async getUnderlyingPrice(underlying: string): Promise<{
    price: number;
    prevClose: number;
    timestamp: Date;
    fromCache: boolean;
  }> {
    const engineCfg = getEngineConfig();
    const cacheKey = `underlying_price:${underlying}`;

    const cached = await redisCache.get<{
      price: number;
      prevClose: number;
      timestamp: string;
    }>(cacheKey);

    if (cached) {
      return {
        price: cached.price,
        prevClose: cached.prevClose,
        timestamp: new Date(cached.timestamp),
        fromCache: true,
      };
    }

    const endpoint = `/v2/snapshot/locale/us/markets/stocks/tickers/${underlying}`;

    interface StockSnapshotResponse {
      status: string;
      ticker: {
        day: { c: number; o: number; h: number; l: number; v: number };
        prevDay: { c: number; o: number; h: number; l: number; v: number };
        min: { c: number; t: number };
        updated: number;
      };
    }

    const data = await this.request<StockSnapshotResponse>(endpoint);

    const price = data.ticker.min?.c ?? data.ticker.day.c;
    const prevClose = data.ticker.prevDay.c;
    const timestamp = new Date(data.ticker.updated ?? Date.now());

    const result = { price, prevClose, timestamp: timestamp.toISOString() };
    await redisCache.set(cacheKey, result, engineCfg.cache.underlyingPriceTTLSeconds);

    return { price, prevClose, timestamp, fromCache: false };
  }

  // ─── Historical Aggregates (for vol surface / correlation) ───

  async getDailyBars(
    ticker: string,
    from: string,
    to: string,
    limit: number = 50
  ): Promise<Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>> {
    const endpoint = `/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=${limit}`;

    interface AggsResponse {
      status: string;
      resultsCount: number;
      results?: Array<{
        t: number;
        o: number;
        h: number;
        l: number;
        c: number;
        v: number;
      }>;
    }

    const data = await this.request<AggsResponse>(endpoint);

    if (!data.results) {
      return [];
    }

    return data.results.map(bar => ({
      date: new Date(bar.t).toISOString().split('T')[0],
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
    }));
  }

  // ─── Staleness Check ───

  isQuoteStale(quote: OptionQuote): boolean {
    const engineCfg = getEngineConfig();
    const maxAgeMs = engineCfg.cache.snapshotMaxAgeAtUseSeconds * 1000;
    const ageMs = Date.now() - quote.quoteTimestamp.getTime();
    return ageMs > maxAgeMs;
  }

  // ─── HTTP Request with Timeout ───

  private async request<T>(endpoint: string): Promise<T> {
    if (!this.apiKey) {
      throw new OptionsEngineError(
        'MASSIVE_NOT_CONFIGURED',
        'Massive/Polygon API key is not configured',
        {}
      );
    }

    const engineCfg = getEngineConfig();
    const timeoutMs = engineCfg.timeouts.massiveHTTPSeconds * 1000;

    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${this.baseUrl}${endpoint}${separator}apiKey=${this.apiKey}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        const errorText = await response.text();
        throw new OptionsEngineError(
          'MASSIVE_HTTP_ERROR',
          `Massive API ${response.status}: ${errorText.substring(0, 200)}`,
          { endpoint, status: response.status }
        );
      }

      const data: unknown = await response.json();

      if (data && typeof data === 'object' && (data as any).status === 'ERROR') {
        throw new OptionsEngineError(
          'MASSIVE_API_ERROR',
          `Massive API error: ${(data as any).error ?? 'Unknown'}`,
          { endpoint }
        );
      }

      return data as T;
    } catch (error) {
      if (error instanceof OptionsEngineError) throw error;

      if ((error as Error).name === 'AbortError') {
        throw new OptionsEngineError(
          'MASSIVE_TIMEOUT',
          `Massive API timeout after ${timeoutMs}ms`,
          { endpoint, timeoutMs }
        );
      }

      logger.error('Massive API request failed', error as Error, { endpoint });
      Sentry.captureException(error, { tags: { service: 'MassiveOptionsService' } });
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ─── Snapshot → OptionQuote Mapper ───

  private mapSnapshotToQuote(snap: MassiveOptionSnapshot, underlying: string): OptionQuote {
    const quote = snap.last_quote;
    const greeks = snap.greeks;
    const details = snap.details;

    const bid = quote?.bid ?? 0;
    const ask = quote?.ask ?? 0;
    const mid = quote?.midpoint ?? (bid + ask) / 2;

    const hasGreeks = greeks && greeks.delta !== undefined;

    return {
      optionTicker: details?.ticker ?? '',
      underlyingTicker: underlying,
      contractType: (details?.contract_type ?? 'call') as 'call' | 'put',
      expirationDate: details?.expiration_date ?? '',
      strikePrice: details?.strike_price ?? 0,
      bid,
      ask,
      mid,
      volume: snap.day?.volume ?? 0,
      oi: snap.open_interest ?? 0,
      iv: snap.implied_volatility ?? null,
      delta: hasGreeks ? greeks!.delta : null,
      gamma: hasGreeks ? greeks!.gamma : null,
      theta: hasGreeks ? greeks!.theta : null,
      vega: hasGreeks ? greeks!.vega : null,
      greekSource: hasGreeks ? GreekSource.MASSIVE : GreekSource.MISSING,
      quoteTimestamp: quote?.last_updated
        ? new Date(quote.last_updated)
        : new Date(),
      underlyingPrice: snap.underlying_asset?.price ?? null,
    };
  }
}

export const massiveOptionsService = new MassiveOptionsService();
