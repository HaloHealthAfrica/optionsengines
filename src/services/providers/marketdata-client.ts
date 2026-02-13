// MarketData.app API Client - Additional market data provider
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { Candle } from '../../types/index.js';

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
}

export class MarketDataClient {
  private readonly apiKey: string;
  private readonly baseUrl: string = 'https://api.marketdata.app';

  constructor() {
    this.apiKey = config.marketDataApiKey;

    if (!this.apiKey) {
      logger.warn('MarketData.app API key not configured');
    }
  }

  /**
   * Make request to MarketData.app API.
   * 404 with {s:no_data} is a valid empty state - returns null to signal caller to use [].
   */
  private async request<T>(endpoint: string): Promise<T> {
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
   * Get options chain data for GEX calculations.
   * 404 no_data returns [] (valid empty state).
   */
  async getOptionsChain(symbol: string): Promise<MarketDataOptionRow[]> {
    try {
      const endpoint = `/v1/options/chain/${symbol}/`;
      const response = await this.request<any>(endpoint);

      if (response?.s === 'no_data') {
        return [];
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
   */
  async getOptionsFlow(symbol: string, limit: number = 50): Promise<MarketDataOptionRow[]> {
    try {
      const endpoint = `/v1/options/flow/${symbol}/?limit=${limit}`;
      const response = await this.request<any>(endpoint);

      if (response?.s === 'no_data') {
        return [];
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

  /**
   * Check if market is open (simplified)
   */
  async isMarketOpen(): Promise<boolean> {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

    const day = et.getDay();
    const hour = et.getHours();
    const minute = et.getMinutes();

    // Weekend check
    if (day === 0 || day === 6) {
      return false;
    }

    // Market hours: 9:30 AM - 4:00 PM ET
    const currentMinutes = hour * 60 + minute;
    const marketOpen = 9 * 60 + 30;
    const marketClose = 16 * 60;

    return currentMinutes >= marketOpen && currentMinutes < marketClose;
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
