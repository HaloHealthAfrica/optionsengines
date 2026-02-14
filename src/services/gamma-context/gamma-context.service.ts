/**
 * Gamma Context Service - Phase 3
 * Fetches gamma from Unusual Whales, normalizes, classifies, publishes to gamma_context_stream.
 */

import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { unusualWhalesGammaProvider, type GammaContext } from '../providers/unusualwhales-gamma.js';
import { mtfBiasStreamService } from '../mtf-bias-stream.service.js';
import { db } from '../database.service.js';
import type { GammaContextNormalizedV1 } from '../../lib/gammaContext/schemas.js';
import {
  GAMMA_ENVIRONMENT,
  GAMMA_MAGNITUDE,
  WALL_METHOD,
  VOL_REGIME_BIAS,
} from '../../lib/gammaContext/schemas.js';

const GAMMA_MAGNITUDE_ROLLING_WINDOW = 20;
const GAMMA_MAGNITUDE_LOW_RATIO = 0.5;
const GAMMA_MAGNITUDE_HIGH_RATIO = 1.5;

export async function fetchAndPublishGamma(symbol: string): Promise<boolean> {
  if (!config.unusualWhalesApiKey || !config.unusualWhalesGammaUrl) {
    logger.debug('Gamma Metrics: UW not configured', { symbol });
    return false;
  }

  try {
    const raw = await unusualWhalesGammaProvider.getGammaContext(symbol);
    if (!raw) return false;

    const normalized = await normalizeAndClassify(symbol, raw);
    if (!normalized) return false;

    const payload = { gamma: normalized, symbol: normalized.symbol };
    const msgId = await mtfBiasStreamService.publishGammaContext(payload);
    if (msgId) {
      logger.info('Gamma Metrics: published', {
        symbol,
        gamma_environment: normalized.gamma_environment,
        gamma_magnitude: normalized.gamma_magnitude,
      });
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Gamma Metrics: fetch failed', { symbol, error });
    return false;
  }
}

export async function pollAllSymbols(): Promise<number> {
  const symbols = config.gammaMetricsSymbols.length > 0
    ? config.gammaMetricsSymbols
    : ['SPY', 'QQQ', 'IWM'];

  let published = 0;
  for (const symbol of symbols) {
    const ok = await fetchAndPublishGamma(symbol);
    if (ok) published++;
    await sleep(500);
  }
  return published;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function normalizeAndClassify(
  symbol: string,
  raw: GammaContext
): Promise<GammaContextNormalizedV1 | null> {
  const asOfTsMs = Date.now();
  const netGex = raw.net_gamma;
  const gammaFlipLevel = raw.gamma_flip ?? null;

  const callGamma = raw.call_gamma ?? 0;
  const putGamma = raw.put_gamma ?? 0;
  const totalGex = Math.max(0, Math.abs(callGamma) + Math.abs(putGamma)) || Math.abs(netGex);

  const { callWall, putWall, wallMethod } = resolveWalls(raw);

  const zeroDteGamma = raw.zero_dte_gamma ?? null;
  const totalGammaForRatio =
    (raw.call_gamma != null && raw.put_gamma != null
      ? Math.abs(raw.call_gamma) + Math.abs(raw.put_gamma)
      : null) ?? totalGex;
  const zeroDteGammaRatio =
    zeroDteGamma != null && totalGammaForRatio > 0
      ? Math.min(1, Math.max(0, Math.abs(zeroDteGamma) / totalGammaForRatio))
      : null;

  const gammaEnvironment = classifyEnvironment(netGex);
  const gammaMagnitude = await classifyMagnitude(symbol, netGex);
  const volRegimeBias = classifyVolRegimeBias(gammaEnvironment, gammaMagnitude);

  const underlyingPrice = extractUnderlyingPrice(raw);
  const distanceToFlip =
    gammaFlipLevel != null && underlyingPrice != null
      ? gammaFlipLevel - underlyingPrice
      : null;

  return {
    symbol: symbol.toUpperCase(),
    as_of_ts_ms: asOfTsMs,
    net_gex: netGex,
    total_gex: totalGex,
    gamma_environment: gammaEnvironment,
    gamma_magnitude: gammaMagnitude,
    gamma_flip_level: gammaFlipLevel,
    distance_to_flip: distanceToFlip,
    call_wall: callWall,
    put_wall: putWall,
    wall_method: wallMethod,
    zero_dte_gamma_ratio: zeroDteGammaRatio,
    vol_regime_bias: volRegimeBias,
    raw_provider_payload: raw as unknown as Record<string, unknown>,
  };
}

function classifyEnvironment(netGex: number): (typeof GAMMA_ENVIRONMENT)[number] {
  const threshold = config.dealerUwNeutralThreshold;
  if (netGex > threshold) return 'POSITIVE';
  if (netGex < -threshold) return 'NEGATIVE';
  return 'NEUTRAL';
}

async function classifyMagnitude(
  symbol: string,
  netGex: number
): Promise<(typeof GAMMA_MAGNITUDE)[number]> {
  const absNetGex = Math.abs(netGex);

  const result = await db.query(
    `SELECT AVG(ABS(net_gex)) as avg_abs
     FROM (
       SELECT net_gex FROM gamma_context
       WHERE symbol = $1
       ORDER BY as_of_ts_ms DESC
       LIMIT $2
     ) sub`,
    [symbol.toUpperCase(), GAMMA_MAGNITUDE_ROLLING_WINDOW]
  );

  const avgAbs = result.rows[0]?.avg_abs != null ? Number(result.rows[0].avg_abs) : null;

  if (avgAbs == null || avgAbs === 0) {
    return 'MEDIUM';
  }

  const ratio = absNetGex / avgAbs;
  if (ratio < GAMMA_MAGNITUDE_LOW_RATIO) return 'LOW';
  if (ratio > GAMMA_MAGNITUDE_HIGH_RATIO) return 'HIGH';
  return 'MEDIUM';
}

function classifyVolRegimeBias(
  env: (typeof GAMMA_ENVIRONMENT)[number],
  mag: (typeof GAMMA_MAGNITUDE)[number]
): (typeof VOL_REGIME_BIAS)[number] {
  if (env === 'NEGATIVE' && mag === 'HIGH') return 'EXPANSION_LIKELY';
  if (env === 'POSITIVE' && mag === 'HIGH') return 'COMPRESSION_LIKELY';
  return 'NEUTRAL';
}

function resolveWalls(raw: GammaContext): {
  callWall: number | null;
  putWall: number | null;
  wallMethod: (typeof WALL_METHOD)[number] | null;
} {
  const data = raw as unknown as Record<string, unknown>;
  const providerCallWall = toNum(data?.call_wall ?? data?.callWall);
  const providerPutWall = toNum(data?.put_wall ?? data?.putWall);

  if (providerCallWall != null && providerPutWall != null) {
    return {
      callWall: providerCallWall,
      putWall: providerPutWall,
      wallMethod: 'PROVIDER',
    };
  }

  const strikes = raw.gamma_by_strike ?? [];
  if (strikes.length === 0) {
    return { callWall: null, putWall: null, wallMethod: null };
  }

  const callStrikes = strikes.filter((s) => s.netGamma > 0);
  const putStrikes = strikes.filter((s) => s.netGamma < 0);

  const callWall =
    callStrikes.length > 0
      ? callStrikes.reduce((best, s) => (s.netGamma > best.netGamma ? s : best)).strike
      : null;
  const putWall =
    putStrikes.length > 0
      ? putStrikes.reduce((best, s) => (s.netGamma < best.netGamma ? s : best)).strike
      : null;

  return {
    callWall,
    putWall,
    wallMethod: callWall != null || putWall != null ? 'DERIVED_GAMMA' : null,
  };
}

function extractUnderlyingPrice(raw: GammaContext): number | null {
  const data = raw as unknown as Record<string, unknown>;
  return (
    toNum(data?.underlying_price ?? data?.underlyingPrice ?? data?.price ?? data?.spot) ?? null
  );
}

function toNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
