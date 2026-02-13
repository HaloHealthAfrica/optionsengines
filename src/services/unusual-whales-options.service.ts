// Unusual Whales Options Service - Caching, option price, chain, OHLC, flow
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { cache } from './cache.service.js';
import {
  UnusualWhalesOptionsClient,
  UnusualWhalesOptionContract,
  UnusualWhalesIntradayTick,
} from './providers/unusual-whales-options-client.js';
import type { MarketDataOptionRow } from './providers/marketdata-client.js';
import type { OptionsFlowSummary, OptionsFlowEntry } from '../types/index.js';

const CHAIN_CACHE_TTL = 60;
const PRICE_CACHE_TTL = 30;

export interface OptionChainSummary {
  ticker: string;
  expiries: string[];
  strikes: number[];
  contracts: Array<{
    id: string;
    strike: number;
    expiration: string;
    type: 'call' | 'put';
    price?: number;
    volume?: number;
  }>;
  updatedAt: Date;
}

export class UnusualWhalesOptionsService {
  private readonly client = new UnusualWhalesOptionsClient();

  private get isConfigured(): boolean {
    return Boolean(config.unusualWhalesApiKey);
  }

  /**
   * Get option price for a specific contract (symbol, strike, expiration, type).
   * Uses chain cache when possible to minimize API calls.
   */
  async getOptionPrice(
    symbol: string,
    strike: number,
    expiration: Date,
    optionType: 'call' | 'put'
  ): Promise<number | null> {
    if (!this.isConfigured) {
      return null;
    }

    const expStr = expiration.toISOString().slice(0, 10);
    const cacheKey = `uw:price:${symbol}:${strike}:${expStr}:${optionType}`;
    const cached = cache.get<number>(cacheKey);
    if (cached != null && Number.isFinite(cached)) {
      return cached;
    }

    const contracts = await this.getCachedChain(symbol);
    const match = this.findContract(contracts, strike, expStr, optionType);

    if (match) {
      const price = this.extractPrice(match);
      if (price != null && Number.isFinite(price)) {
        cache.set(cacheKey, price, PRICE_CACHE_TTL);
        return price;
      }
    }

    // If not in chain, try fetching contract by searching chain again with fresh data
    const freshContracts = await this.client.getOptionContracts(symbol);
    const freshMatch = this.findContract(freshContracts, strike, expStr, optionType);
    if (freshMatch) {
      const price = this.extractPrice(freshMatch);
      if (price != null && Number.isFinite(price)) {
        cache.set(cacheKey, price, PRICE_CACHE_TTL);
        return price;
      }
    }

    logger.debug('Unusual Whales option price not found', { symbol, strike, expStr, optionType });
    return null;
  }

  /**
   * Get option chain summary (expiries, strikes, contracts with prices).
   */
  async getOptionChain(ticker: string): Promise<OptionChainSummary> {
    const contracts = await this.getCachedChain(ticker);

    const expiries = [...new Set(contracts.map((c) => c.expiration).filter(Boolean))].sort();
    const strikes = [...new Set(contracts.map((c) => c.strike).filter(Number.isFinite))].sort(
      (a, b) => a - b
    );

    const contractList = contracts.map((c) => ({
      id: c.id,
      strike: c.strike,
      expiration: c.expiration,
      type: c.type,
      price: this.extractPrice(c) ?? undefined,
      volume: c.volume ?? undefined,
    }));

    return {
      ticker,
      expiries,
      strikes,
      contracts: contractList,
      updatedAt: new Date(),
    };
  }

  /**
   * Get options flow from UW option chain (volume * premium per contract).
   * Used as fallback when MarketData.app flow is unavailable.
   */
  async getOptionsFlow(ticker: string, limit: number = 50): Promise<OptionsFlowSummary | null> {
    if (!this.isConfigured) return null;

    const contracts = await this.getCachedChain(ticker);
    if (!contracts.length) return null;

    const entries: OptionsFlowEntry[] = contracts
      .filter((c) => c.volume != null && c.volume > 0)
      .map((c) => {
        const price = c.premium ?? c.mid ?? (c.bid != null && c.ask != null ? (c.bid + c.ask) / 2 : c.last) ?? 0;
        const premium = Number.isFinite(price) ? (c.volume ?? 0) * price * 100 : 0;
        return {
          optionSymbol: `${c.ticker ?? ticker} ${c.expiration} ${c.strike} ${c.type}`,
          side: c.type,
          strike: c.strike,
          expiration: new Date(c.expiration),
          volume: c.volume ?? 0,
          premium,
          sentiment: (c.type === 'call' ? 'bullish' : 'bearish') as 'bullish' | 'bearish' | 'neutral',
          timestamp: new Date(),
        };
      })
      .sort((a, b) => (b.premium ?? 0) - (a.premium ?? 0))
      .slice(0, limit);

    return {
      symbol: ticker,
      entries,
      updatedAt: new Date(),
      source: 'unusualwhales',
    };
  }

  /**
   * Get option chain as MarketDataOptionRow[] for GEX/max-pain fallback.
   * UW does not provide gamma; those rows will have gamma undefined (GEX will be 0).
   */
  async getChainAsMarketDataRows(ticker: string): Promise<MarketDataOptionRow[]> {
    if (!this.isConfigured) {
      return [];
    }

    const contracts = await this.getCachedChain(ticker);
    return contracts.map((c) => ({
      optionSymbol: `${c.ticker ?? ticker} ${c.expiration} ${c.strike} ${c.type}`,
      strike: c.strike,
      expiration: c.expiration,
      optionType: c.type,
      openInterest: c.openInterest ?? c.open_interest,
      gamma: undefined,
      volume: c.volume,
      premium: c.premium ?? c.mid ?? c.last,
      timestamp: new Date().toISOString(),
    }));
  }

  /**
   * Get intraday OHLC for a contract.
   */
  async getOptionOHLC(
    contractId: string,
    date: string
  ): Promise<UnusualWhalesIntradayTick[]> {
    if (!this.isConfigured) {
      return [];
    }

    const cacheKey = `uw:intraday:${contractId}:${date}`;
    const cached = cache.get<UnusualWhalesIntradayTick[]>(cacheKey);
    if (cached && Array.isArray(cached)) {
      return cached;
    }

    const ticks = await this.client.getOptionIntraday(contractId, date);
    if (ticks.length > 0) {
      cache.set(cacheKey, ticks, 60); // 1 min cache for intraday
    }
    return ticks;
  }

  private async getCachedChain(ticker: string): Promise<UnusualWhalesOptionContract[]> {
    const cacheKey = `uw:chain:${ticker}`;
    const cached = cache.get<UnusualWhalesOptionContract[]>(cacheKey);
    if (cached && Array.isArray(cached)) {
      return cached;
    }

    const contracts = await this.client.getOptionContracts(ticker);
    if (contracts.length > 0) {
      cache.set(cacheKey, contracts, CHAIN_CACHE_TTL);
    }
    return contracts;
  }

  private findContract(
    contracts: UnusualWhalesOptionContract[],
    strike: number,
    expiration: string,
    optionType: 'call' | 'put'
  ): UnusualWhalesOptionContract | undefined {
    const expNorm = expiration.slice(0, 10);
    return contracts.find(
      (c) =>
        c.strike === strike &&
        c.expiration.slice(0, 10) === expNorm &&
        c.type === optionType
    );
  }

  private extractPrice(c: UnusualWhalesOptionContract): number | null {
    const mid = c.mid ?? (c.bid != null && c.ask != null ? (c.bid + c.ask) / 2 : null);
    const last = c.last ?? c.premium;
    return mid ?? last ?? null;
  }
}

export const unusualWhalesOptionsService = new UnusualWhalesOptionsService();
