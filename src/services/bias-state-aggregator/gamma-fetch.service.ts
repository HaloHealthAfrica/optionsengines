/**
 * Gamma Fetch - Fetches latest gamma from gamma_context for merge into UnifiedBiasState.
 */

import { db } from '../database.service.js';
import type { GammaContextNormalizedV1 } from '../../lib/gammaContext/schemas.js';

/** Fetch latest gamma context for symbol from gamma_context table */
export async function fetchLatestGamma(symbol: string): Promise<GammaContextNormalizedV1 | null> {
  try {
    const r = await db.query(
      `SELECT symbol, as_of_ts_ms, net_gex, total_gex,
              gamma_environment, gamma_magnitude,
              gamma_flip_level, distance_to_flip,
              call_wall, put_wall, wall_method,
              zero_dte_gamma_ratio, vol_regime_bias
       FROM gamma_context
       WHERE symbol = $1
       ORDER BY as_of_ts_ms DESC
       LIMIT 1`,
      [symbol.toUpperCase()]
    );
    const row = r.rows[0];
    if (!row) return null;

    return {
      symbol: row.symbol,
      as_of_ts_ms: Number(row.as_of_ts_ms),
      net_gex: Number(row.net_gex),
      total_gex: Number(row.total_gex),
      gamma_environment: row.gamma_environment,
      gamma_magnitude: row.gamma_magnitude,
      gamma_flip_level: row.gamma_flip_level != null ? Number(row.gamma_flip_level) : null,
      distance_to_flip: row.distance_to_flip != null ? Number(row.distance_to_flip) : null,
      call_wall: row.call_wall != null ? Number(row.call_wall) : null,
      put_wall: row.put_wall != null ? Number(row.put_wall) : null,
      wall_method: row.wall_method,
      zero_dte_gamma_ratio: row.zero_dte_gamma_ratio != null ? Number(row.zero_dte_gamma_ratio) : null,
      vol_regime_bias: row.vol_regime_bias,
    } as GammaContextNormalizedV1;
  } catch {
    return null;
  }
}
