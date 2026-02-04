// Alpaca API Client - Primary market data provider
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { Candle } from '../../types/index.js';

export interface AlpacaBar {
  t: string; // timestamp
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
}

export interface AlpacaQuote {
  ap: number; // ask price
  bp: number; // bid price
  as: number; // ask size
  bs: number; // bid size
  t: string;  // timestamp
}

export interface AlpacaOptionQuote {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  open_interest: number;
  timestamp: string;
}

export class AlpacaClient {
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly dataUrl: string;

  constructor() {
    this.apiKey = config.alpacaApiKey;
    this.secretKey = config.alpacaSecretKey;
    this.dataUrl = config.alpacaPaper
      ? 'https://data.alpaca.markets'
      : 'https://data.alpaca.markets';

    if (!this.apiKey || !this.secretKey) {
      logger.warn('Alpaca API credentials not configured');
    }
  }

  /**
   * Make authenticated request to Alpaca API
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.dataUrl}${endpoint}`;

    const headers = {
      'APCA-API-KEY-ID': this.apiKey,
      'APCA-API-SECRET-KEY': this.secretKey,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Alpaca API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();
      return data as T;
    } catch (error: any) {
      logger.error('Alpaca API request failed', error, { endpoint });
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
      // Map timeframe to Alpaca format
      const alpacaTimeframe = this.mapTimeframe(timeframe);

      // Calculate start date (limit bars back from now)
      const end = new Date();
      const start = new Date(end.getTime() - limit * this.getTimeframeMs(timeframe));

      const endpoint = `/v2/stocks/${symbol}/bars?timeframe=${alpacaTimeframe}&start=${start.toISOString()}&end=${end.toISOString()}&limit=${limit}`;

      interface AlpacaBarsResponse {
        bars: AlpacaBar[];
        symbol: string;
        next_page_token?: string;
      }

      const response = await this.request<AlpacaBarsResponse>(endpoint);

      if (!response.bars || response.bars.length === 0) {
        logger.warn('No bars returned from Alpaca', { symbol, timeframe });
        return [];
      }

      const candles: Candle[] = response.bars.map((bar) => ({
        timestamp: new Date(bar.t),
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
      }));

      logger.debug('Alpaca candles fetched', {
        symbol,
        timeframe,
        count: candles.length,
      });

      return candles;
    } catch (error) {
      logger.error('Failed to fetch Alpaca candles', error, { symbol, timeframe });
      throw error;
    }
  }

  /**
   * Get latest quote (bid/ask)
   */
  async getLatestQuote(symbol: string): Promise<{ bid: number; ask: number; mid: number }> {
    try {
      const endpoint = `/v2/stocks/${symbol}/quotes/latest`;

      interface AlpacaQuoteResponse {
        quote: AlpacaQuote;
        symbol: string;
      }

      const response = await this.request<AlpacaQuoteResponse>(endpoint);

      const bid = response.quote.bp;
      const ask = response.quote.ap;
      const mid = (bid + ask) / 2;

      return { bid, ask, mid };
    } catch (error) {
      logger.error('Failed to fetch Alpaca quote', error, { symbol });
      throw error;
    }
  }

  /**
   * Get option price (contract quote)
   */
  async getOptionPrice(
    symbol: string,
    strike: number,
    expiration: Date,
    optionType: 'call' | 'put'
  ): Promise<number> {
    try {
      // Format option symbol: SPY240119C00450000
      const optionSymbol = this.formatOptionSymbol(symbol, strike, expiration, optionType);

      // Use latest quote endpoint for options
      const endpoint = `/v2/stocks/${optionSymbol}/quotes/latest`;

      interface AlpacaQuoteResponse {
        quote: AlpacaQuote;
        symbol: string;
      }

      const response = await this.request<AlpacaQuoteResponse>(endpoint);

      // Use mid price (average of bid and ask)
      const bid = response.quote.bp;
      const ask = response.quote.ap;
      const mid = (bid + ask) / 2;

      logger.debug('Alpaca option price fetched', {
        optionSymbol,
        bid,
        ask,
        mid,
      });

      return mid;
    } catch (error) {
      logger.error('Failed to fetch Alpaca option price', error, {
        symbol,
        strike,
        expiration,
        optionType,
      });
      throw error;
    }
  }

  /**
   * Format option symbol in OCC format
   * Example: SPY240119C00450000 (SPY, Jan 19 2024, Call, $450 strike)
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

    return `${underlying}${year}${month}${day}${type}${strikeStr}`;
  }

  /**
   * Map internal timeframe to Alpaca format
   */
  private mapTimeframe(timeframe: string): string {
    const mapping: Record<string, string> = {
      '1m': '1Min',
      '5m': '5Min',
      '15m': '15Min',
      '30m': '30Min',
      '1h': '1Hour',
      '4h': '4Hour',
      '1d': '1Day',
    };

    return mapping[timeframe] || '5Min';
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
      const endpoint = '/v2/clock';

      interface ClockResponse {
        timestamp: string;
        is_open: boolean;
        next_open: string;
        next_close: string;
      }

      const response = await this.request<ClockResponse>(endpoint);
      return response.is_open;
    } catch (error) {
      logger.error('Failed to check market hours', error);
      // Default to closed on error
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
    try {
      const endpoint = '/v2/clock';

      interface ClockResponse {
        timestamp: string;
        is_open: boolean;
        next_open: string;
        next_close: string;
      }

      const response = await this.request<ClockResponse>(endpoint);

      return {
        isOpen: response.is_open,
        nextOpen: new Date(response.next_open),
        nextClose: new Date(response.next_close),
      };
    } catch (error) {
      logger.error('Failed to get market hours', error);
      return { isOpen: false };
    }
  }
}
