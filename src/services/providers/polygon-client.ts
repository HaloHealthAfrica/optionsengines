// Massive.com API Client (formerly Polygon.io) - Premium market data provider
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { Candle } from '../../types/index.js';

export interface PolygonBar {
  t: number; // timestamp (ms)
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
  vw: number; // volume weighted average price
  n: number; // number of transactions
}

export interface PolygonQuote {
  P: number; // bid price
  p: number; // ask price
  S: number; // bid size
  s: number; // ask size
  t: number; // timestamp
}

export interface PolygonSnapshot {
  ticker: string;
  todaysChange: number;
  todaysChangePerc: number;
  updated: number;
  day: {
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    vw: number;
  };
  min: {
    av: number;
    t: number;
    n: number;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    vw: number;
  };
  prevDay: {
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    vw: number;
  };
}

export class PolygonClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor() {
    this.apiKey = config.polygonApiKey || '';
    this.baseUrl = this.normalizeBaseUrl(config.polygonBaseUrl || 'https://api.massive.com');

    if (!this.apiKey) {
      logger.warn('Massive.com (Polygon) API key not configured');
    }
  }

  /**
   * Make request to Massive.com API (formerly Polygon)
   */
  private async request<T>(endpoint: string): Promise<T> {
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${this.baseUrl}${endpoint}${separator}apiKey=${this.apiKey}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Massive.com API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data: any = await response.json();

      // Check for API error in response
      if (data.status === 'ERROR') {
        throw new Error(`Massive.com API error: ${data.error || 'Unknown error'}`);
      }

      return data as T;
    } catch (error: any) {
      logger.error('Massive.com API request failed', error, { endpoint });
      throw error;
    }
  }

  private normalizeBaseUrl(url: string): string {
    return url.replace(/\/+$/, '');
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
      // Map timeframe to Polygon format
      const { multiplier, timespan } = this.mapTimeframe(timeframe);

      // Calculate date range
      const to = new Date();
      const from = new Date(to.getTime() - limit * this.getTimeframeMs(timeframe));

      const fromStr = from.toISOString().split('T')[0];
      const toStr = to.toISOString().split('T')[0];

      const endpoint = `/v2/aggs/ticker/${symbol}/range/${multiplier}/${timespan}/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=${limit}`;

      interface PolygonResponse {
        ticker: string;
        status: string;
        queryCount: number;
        resultsCount: number;
        adjusted: boolean;
        results: PolygonBar[];
      }

      const response = await this.request<PolygonResponse>(endpoint);

      if (!response.results || response.results.length === 0) {
        logger.warn('No bars returned from Massive.com', { symbol, timeframe });
        return [];
      }

      const candles: Candle[] = response.results.map((bar) => ({
        timestamp: new Date(bar.t),
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
      }));

      logger.debug('Massive.com candles fetched', {
        symbol,
        timeframe,
        count: candles.length,
      });

      return candles;
    } catch (error) {
      logger.error('Failed to fetch Massive.com candles', error, { symbol, timeframe });
      throw error;
    }
  }

  /**
   * Get latest quote
   */
  async getLatestQuote(symbol: string): Promise<{ bid: number; ask: number; mid: number }> {
    try {
      const endpoint = `/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}`;

      interface PolygonSnapshotResponse {
        status: string;
        ticker: PolygonSnapshot;
      }

      const response = await this.request<PolygonSnapshotResponse>(endpoint);

      // Use last trade price as mid, estimate bid/ask with small spread
      const last = response.ticker.day.c;
      const spread = last * 0.0001; // 0.01% spread estimate

      const bid = last - spread / 2;
      const ask = last + spread / 2;
      const mid = last;

      logger.debug('Massive.com quote fetched', { symbol, bid, ask, mid });

      return { bid, ask, mid };
    } catch (error) {
      logger.error('Failed to fetch Massive.com quote', error, { symbol });
      throw error;
    }
  }

  /**
   * Get option price
   */
  async getOptionPrice(
    symbol: string,
    strike: number,
    expiration: Date,
    optionType: 'call' | 'put'
  ): Promise<number> {
    try {
      // Format option symbol: O:SPY240119C00450000
      const optionSymbol = this.formatOptionSymbol(symbol, strike, expiration, optionType);

      const endpoint = `/v2/snapshot/locale/us/markets/stocks/tickers/${optionSymbol}`;

      interface PolygonSnapshotResponse {
        status: string;
        ticker: PolygonSnapshot;
      }

      const response = await this.request<PolygonSnapshotResponse>(endpoint);

      const price = response.ticker.day.c;

      logger.debug('Massive.com option price fetched', {
        optionSymbol,
        price,
      });

      return price;
    } catch (error) {
      logger.error('Failed to fetch Massive.com option price', error, {
        symbol,
        strike,
        expiration,
        optionType,
      });
      throw error;
    }
  }

  /**
   * Format option symbol in Massive.com format (same as Polygon)
   * Example: O:SPY240119C00450000
   */
  private formatOptionSymbol(
    underlying: string,
    strike: number,
    expiration: Date,
    optionType: 'call' | 'put'
  ): string {
    const year = expiration.getFullYear().toString().slice(-2);
    const month = (expiration.getMonth() + 1).toString().padStart(2, '0');
    const day = expiration.getDate().toString().padStart(2, '0');
    const type = optionType === 'call' ? 'C' : 'P';
    const strikeStr = (strike * 1000).toFixed(0).padStart(8, '0');

    return `O:${underlying}${year}${month}${day}${type}${strikeStr}`;
  }

  /**
   * Map internal timeframe to Polygon format
   */
  private mapTimeframe(timeframe: string): { multiplier: number; timespan: string } {
    const mapping: Record<string, { multiplier: number; timespan: string }> = {
      '1m': { multiplier: 1, timespan: 'minute' },
      '5m': { multiplier: 5, timespan: 'minute' },
      '15m': { multiplier: 15, timespan: 'minute' },
      '30m': { multiplier: 30, timespan: 'minute' },
      '1h': { multiplier: 1, timespan: 'hour' },
      '4h': { multiplier: 4, timespan: 'hour' },
      '1d': { multiplier: 1, timespan: 'day' },
    };

    return mapping[timeframe] || { multiplier: 5, timespan: 'minute' };
  }

  /**
   * Get timeframe duration in milliseconds
   */
  private getTimeframeMs(timeframe: string): number {
    const mapping: Record<string, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };

    return mapping[timeframe] || 5 * 60 * 1000;
  }

  /**
   * Check if market is open
   */
  async isMarketOpen(): Promise<boolean> {
    try {
      const endpoint = '/v1/marketstatus/now';

      interface MarketStatusResponse {
        market: string;
        serverTime: string;
        exchanges: {
          nasdaq: string;
          nyse: string;
          otc: string;
        };
        currencies: {
          fx: string;
          crypto: string;
        };
      }

      const response = await this.request<MarketStatusResponse>(endpoint);

      return response.exchanges.nyse === 'open';
    } catch (error) {
      logger.error('Failed to check Polygon market status', error);
      return false;
    }
  }

  /**
   * Get market hours information
   */
  async getMarketHours(): Promise<{
    isOpen: boolean;
    nextOpen?: Date;
    nextClose?: Date;
  }> {
    const isOpen = await this.isMarketOpen();
    return { isOpen };
  }
}
