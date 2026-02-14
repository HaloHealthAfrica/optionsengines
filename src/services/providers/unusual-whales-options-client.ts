// Unusual Whales Options API Client - Option chain, price, and intraday data
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { rateLimiter } from '../rate-limiter.service.js';

const BASE_URL = 'https://api.unusualwhales.com/api';

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

  /**
   * Fetch net premium ticks for a ticker. Returns call/put volume and premium per tick.
   * GET /stock/:ticker/net-prem-ticks?date=YYYY-MM-DD
   * This is the proper flow endpoint - option-contracts (chain) typically has no volume.
   */
  async getNetPremTicks(ticker: string, date?: string): Promise<UnusualWhalesNetPremTick[]> {
    if (!this.apiKey) return [];

    if (!(await this.rateLimit())) return [];

    const dateStr = date ?? new Date().toISOString().slice(0, 10);
    // Try with date param; some UW plans may use different param (e.g. date, trading_date)
    const url = `${BASE_URL}/stock/${encodeURIComponent(ticker)}/net-prem-ticks?date=${dateStr}`;

    try {
      const response = await fetch(url, { headers: this.headers });
      if (!response.ok) {
        const text = await response.text();
        logger.warn('UW net-prem-ticks request failed', { status: response.status, ticker, body: text.slice(0, 150) });
        return [];
      }
      const payload = (await response.json()) as Record<string, unknown>;
      const data = payload?.data ?? payload?.ticks ?? payload?.result ?? payload;
      const arr = Array.isArray(data) ? data : [];
      const ticks = arr.map((r: unknown) => this.normalizeNetPremTick(r as Record<string, unknown>));
      logger.debug('UW net-prem-ticks fetched', { ticker, count: ticks.length });
      return ticks;
    } catch (error) {
      logger.error('UW net-prem-ticks fetch failed', { error, ticker });
      throw error;
    }
  }

  private normalizeNetPremTick(r: Record<string, unknown>): UnusualWhalesNetPremTick {
    // API returns net_call_volume, net_put_volume (can be negative)
    const callVol = this.toNum(r.net_call_volume ?? r.call_volume ?? r.callVolume ?? r.call_vol) ?? 0;
    const putVol = this.toNum(r.net_put_volume ?? r.put_volume ?? r.putVolume ?? r.put_vol) ?? 0;
    // API returns net_call_premium, net_put_premium (can be negative)
    const callPrem = this.toNum(r.net_call_premium ?? r.call_premium ?? r.callPremium ?? r.netCallPremium) ?? 0;
    const putPrem = this.toNum(r.net_put_premium ?? r.put_premium ?? r.putPremium ?? r.netPutPremium) ?? 0;
    const netPrem = this.toNum(r.net_premium ?? r.netPremium ?? r.net_prem ?? r.netPrem ?? r.net_premium_flow) ?? (callPrem - putPrem);
    // API uses tape_time (ISO string); fallback to timestamp/time/t
    const tsRaw = r.tape_time ?? r.timestamp ?? r.time ?? r.t;
    const ts = typeof tsRaw === 'string' ? new Date(tsRaw).getTime() : this.toNum(tsRaw);
    return {
      timestamp: Number.isFinite(ts) ? ts : Date.now(),
      callVolume: callVol,
      putVolume: putVol,
      callPremium: callPrem,
      putPremium: putPrem,
      netPremium: netPrem,
    };
  }

  /**
   * Fetch flow per strike intraday. Returns flow data by strike for a trading day.
   * GET /stock/:ticker/flow-per-strike-intraday?date=YYYY-MM-DD
   */
  async getFlowPerStrikeIntraday(ticker: string, date?: string): Promise<UnusualWhalesFlowPerStrikeRow[]> {
    if (!this.apiKey) return [];

    if (!(await this.rateLimit())) return [];

    const dateStr = date ?? new Date().toISOString().slice(0, 10);
    const url = `${BASE_URL}/stock/${encodeURIComponent(ticker)}/flow-per-strike-intraday?date=${dateStr}`;

    try {
      const response = await fetch(url, { headers: this.headers });
      if (!response.ok) {
        logger.warn('UW flow-per-strike-intraday request failed', { status: response.status, ticker });
        return [];
      }
      const payload = (await response.json()) as Record<string, unknown>;
      const data = payload?.data ?? payload?.result ?? payload;
      const arr = Array.isArray(data) ? data : [];
      return arr.map((r: unknown) => this.normalizeFlowPerStrikeRow(r as Record<string, unknown>));
    } catch (error) {
      logger.warn('UW flow-per-strike-intraday fetch failed', { error, ticker });
      return [];
    }
  }

  private normalizeFlowPerStrikeRow(r: Record<string, unknown>): UnusualWhalesFlowPerStrikeRow {
    const callPrem = this.toNum(r.call_premium ?? r.callPremium) ?? 0;
    const putPrem = this.toNum(r.put_premium ?? r.putPremium) ?? 0;
    const callVol = this.toNum(r.call_volume ?? r.callVolume) ?? 0;
    const putVol = this.toNum(r.put_volume ?? r.putVolume) ?? 0;
    return {
      strike: this.toNum(r.strike ?? r.strike_price) ?? 0,
      callPremium: callPrem,
      putPremium: putPrem,
      callVolume: callVol,
      putVolume: putVol,
      netPremium: callPrem - putPrem,
    };
  }

  /**
   * Fetch flow alerts from UW. Used for Phase 10 flow-first signals.
   * GET /option-trades/flow-alerts?newer_than=timestamp
   */
  async getFlowAlerts(newerThanMs?: number): Promise<UnusualWhalesFlowAlert[]> {
    if (!this.apiKey) return [];

    if (!(await this.rateLimit())) return [];

    let url = `${BASE_URL}/option-trades/flow-alerts`;
    if (newerThanMs != null && Number.isFinite(newerThanMs)) {
      url += `?newer_than=${newerThanMs}`;
    }

    try {
      const response = await fetch(url, { headers: this.headers });
      if (!response.ok) {
        logger.warn('UW flow-alerts request failed', { status: response.status });
        return [];
      }
      const payload = (await response.json()) as Record<string, unknown>;
      const data = payload?.data ?? payload?.result ?? payload;
      const arr = Array.isArray(data) ? data : (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).alerts))
        ? ((data as Record<string, unknown>).alerts as unknown[])
        : [];
      return arr.map((r: unknown) => this.normalizeFlowAlert(r as Record<string, unknown>));
    } catch (error) {
      logger.error('UW flow-alerts fetch failed', { error });
      return [];
    }
  }

  private normalizeFlowAlert(r: Record<string, unknown>): UnusualWhalesFlowAlert {
    const typeRaw = r.option_type ?? r.type ?? r.side ?? 'call';
    const type: 'call' | 'put' = String(typeRaw).toLowerCase() === 'put' ? 'put' : 'call';
    return {
      ticker: String(r.ticker ?? r.symbol ?? r.underlying ?? ''),
      type,
      strike: this.toNum(r.strike ?? r.strike_price) ?? 0,
      expiry: String(r.expiration ?? r.expiry ?? r.exp ?? ''),
      premium: this.toNum(r.premium ?? r.notional) ?? 0,
      size: this.toNum(r.size ?? r.volume ?? r.contracts) ?? 0,
      sentiment: (r.sentiment === 'bearish' ? 'bearish' : r.sentiment === 'bullish' ? 'bullish' : 'neutral') as 'bullish' | 'bearish' | 'neutral',
      unusual: Boolean(r.unusual ?? r.sweep),
      timestamp: this.toNum(r.timestamp ?? r.time) ?? Date.now(),
    };
  }
}

export interface UnusualWhalesNetPremTick {
  timestamp: number;
  callVolume: number;
  putVolume: number;
  callPremium: number;
  putPremium: number;
  netPremium: number;
}

export interface UnusualWhalesFlowPerStrikeRow {
  strike: number;
  callPremium: number;
  putPremium: number;
  callVolume: number;
  putVolume: number;
  netPremium: number;
}

export interface UnusualWhalesFlowAlert {
  ticker: string;
  type: 'call' | 'put';
  strike: number;
  expiry: string;
  premium: number;
  size: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  unusual: boolean;
  timestamp: number;
}
