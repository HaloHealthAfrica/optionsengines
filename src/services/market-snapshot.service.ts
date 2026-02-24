/**
 * MarketSnapshotService — builds a complete MarketSnapshot for the UDC.
 * Fetches underlying price + options chain from existing providers,
 * applies staleness enforcement, and adapts to UDC OptionChainEntry format.
 */

import { marketData } from './market-data.js';
import { adaptOptionChain } from './option-chain-adapter.service.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { MarketSnapshot, OptionChainEntry } from '../lib/udc/types.js';
import type { MarketDataOptionRow } from './providers/marketdata-client.js';

export interface SnapshotRequirements {
  needOptionsChain: boolean;
  dteMin?: number;
  dteMax?: number;
  /** Strike window as fraction of spot price (e.g. 0.10 = +/- 10%) */
  strikeWindowPct?: number;
  needGreeks?: boolean;
}

const DEFAULT_STRIKE_WINDOW_PCT = 0.10;
const DEFAULT_DTE_MIN = 0;
const DEFAULT_DTE_MAX = 45;

export const UDC_MAX_STALENESS_MS = config.staleDataMaxAgeMs ?? 120_000;

export class MarketSnapshotService {
  /**
   * Builds a MarketSnapshot for the given symbol.
   * Throws on stale data so the UDC can return BLOCKED with STALE_SNAPSHOT.
   */
  async getSnapshot(
    symbol: string,
    requirements: SnapshotRequirements,
  ): Promise<MarketSnapshot> {
    const fetchStart = Date.now();

    const price = await this.fetchPrice(symbol);
    const priceAge = Date.now() - fetchStart;

    if (priceAge > UDC_MAX_STALENESS_MS) {
      throw new StaleSnapshotError(
        `Underlying price for ${symbol} is stale (${priceAge}ms > ${UDC_MAX_STALENESS_MS}ms)`,
      );
    }

    let chain: OptionChainEntry[] | null = null;

    if (requirements.needOptionsChain) {
      const chainStart = Date.now();
      chain = await this.fetchChain(symbol, price, requirements);
      const chainAge = Date.now() - chainStart;

      if (chainAge > UDC_MAX_STALENESS_MS) {
        throw new StaleSnapshotError(
          `Options chain for ${symbol} is stale (${chainAge}ms > ${UDC_MAX_STALENESS_MS}ms)`,
        );
      }
    }

    return {
      symbol,
      price,
      timestamp: Date.now(),
      chain,
      stale: false,
    };
  }

  private async fetchPrice(symbol: string): Promise<number> {
    const price = await marketData.getStockPrice(symbol);
    if (!price || !Number.isFinite(price) || price <= 0) {
      throw new StaleSnapshotError(`Unable to fetch valid price for ${symbol}`);
    }
    return price;
  }

  private async fetchChain(
    symbol: string,
    spotPrice: number,
    req: SnapshotRequirements,
  ): Promise<OptionChainEntry[]> {
    const rawRows: MarketDataOptionRow[] = await marketData.getOptionsChain(symbol);

    if (!rawRows || rawRows.length === 0) {
      throw new StaleSnapshotError(`Options chain empty for ${symbol}`);
    }

    const dteMin = req.dteMin ?? DEFAULT_DTE_MIN;
    const dteMax = req.dteMax ?? DEFAULT_DTE_MAX;
    const windowPct = req.strikeWindowPct ?? DEFAULT_STRIKE_WINDOW_PCT;
    const strikeLow = spotPrice * (1 - windowPct);
    const strikeHigh = spotPrice * (1 + windowPct);

    const filteredRows = rawRows.filter((row) => {
      if (row.strike < strikeLow || row.strike > strikeHigh) return false;
      if (!row.expiration) return false;
      const expiryDate = new Date(row.expiration);
      const dte = Math.max(0, Math.ceil((expiryDate.getTime() - Date.now()) / 86_400_000));
      if (dte < dteMin || dte > dteMax) return false;
      return true;
    });

    const callContracts = adaptOptionChain(filteredRows, spotPrice, 'call');
    const putContracts = adaptOptionChain(filteredRows, spotPrice, 'put');
    const allContracts = [...callContracts, ...putContracts];

    const entries: OptionChainEntry[] = allContracts.map((c) => ({
      symbol: `${symbol}_${c.expiry}_${c.strike}`,
      expiry: c.expiry,
      dte: c.dte,
      strike: c.strike,
      type: callContracts.includes(c) ? 'CALL' as const : 'PUT' as const,
      bid: c.bid,
      ask: c.ask,
      mid: c.mid,
      delta: c.greeks.delta,
      gamma: c.greeks.gamma,
      theta: c.greeks.theta,
      vega: c.greeks.vega,
      iv: c.iv,
      volume: c.volume,
      openInterest: c.openInterest,
    }));

    logger.info('MarketSnapshotService: chain built', {
      symbol,
      rawCount: rawRows.length,
      filteredCount: filteredRows.length,
      outputCount: entries.length,
      dteRange: `${dteMin}-${dteMax}`,
      strikeWindow: `${strikeLow.toFixed(1)}-${strikeHigh.toFixed(1)}`,
    });

    return entries;
  }
}

export class StaleSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleSnapshotError';
  }
}

export const marketSnapshotService = new MarketSnapshotService();
