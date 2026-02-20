/**
 * IMarketDataProvider — Formal interface for all market data providers.
 *
 * Phase 3c: Establishes a common contract so providers can be swapped,
 * health-checked, and circuit-broken uniformly.
 *
 * Not every provider supports every method. Optional methods return null
 * when unsupported. The `healthCheck()` method allows the orchestrator
 * to probe provider availability without side effects.
 */

import type { Candle } from '../../types/index.js';

/** Quote with bid/ask/mid */
export interface ProviderQuote {
  bid: number;
  ask: number;
  mid: number;
}

/** Market hours info */
export interface MarketHoursInfo {
  isOpen: boolean;
  nextOpen?: Date;
  nextClose?: Date;
  minutesUntilClose?: number;
  isMarketOpen?: boolean;
}

/** Provider health status */
export interface ProviderHealthStatus {
  provider: string;
  healthy: boolean;
  latencyMs: number;
  lastError?: string;
  circuitBreakerState?: 'closed' | 'open' | 'half-open';
}

/**
 * Common interface for all market data providers.
 *
 * Providers MUST implement:
 *   - name (string identifier)
 *   - healthCheck()
 *
 * Providers SHOULD implement as many data methods as they support.
 * Methods that are not supported should not be present (checked via `in` operator).
 */
export interface IMarketDataProvider {
  /** Unique provider name (e.g. 'twelvedata', 'marketdata', 'polygon') */
  readonly name: string;

  /**
   * Non-destructive health check. Should complete quickly (<5s).
   * Returns health status including latency.
   */
  healthCheck(): Promise<ProviderHealthStatus>;

  /** Fetch historical candles */
  getCandles?(symbol: string, timeframe: string, limit: number): Promise<Candle[]>;

  /** Fetch latest quote (bid/ask/mid) */
  getLatestQuote?(symbol: string): Promise<ProviderQuote>;

  /** Fetch option contract price. Returns null when data unavailable. */
  getOptionPrice?(
    symbol: string,
    strike: number,
    expiration: Date,
    optionType: 'call' | 'put'
  ): Promise<number | null>;

  /** Check if market is currently open */
  isMarketOpen?(): Promise<boolean>;

  /** Get full market hours info */
  getMarketHours?(): Promise<MarketHoursInfo>;
}
