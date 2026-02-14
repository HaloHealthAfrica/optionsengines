/**
 * Gamma Context Zod Schemas - Phase 1
 * Normalized output from Gamma Metrics Service.
 * Clamp numeric fields to safe ranges at normalization time.
 */

import { z } from 'zod';

export const GAMMA_ENVIRONMENT = ['POSITIVE', 'NEGATIVE', 'NEUTRAL'] as const;
export const GAMMA_MAGNITUDE = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const WALL_METHOD = ['PROVIDER', 'DERIVED_GAMMA', 'DERIVED_OI'] as const;
export const VOL_REGIME_BIAS = ['EXPANSION_LIKELY', 'COMPRESSION_LIKELY', 'NEUTRAL'] as const;

const gammaEnvironmentSchema = z.enum(GAMMA_ENVIRONMENT);
const gammaMagnitudeSchema = z.enum(GAMMA_MAGNITUDE);
const wallMethodSchema = z.enum(WALL_METHOD);
const volRegimeBiasSchema = z.enum(VOL_REGIME_BIAS);

/** Safe numeric clamp helpers - reject out-of-range, do not silently accept */
const clampNetGex = z.number().finite();
const clampTotalGex = z.number().min(0).finite();
const clampGammaFlipLevel = z.number().finite().nullable();
const clampDistanceToFlip = z.number().finite().nullable();
const clampCallWall = z.number().finite().nullable();
const clampPutWall = z.number().finite().nullable();
const clampZeroDteRatio = z.number().min(0).max(1).nullable();

export const GammaContextNormalizedSchemaV1 = z.object({
  symbol: z.string().min(1).transform((s) => s.toUpperCase()),
  as_of_ts_ms: z.number().int().positive(),
  net_gex: clampNetGex,
  total_gex: clampTotalGex,
  gamma_environment: gammaEnvironmentSchema,
  gamma_magnitude: gammaMagnitudeSchema,
  gamma_flip_level: clampGammaFlipLevel,
  distance_to_flip: clampDistanceToFlip,
  call_wall: clampCallWall,
  put_wall: clampPutWall,
  wall_method: wallMethodSchema.nullable(),
  zero_dte_gamma_ratio: clampZeroDteRatio,
  vol_regime_bias: volRegimeBiasSchema,
  raw_provider_payload: z.record(z.unknown()).optional(),
});

export type GammaContextNormalizedV1 = z.infer<typeof GammaContextNormalizedSchemaV1>;

export function parseGammaContextNormalized(
  payload: unknown
): { success: true; data: GammaContextNormalizedV1 } | { success: false; error: z.ZodError } {
  const parsed = GammaContextNormalizedSchemaV1.safeParse(payload);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }
  return { success: false, error: parsed.error };
}
