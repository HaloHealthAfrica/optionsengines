/**
 * Watchlist Manager - Max 10 active tickers
 * Gates all plan acceptance. Symbol must be in watchlist before plan is accepted.
 */

import { db } from '../database.service.js';
import { logger } from '../../utils/logger.js';
import { getStratPlanConfig } from './strat-plan-config.service.js';
import type { WatchlistEntry, WatchlistSource } from './types.js';

export interface AddToWatchlistResult {
  ok: boolean;
  reason?: string;
  entry?: WatchlistEntry;
}

export interface WatchlistStatus {
  count: number;
  atCapacity: boolean;
  entries: WatchlistEntry[];
}

export class WatchlistManager {
  /**
   * Check if symbol is in active watchlist
   */
  async isInWatchlist(symbol: string): Promise<boolean> {
    const normalized = symbol.toUpperCase().trim();
    const result = await db.query(
      `SELECT 1 FROM active_watchlist WHERE symbol = $1 AND active = TRUE LIMIT 1`,
      [normalized]
    );
    return result.rows.length > 0;
  }

  /**
   * Get current watchlist status
   */
  async getStatus(): Promise<WatchlistStatus> {
    const cfg = await getStratPlanConfig();
    const result = await db.query(
      `SELECT watchlist_id, symbol, added_at, source, priority_score, active, created_at, updated_at
       FROM active_watchlist
       WHERE active = TRUE
       ORDER BY priority_score DESC, added_at ASC`
    );

    const entries: WatchlistEntry[] = result.rows.map((row) => ({
      watchlist_id: row.watchlist_id,
      symbol: row.symbol,
      added_at: row.added_at,
      source: row.source,
      priority_score: Number(row.priority_score ?? 0),
      active: row.active,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    return {
      count: entries.length,
      atCapacity: entries.length >= cfg.maxWatchlistTickers,
      entries,
    };
  }

  /**
   * Add ticker to watchlist. Rejects if at capacity.
   */
  async add(
    symbol: string,
    source: WatchlistSource = 'manual',
    priorityScore: number = 0
  ): Promise<AddToWatchlistResult> {
    const normalized = symbol.toUpperCase().trim();
    if (!normalized) {
      return { ok: false, reason: 'Invalid symbol' };
    }

    const cfg = await getStratPlanConfig();
    const status = await this.getStatus();

    if (status.atCapacity && !status.entries.some((e) => e.symbol === normalized)) {
      return {
        ok: false,
        reason: `Watchlist at capacity (max ${cfg.maxWatchlistTickers}). Remove a ticker first or require manual confirmation to replace.`,
      };
    }

    try {
      const result = await db.query(
        `INSERT INTO active_watchlist (symbol, source, priority_score, active)
         VALUES ($1, $2, $3, TRUE)
         ON CONFLICT (symbol) DO UPDATE SET
           active = TRUE,
           source = EXCLUDED.source,
           priority_score = EXCLUDED.priority_score,
           updated_at = NOW()
         RETURNING watchlist_id, symbol, added_at, source, priority_score, active, created_at, updated_at`,
        [normalized, source, priorityScore]
      );

      const row = result.rows[0];
      const entry: WatchlistEntry = {
        watchlist_id: row.watchlist_id,
        symbol: row.symbol,
        added_at: row.added_at,
        source: row.source,
        priority_score: Number(row.priority_score ?? 0),
        active: row.active,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };

      logger.info('Watchlist add', { symbol: normalized, source, priority_score: priorityScore });
      return { ok: true, entry };
    } catch (err) {
      logger.error('Watchlist add failed', { symbol: normalized, error: err });
      return { ok: false, reason: 'Database error' };
    }
  }

  /**
   * Remove ticker from watchlist
   */
  async remove(symbol: string): Promise<{ ok: boolean; reason?: string }> {
    const normalized = symbol.toUpperCase().trim();
    const result = await db.query(
      `UPDATE active_watchlist SET active = FALSE, updated_at = NOW()
       WHERE symbol = $1 AND active = TRUE
       RETURNING watchlist_id`,
      [normalized]
    );

    if (result.rows.length === 0) {
      return { ok: false, reason: 'Symbol not in watchlist' };
    }

    logger.info('Watchlist remove', { symbol: normalized });
    return { ok: true };
  }

  /**
   * Reorder priority. Higher = more priority.
   */
  async setPriority(symbol: string, priorityScore: number): Promise<{ ok: boolean; reason?: string }> {
    const normalized = symbol.toUpperCase().trim();
    const result = await db.query(
      `UPDATE active_watchlist SET priority_score = $1, updated_at = NOW()
       WHERE symbol = $2 AND active = TRUE
       RETURNING watchlist_id`,
      [priorityScore, normalized]
    );

    if (result.rows.length === 0) {
      return { ok: false, reason: 'Symbol not in watchlist' };
    }

    return { ok: true };
  }

  /**
   * Add from webhook when auto-add is enabled and capacity allows
   */
  async addFromWebhookIfAllowed(symbol: string): Promise<AddToWatchlistResult> {
    const cfg = await getStratPlanConfig();
    if (!cfg.webhookAutoAddToWatchlist) {
      return { ok: false, reason: 'Webhook auto-add disabled' };
    }

    const status = await this.getStatus();
    if (status.atCapacity) {
      return { ok: false, reason: 'Watchlist full' };
    }

    return this.add(symbol, 'webhook', 0);
  }
}

export const watchlistManager = new WatchlistManager();
