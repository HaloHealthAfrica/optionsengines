import { db } from './database.service.js';
import { logger } from '../utils/logger.js';

export interface PortfolioGreeks {
  netDelta: number;
  netGamma: number;
  netVega: number;
  netTheta: number;
  positionCount: number;
}

const MAX_ABS_DELTA = 500;
const MAX_ABS_GAMMA = 200;
const MAX_ABS_VEGA = 1000;

const STALE_GREEKS_SAFETY_MULTIPLIER = 1.5;

export async function getPortfolioGreeks(): Promise<PortfolioGreeks> {
  try {
    const result = await db.query(
      `SELECT
         delta_at_entry,
         gamma_at_entry,
         vega_at_entry,
         theta_at_entry,
         quantity,
         expiration,
         entry_timestamp
       FROM refactored_positions
       WHERE status IN ('open', 'closing')
         AND COALESCE(is_test, false) = false`
    );

    let netDelta = 0;
    let netGamma = 0;
    let netVega = 0;
    let netTheta = 0;
    const now = new Date();

    for (const row of result.rows) {
      const qty = Number(row.quantity ?? 0);
      const deltaEntry = Number(row.delta_at_entry ?? 0);
      const gammaEntry = Number(row.gamma_at_entry ?? 0);
      const vegaEntry = Number(row.vega_at_entry ?? 0);
      const thetaEntry = Number(row.theta_at_entry ?? 0);

      const expiration = row.expiration ? new Date(row.expiration) : null;
      const entryTime = row.entry_timestamp ? new Date(row.entry_timestamp) : null;

      let decayFactor = STALE_GREEKS_SAFETY_MULTIPLIER;
      if (expiration && entryTime) {
        const dteAtEntry = Math.max(1, (expiration.getTime() - entryTime.getTime()) / 86_400_000);
        const dteNow = Math.max(0.5, (expiration.getTime() - now.getTime()) / 86_400_000);
        decayFactor = Math.pow(dteNow / dteAtEntry, 0.3);
        if (dteNow < 1) {
          decayFactor = STALE_GREEKS_SAFETY_MULTIPLIER;
        }
      }

      netDelta += deltaEntry * qty * decayFactor;
      netGamma += gammaEntry * qty * decayFactor;
      netVega += vegaEntry * qty * decayFactor;
      netTheta += thetaEntry * qty * (1 / Math.max(0.3, decayFactor));
    }

    return {
      netDelta: Math.round(netDelta * 100) / 100,
      netGamma: Math.round(netGamma * 100) / 100,
      netVega: Math.round(netVega * 100) / 100,
      netTheta: Math.round(netTheta * 100) / 100,
      positionCount: result.rows.length,
    };
  } catch (err) {
    logger.warn('Failed to fetch portfolio greeks — fail-closed', { error: err });
    throw err;
  }
}

export interface GammaExposureCheck {
  allowed: boolean;
  reasons: string[];
  greeks: PortfolioGreeks;
}

export async function checkGammaExposure(): Promise<GammaExposureCheck> {
  let greeks: PortfolioGreeks;
  try {
    greeks = await getPortfolioGreeks();
  } catch (err) {
    logger.warn('Gamma exposure check — DB unavailable, blocking', { error: err });
    return {
      allowed: false,
      reasons: ['db_unavailable_fail_closed'],
      greeks: { netDelta: 0, netGamma: 0, netVega: 0, netTheta: 0, positionCount: 0 },
    };
  }

  const reasons: string[] = [];
  let allowed = true;

  if (Math.abs(greeks.netDelta) > MAX_ABS_DELTA) {
    allowed = false;
    reasons.push(`net_delta_${Math.round(greeks.netDelta)}_exceeds_${MAX_ABS_DELTA}`);
  }

  if (Math.abs(greeks.netGamma) > MAX_ABS_GAMMA) {
    allowed = false;
    reasons.push(`net_gamma_${Math.round(greeks.netGamma)}_exceeds_${MAX_ABS_GAMMA}`);
  }

  if (Math.abs(greeks.netVega) > MAX_ABS_VEGA) {
    allowed = false;
    reasons.push(`net_vega_${Math.round(greeks.netVega)}_exceeds_${MAX_ABS_VEGA}`);
  }

  if (!allowed) {
    logger.warn('Gamma exposure check BLOCKED', { greeks, reasons });
  }

  return { allowed, reasons, greeks };
}
