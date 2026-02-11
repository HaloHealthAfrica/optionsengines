// TwelveData API Client - Backup market data provider
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { Candle } from '../../types/index.js';

export interface TwelveDataBar {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface TwelveDataQuote {
  symbol: string;
  name: string;
  price: string;
  change: string;
  percent_change: string;
  timestamp: number;
}

export class TwelveDataClient {
  private readonly apiKey: string;
  private readonly baseUrl: string = 'https://api.twelvedata.com';

  constructor() {
    this.apiKey = config.twelveDataApiKey;

    if (!this.apiKey) {
      logger.warn('TwelveData API key not configured');
    }
  }

  /**
   * Make request to TwelveData API
   */
  private async request<T>(
    endpoint: string,
    params: Record<string, string> = {}
  ): Promise<T> {
    const queryParams = new URLSearchParams({
      apikey: this.apiKey,
      ...params,
    });

    const url = `${this.baseUrl}${endpoint}?${queryParams.toString()}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `TwelveData API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data: any = await response.json();

      // Check for API error in response
      if (data.status === 'error') {
        throw new Error(`TwelveData API error: ${data.message || 'Unknown error'}`);
      }

      return data as T;
    } catch (error: any) {
      logger.error('TwelveData API request failed', error, { endpoint });
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
      // Map timeframe to TwelveData format
      const twelveDataInterval = this.mapTimeframe(timeframe);

      const endpoint = '/time_series';
      const params = {
        symbol,
        interval: twelveDataInterval,
        outputsize: limit.toString(),
        format: 'JSON',
      };

      interface TwelveDataResponse {
        meta: {
          symbol: string;
          interval: string;
          currency: string;
          exchange_timezone: string;
          exchange: string;
          type: string;
        };
        values: TwelveDataBar[];
        status: string;
      }

      const response = await this.request<TwelveDataResponse>(endpoint, params);

      if (!response.values || response.values.length === 0) {
        logger.warn('No bars returned from TwelveData', { symbol, timeframe });
        return [];
      }

      const candles: Candle[] = response.values.map((bar) => ({
        timestamp: new Date(bar.datetime),
        open: parseFloat(bar.open),
        high: parseFloat(bar.high),
        low: parseFloat(bar.low),
        close: parseFloat(bar.close),
        volume: parseFloat(bar.volume),
      }));

      // TwelveData returns newest first, reverse to oldest first
      candles.reverse();

      logger.debug('TwelveData candles fetched', {
        symbol,
        timeframe,
        count: candles.length,
      });

      return candles;
    } catch (error) {
      logger.error('Failed to fetch TwelveData candles', error, { symbol, timeframe });
      throw error;
    }
  }

  /**
   * Get latest quote
   */
  async getLatestQuote(symbol: string): Promise<{ price: number }> {
    try {
      const endpoint = '/quote';
      const params = { symbol };

      const response = await this.request<TwelveDataQuote>(endpoint, params);

      const price = parseFloat(response.price);

      logger.debug('TwelveData quote fetched', { symbol, price });

      return { price };
    } catch (error) {
      logger.error('Failed to fetch TwelveData quote', error, { symbol });
      throw error;
    }
  }

  /**
   * Get option price (not supported by TwelveData free tier)
   * This is a placeholder that throws an error
   */
  async getOptionPrice(
    _symbol: string,
    _strike: number,
    _expiration: Date,
    _optionType: 'call' | 'put'
  ): Promise<number> {
    throw new Error('Option pricing not supported by TwelveData free tier');
  }

  /**
   * Map internal timeframe to TwelveData format
   */
  private mapTimeframe(timeframe: string): string {
    const mapping: Record<string, string> = {
      '1m': '1min',
      '5m': '5min',
      '15m': '15min',
      '30m': '30min',
      '1h': '1h',
      '4h': '4h',
      '1d': '1day',
    };

    return mapping[timeframe] || '5min';
  }

  /**
   * Check if market is open (simplified - checks NYSE hours)
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
    const marketOpen = 9 * 60 + 30; // 9:30 AM
    const marketClose = 16 * 60; // 4:00 PM

    return currentMinutes >= marketOpen && currentMinutes < marketClose;
  }

  /**
   * Get market hours information (simplified)
   */
  async getMarketHours(): Promise<{
    isOpen: boolean;
    nextOpen?: Date;
    nextClose?: Date;
  }> {
    const isOpen = await this.isMarketOpen();
    
    // Simplified - doesn't calculate exact next open/close
    return { isOpen };
  }
}
