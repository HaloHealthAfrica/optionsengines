// Unusual Whales Options API Client - Option chain, price, and intraday data
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { rateLimiter } from '../rate-limiter.service.js';

const BASE_URL = 'https://api.unusualwhales.com';

export interface UnusualWhalesOptionContract {
  id: string;
  symbol: string;
  ticker: string;
  strike: number;
  expiration: string;
  expiry?: string;
  type: 'call' | 'put';
  optionType?: 'call' | 'put';
  bid?: number;
  ask?: number;
  last?: number;
  mid?: number;
  premium?: number;
  volume?: number;
  openInterest?: number;
  open_interest?: number;
  [key: string]: unknown;
}

export interface UnusualWhalesIntradayTick {
  timestamp: string;
  time?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  premium?: number;
  volume?: number;
  [key: string]: unknown;
}

type RawContract = Record<string, unknown>;

export class UnusualWhalesOptionsClient {
  private readonly apiKey = config.unusualWhalesApiKey;

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    };
  }

  private async rateLimit(): Promise<boolean> {
    const minuteOk = await rateLimiter.tryAcquire('unusualwhales-minute');
    const dayOk = await rateLimiter.tryAcquire('unusualwhales-day');
    if (!minuteOk || !dayOk) {
      logger.warn('Unusual Whales rate limit exceeded');
      return false;
    }
    return true;
  }

  /**
   * Fetch option contracts for a ticker (option chain).
   * GET /stock/:ticker/option-contracts
   */
  async getOptionContracts(ticker: string): Promise<UnusualWhalesOptionContract[]> {
    if (!this.apiKey) {
      logger.warn('Unusual Whales API key not configured');
      return [];
    }

    if (!(await this.rateLimit())) {
      return [];
    }

    const url = `${BASE_URL}/stock/${encodeURIComponent(ticker)}/option-contracts`;

    try {
      const response = await fetch(url, { headers: this.headers });

      if (!response.ok) {
        const text = await response.text();
        logger.warn('Unusual Whales option-contracts request failed', {
          status: response.status,
          ticker,
          body: text.slice(0, 200),
        });
        return [];
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const rows = this.extractContractsArray(payload);
      const normalized = rows.map((r) => this.normalizeContract(r, ticker));
      const valid = normalized.filter(
        (c) => c.id && Number.isFinite(c.strike) && c.expiration && (c.type === 'call' || c.type === 'put')
      );

      logger.debug('Unusual Whales option-contracts fetched', { ticker, count: valid.length });
      return valid;
    } catch (error) {
      logger.error('Unusual Whales option-contracts fetch failed', { error, ticker });
      throw error;
    }
  }

  private extractContractsArray(payload: Record<string, unknown>): RawContract[] {
    const data = payload?.data ?? payload?.result ?? payload?.contracts ?? payload;
    if (Array.isArray(data)) {
      return data as RawContract[];
    }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const items = (data as Record<string, unknown>).options ?? (data as Record<string, unknown>).contracts;
      if (Array.isArray(items)) {
        return items as RawContract[];
      }
    }
    return [];
  }

  private normalizeContract(row: RawContract, ticker: string): UnusualWhalesOptionContract {
    const typeRaw = row.option_type ?? row.type ?? row.side ?? row.call_put ?? row.cp ?? '';
    const type: 'call' | 'put' =
      String(typeRaw).toLowerCase() === 'call' || typeRaw === 'C' ? 'call' : 'put';

    const bid = this.toNum(row.bid ?? row.bp);
    const ask = this.toNum(row.ask ?? row.ap);
    const last = this.toNum(row.last ?? row.close ?? row.premium ?? row.c);
    const mid = bid != null && ask != null ? (bid + ask) / 2 : last;

    return {
      id: String(row.id ?? row.contract_id ?? row.option_contract_id ?? ''),
      symbol: String(row.symbol ?? row.option_symbol ?? ticker),
      ticker: String(row.ticker ?? row.underlying ?? ticker),
      strike: Number(row.strike ?? row.k ?? row.strike_price ?? 0),
      expiration: this.normalizeExpiry(row.expiration ?? row.expiry ?? row.exp ?? row.expiration_date),
      type,
      bid: bid ?? undefined,
      ask: ask ?? undefined,
      last: last ?? undefined,
      mid: mid ?? undefined,
      premium: (this.toNum(row.premium ?? row.notional) ?? last ?? null) ?? undefined,
      volume: this.toNum(row.volume ?? row.vol) ?? undefined,
      openInterest: this.toNum(row.open_interest ?? row.oi ?? row.openInterest) ?? undefined,
    };
  }

  private normalizeExpiry(value: unknown): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }

  private toNum(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Fetch a single option contract by ID.
   * GET /option-contract/:id
   */
  async getOptionContractById(contractId: string): Promise<UnusualWhalesOptionContract | null> {
    if (!this.apiKey || !contractId) {
      return null;
    }

    if (!(await this.rateLimit())) {
      return null;
    }

    const url = `${BASE_URL}/option-contract/${encodeURIComponent(contractId)}`;

    try {
      const response = await fetch(url, { headers: this.headers });

      if (!response.ok) {
        logger.warn('Unusual Whales option-contract by id failed', {
          status: response.status,
          contractId,
        });
        return null;
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const data = payload?.data ?? payload?.result ?? payload;
      if (!data || typeof data !== 'object') return null;

      const ticker = String((data as Record<string, unknown>).ticker ?? (data as Record<string, unknown>).symbol ?? '');
      return this.normalizeContract(data as RawContract, ticker);
    } catch (error) {
      logger.error('Unusual Whales option-contract fetch failed', { error, contractId });
      return null;
    }
  }

  /**
   * Fetch intraday OHLC and premium for a contract.
   * GET /option-contract/:id/intraday?date=YYYY-MM-DD
   */
  async getOptionIntraday(
    contractId: string,
    date: string
  ): Promise<UnusualWhalesIntradayTick[]> {
    if (!this.apiKey || !contractId) {
      return [];
    }

    if (!(await this.rateLimit())) {
      return [];
    }

    const url = `${BASE_URL}/option-contract/${encodeURIComponent(contractId)}/intraday?date=${date}`;

    try {
      const response = await fetch(url, { headers: this.headers });

      if (!response.ok) {
        logger.warn('Unusual Whales intraday request failed', {
          status: response.status,
          contractId,
          date,
        });
        return [];
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const data = payload?.data ?? payload?.result ?? payload?.ticks ?? payload;
      const arr = Array.isArray(data) ? data : (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).ticks))
        ? ((data as Record<string, unknown>).ticks as unknown[])
        : [];

      const ticks: UnusualWhalesIntradayTick[] = arr.map((t: unknown) => {
        const r = t as Record<string, unknown>;
        return {
          timestamp: String(r.timestamp ?? r.time ?? r.t ?? ''),
          open: this.toNum(r.open ?? r.o) ?? undefined,
          high: this.toNum(r.high ?? r.h) ?? undefined,
          low: this.toNum(r.low ?? r.l) ?? undefined,
          close: this.toNum(r.close ?? r.c) ?? undefined,
          premium: this.toNum(r.premium ?? r.close ?? r.c) ?? undefined,
          volume: this.toNum(r.volume ?? r.v) ?? undefined,
        };
      });

      logger.debug('Unusual Whales intraday fetched', { contractId, date, count: ticks.length });
      return ticks;
    } catch (error) {
      logger.error('Unusual Whales intraday fetch failed', { error, contractId, date });
      return [];
    }
  }
}
