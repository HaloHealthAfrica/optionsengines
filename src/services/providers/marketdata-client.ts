// MarketData.app API Client - Additional market data provider
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { Candle } from '../../types/index.js';
import { getMarketClock } from '../../utils/market-hours.js';

export interface MarketDataBar {
  t: number; // timestamp (unix)
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
}

export interface MarketDataQuote {
  symbol: string;
  ask: number;
  bid: number;
  mid: number;
  last: number;
  volume: number;
  updated: number;
}

export interface MarketDataOptionRow {
  optionSymbol: string;
  strike: number;
  expiration: string;
  optionType: 'call' | 'put';
  openInterest?: number;
  gamma?: number;
  volume?: number;
  premium?: number;
  timestamp?: string;
  /** Implied volatility (0.0–3.0). When provided, used for Greeks instead of estimating from price. */
  iv?: number;
}

import type { IMarketDataProvider, ProviderHealthStatus } from './market-data-provider.interface.js';

export class MarketDataClient implements Pick<IMarketDataProvider, 'name' | 'healthCheck'> {
  readonly name = 'marketdata' as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor() {
    this.apiKey = config.marketDataApiKey;
    this.baseUrl = (config.marketDataBaseUrl || 'https://proxyip.fly.dev').replace(/\/+$/, '');

    if (!this.apiKey) {
      logger.warn('MarketData.app API key not configured');
    }
    logger.info('MarketData.app base URL', { baseUrl: this.baseUrl });
  }

  /**
   * Make request to MarketData.app API.
   * 404 with {s:no_data} is a valid empty state - returns null to signal caller to use [].
   * 403 = IP block from multi-IP detection - retry once after brief pause.
   * 203 = valid cached response, treated same as 200.
   */
  private async request<T>(endpoint: string, retryOn403 = true): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      const responseText = await response.text();

      if (response.status === 404) {
        try {
          const body = JSON.parse(responseText);
          if (body?.s === 'no_data') {
            return { s: 'no_data', data: [], options: [] } as unknown as T;
          }
        } catch {
          // not JSON
        }
      }

      if (response.status === 403) {
        let diagInfo: Record<string, unknown> = {};
        try { diagInfo = JSON.parse(responseText); } catch { /* not JSON */ }

        logger.warn('MarketData.app 403: IP block detected', {
          authorizedIP: diagInfo.authorizedIP,
          blockedIP: diagInfo.blockedIP,
          endpoint,
          guide: 'https://www.marketdata.app/docs/api/troubleshooting/multiple-ip-addresses',
        });

        if (retryOn403) {
          await new Promise(resolve => setTimeout(resolve, 5_000));
          return this.request<T>(endpoint, false);
        }

        throw new Error(
          `MarketData.app 403: IP block. Authorized: ${diagInfo.authorizedIP}, Blocked: ${diagInfo.blockedIP}. ` +
          `Ensure all API requests originate from a single IP. ` +
          `Guide: https://www.marketdata.app/docs/api/troubleshooting/multiple-ip-addresses`
        );
      }

      if (response.status === 203) {
        logger.debug('MarketData.app response served from cache (HTTP 203)', { endpoint });
      }

      if (!response.ok) {
        throw new Error(
          `MarketData.app API error: ${response.status} ${response.statusText} - ${responseText}`
        );
      }

      const data: any = responseText ? JSON.parse(responseText) : {};

      if (data.s === 'error') {
        throw new Error(`MarketData.app API error: ${data.errmsg || 'Unknown error'}`);
      }

      return data as T;
    } catch (error: any) {
      logger.error('MarketData.app API request failed', error, { endpoint });
      throw error;
    }
  }

  /**
   * Get historical bars (OHLCV candles)
   */
  async getCandles(
    symbol: string,
    timeframe: string,
    limit: number = 100
  ): Promise<Candle[]> {
    try {
      // Map timeframe to MarketData.app format
      const resolution = this.mapTimeframe(timeframe);

      // Calculate date range
      const to = Math.floor(Date.now() / 1000);
      const from = to - limit * this.getTimeframeSeconds(timeframe);

      const endpoint = `/v1/stocks/candles/${resolution}/${symbol}/?from=${from}&to=${to}`;

      interface MarketDataResponse {
        s: string; // status
        t: number[]; // timestamps
        o: number[]; // opens
        h: number[]; // highs
        l: number[]; // lows
        c: number[]; // closes
        v: number[]; // volumes
      }

      const response = await this.request<MarketDataResponse>(endpoint);

      if (!response.t || response.t.length === 0) {
        logger.warn('No bars returned from MarketData.app', { symbol, timeframe });
        return [];
      }

      const candles: Candle[] = [];
      for (let i = 0; i < response.t.length; i++) {
        candles.push({
          timestamp: new Date(response.t[i] * 1000),
          open: response.o[i],
          high: response.h[i],
          low: response.l[i],
          close: response.c[i],
          volume: response.v[i],
        });
      }

      logger.debug('MarketData.app candles fetched', {
        symbol,
        timeframe,
        count: candles.length,
      });

      return candles;
    } catch (error) {
      logger.error('Failed to fetch MarketData.app candles', error, { symbol, timeframe });
      throw error;
    }
  }

  /**
   * Get latest quote
   */
  async getLatestQuote(symbol: string): Promise<{ bid: number; ask: number; mid: number }> {
    try {
      const endpoint = `/v1/stocks/quotes/${symbol}/`;

      interface MarketDataQuoteResponse {
        s: string;
        symbol: string[];
        ask: number[];
        bid: number[];
        mid: number[];
        last: number[];
        volume: number[];
        updated: number[];
      }

      const response = await this.request<MarketDataQuoteResponse>(endpoint);

      const bid = response.bid[0];
      const ask = response.ask[0];
      const mid = response.mid[0];

      logger.debug('MarketData.app quote fetched', { symbol, bid, ask, mid });

      return { bid, ask, mid };
    } catch (error) {
      logger.error('Failed to fetch MarketData.app quote', error, { symbol });
      throw error;
    }
  }

  /**
   * Get option price (not supported by MarketData.app free tier)
   */
  async getOptionPrice(
    _symbol: string,
    _strike: number,
    _expiration: Date,
    _optionType: 'call' | 'put'
  ): Promise<number> {
    throw new Error('Option pricing not supported by MarketData.app free tier');
  }

  /**
   * Transform MarketData.app columnar response (parallel arrays) into row objects.
   * The API returns {optionSymbol: [...], strike: [...], gamma: [...], ...}.
   */
  private transformColumnarResponse(response: any): MarketDataOptionRow[] {
    if (!response?.optionSymbol || !Array.isArray(response.optionSymbol)) {
      return [];
    }

    const count = response.optionSymbol.length;
    const rows: MarketDataOptionRow[] = [];

    for (let i = 0; i < count; i++) {
      const side = response.side?.[i];
      const optionType: 'call' | 'put' =
        (side === 'call' || side === 'Call' || side === 'C') ? 'call' : 'put';

      const expTs = response.expiration?.[i];
      const expiration = typeof expTs === 'number'
        ? new Date(expTs * 1000).toISOString().split('T')[0]
        : String(expTs ?? '');

      rows.push({
        optionSymbol: response.optionSymbol[i],
        strike: Number(response.strike?.[i] ?? 0),
        expiration,
        optionType,
        openInterest: response.openInterest?.[i],
        gamma: response.gamma?.[i],
        volume: response.volume?.[i],
        iv: response.iv?.[i],
      });
    }

    return rows.filter(row => Number.isFinite(row.strike) && row.expiration);
  }

  /**
   * Get options chain data for GEX calculations.
   * 404 no_data returns [] (valid empty state).
   * Handles MarketData.app columnar response format (parallel arrays).
   */
  async getOptionsChain(symbol: string): Promise<MarketDataOptionRow[]> {
    try {
      const endpoint = `/v1/options/chain/${symbol}/`;
      const response = await this.request<any>(endpoint);

      if (response?.s === 'no_data') {
        return [];
      }

      if (Array.isArray(response?.optionSymbol)) {
        const rows = this.transformColumnarResponse(response);
        logger.debug('MarketData.app options chain fetched (columnar)', { symbol, count: rows.length });
        return rows;
      }

      const rows: any[] = response?.options ?? response?.data ?? response?.rows ?? [];
      const normalized = rows
        .map((row) => {
          const optionTypeRaw = row.option_type ?? row.type ?? row.side ?? row.call_put ?? row.cp;
          const optionType =
            optionTypeRaw === 'C' || optionTypeRaw === 'call' || optionTypeRaw === 'CALL'
              ? 'call'
              : 'put';

          return {
            optionSymbol: row.symbol ?? row.option_symbol ?? row.optionSymbol ?? `${symbol}`,
            strike: Number(row.strike ?? row.k ?? 0),
            expiration: row.expiration ?? row.expiry ?? row.exp ?? '',
            optionType,
            openInterest: row.open_interest ?? row.oi ?? row.openInterest,
            gamma: row.gamma ?? row.greek_gamma ?? row.greeks?.gamma,
            volume: row.volume ?? row.vol,
            premium: row.premium ?? row.notional,
            timestamp: row.timestamp ?? row.time ?? row.updated,
          } as MarketDataOptionRow;
        })
        .filter((row) => Number.isFinite(row.strike) && row.expiration);

      logger.debug('MarketData.app options chain fetched', { symbol, count: normalized.length });
      return normalized;
    } catch (error) {
      logger.error('Failed to fetch MarketData.app options chain', error, { symbol });
      throw error;
    }
  }

  /**
   * Get options flow data.
   * 404 no_data returns [] (valid empty state).
   * Handles MarketData.app columnar response format (parallel arrays).
   */
  async getOptionsFlow(symbol: string, limit: number = 50): Promise<MarketDataOptionRow[]> {
    try {
      const endpoint = `/v1/options/flow/${symbol}/?limit=${limit}`;
      const response = await this.request<any>(endpoint);

      if (response?.s === 'no_data') {
        return [];
      }

      if (Array.isArray(response?.optionSymbol)) {
        const rows = this.transformColumnarResponse(response);
        logger.debug('MarketData.app options flow fetched (columnar)', { symbol, count: rows.length });
        return rows;
      }

      const rows: any[] = response?.data ?? response?.flow ?? response?.rows ?? [];
      const normalized = rows
        .map((row) => {
          const optionTypeRaw = row.option_type ?? row.type ?? row.side ?? row.call_put ?? row.cp;
          const optionType =
            optionTypeRaw === 'C' || optionTypeRaw === 'call' || optionTypeRaw === 'CALL'
              ? 'call'
              : 'put';

          return {
            optionSymbol: row.symbol ?? row.option_symbol ?? row.optionSymbol ?? `${symbol}`,
            strike: Number(row.strike ?? row.k ?? 0),
            expiration: row.expiration ?? row.expiry ?? row.exp ?? '',
            optionType,
            openInterest: row.open_interest ?? row.oi ?? row.openInterest,
            gamma: row.gamma ?? row.greek_gamma ?? row.greeks?.gamma,
            volume: row.volume ?? row.vol ?? 0,
            premium: row.premium ?? row.notional ?? row.cost,
            timestamp: row.timestamp ?? row.time ?? row.updated,
          } as MarketDataOptionRow;
        })
        .filter((row) => Number.isFinite(row.strike) && row.expiration);

      logger.debug('MarketData.app options flow fetched', { symbol, count: normalized.length });
      return normalized;
    } catch (error) {
      logger.error('Failed to fetch MarketData.app options flow', error, { symbol });
      throw error;
    }
  }

  /**
   * Map internal timeframe to MarketData.app format
   */
  private mapTimeframe(timeframe: string): string {
    const mapping: Record<string, string> = {
      '1m': '1',
      '5m': '5',
      '15m': '15',
      '30m': '30',
      '1h': '60',
      '4h': '240',
      '1d': 'D',
    };

    return mapping[timeframe] || '5';
  }

  /**
   * Get timeframe duration in seconds
   */
  private getTimeframeSeconds(timeframe: string): number {
    const mapping: Record<string, number> = {
      '1m': 60,
      '5m': 5 * 60,
      '15m': 15 * 60,
      '30m': 30 * 60,
      '1h': 60 * 60,
      '4h': 4 * 60 * 60,
      '1d': 24 * 60 * 60,
    };

    return mapping[timeframe] || 5 * 60;
  }

  async isMarketOpen(): Promise<boolean> {
    return getMarketClock().isMarketOpen;
  }

  async getMarketHours(): Promise<{
    isOpen: boolean;
    nextOpen?: Date;
    nextClose?: Date;
  }> {
    return { isOpen: getMarketClock().isMarketOpen };
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    const start = Date.now();
    try {
      await this.getLatestQuote('SPY');
      return { provider: this.name, healthy: true, latencyMs: Date.now() - start };
    } catch (e: any) {
      return { provider: this.name, healthy: false, latencyMs: Date.now() - start, lastError: e.message };
    }
  }
}
