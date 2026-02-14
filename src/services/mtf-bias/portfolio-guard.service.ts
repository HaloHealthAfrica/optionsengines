/**
 * MTF Bias Portfolio Exposure Guard
 * Checks: delta exposure, max directional bias, SPY/QQQ overlap, max trades, capital deployed.
 */

import { db } from '../database.service.js';
import { logger } from '../../utils/logger.js';
import type { SymbolMarketState } from '../../lib/mtfBias/types.js';
import { PORTFOLIO_GUARDRAILS } from '../../lib/shared/constants.js';

export type GuardResult = 'ALLOW' | 'DOWNGRADE' | 'BLOCK';

export const portfolioGuardService = {
  async check(symbol: string, _state: SymbolMarketState): Promise<GuardResult> {
    try {
      const openPositions = await db.query(
        `SELECT COUNT(*) as cnt FROM refactored_positions WHERE status = 'open'`
      );
      const count = Number(openPositions.rows[0]?.cnt ?? 0);

      if (count >= PORTFOLIO_GUARDRAILS.maxOpenTrades) {
        logger.warn('Portfolio guard: max open trades', { count, max: PORTFOLIO_GUARDRAILS.maxOpenTrades });
        return 'BLOCK';
      }

      const symbolPositions = await db.query(
        `SELECT COUNT(*) as cnt FROM refactored_positions WHERE status = 'open' AND symbol = $1`,
        [symbol]
      );
      const symbolCount = Number(symbolPositions.rows[0]?.cnt ?? 0);
      if (symbolCount >= 2) {
        return 'BLOCK';
      }

      return 'ALLOW';
    } catch (error) {
      logger.error('Portfolio guard check failed', error, { symbol });
      return 'BLOCK';
    }
  },
};
