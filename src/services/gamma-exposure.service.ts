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

export async function getPortfolioGreeks(): Promise<PortfolioGreeks> {
  try {
    const result = await db.query(
      `SELECT
         COALESCE(SUM(delta_at_entry * quantity), 0) AS net_delta,
         COALESCE(SUM(gamma_at_entry * quantity), 0) AS net_gamma,
         COALESCE(SUM(vega_at_entry * quantity), 0) AS net_vega,
         COALESCE(SUM(theta_at_entry * quantity), 0) AS net_theta,
         COUNT(*) AS position_count
       FROM refactored_positions
       WHERE status IN ('open', 'closing')
         AND COALESCE(is_test, false) = false`
    );

    const row = result.rows[0];
    return {
      netDelta: Number(row?.net_delta ?? 0),
      netGamma: Number(row?.net_gamma ?? 0),
      netVega: Number(row?.net_vega ?? 0),
      netTheta: Number(row?.net_theta ?? 0),
      positionCount: Number(row?.position_count ?? 0),
    };
  } catch (err) {
    logger.warn('Failed to fetch portfolio greeks', { error: err });
    return { netDelta: 0, netGamma: 0, netVega: 0, netTheta: 0, positionCount: 0 };
  }
}

export interface GammaExposureCheck {
  allowed: boolean;
  reasons: string[];
  greeks: PortfolioGreeks;
}

export async function checkGammaExposure(): Promise<GammaExposureCheck> {
  const greeks = await getPortfolioGreeks();
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
