/**
 * MTF Bias Webhook Zod Schema v1 - LOCKED.
 * No drift without versioning. Breaking changes require schema_version bump.
 */

import { z } from 'zod';
import {
  MTF_BIAS_SCHEMA_VERSION,
  BIAS_VALUES,
  REGIME_TYPES,
  ENTRY_MODE_HINTS,
  VWAP_POSITIONS,
  ORB_STATES,
} from './constants.js';

const biasSchema = z.enum(BIAS_VALUES);
const regimeTypeSchema = z.enum(REGIME_TYPES);
const entryModeHintSchema = z.enum(ENTRY_MODE_HINTS);
const vwapPositionSchema = z.enum(VWAP_POSITIONS);
const orbStateSchema = z.enum(ORB_STATES);

const mtfTimeframeSchema = z.object({
  tf: z.string().min(1),
  bias: biasSchema,
  strength: z.number().min(0).max(100),
});

const mtfConsensusSchema = z.object({
  bias_consensus: biasSchema,
  bias_score: z.number().min(-100).max(100),
  confidence_score: z.number().min(0).max(1),
  alignment_score: z.number().min(0).max(100),
  conflict_score: z.number().min(0).max(100),
});

const mtfRegimeSchema = z.object({
  type: regimeTypeSchema,
  chop_score: z.number().min(0).max(100),
});

const mtfBlockSchema = z.object({
  timeframes: z.array(mtfTimeframeSchema).min(1),
  consensus: mtfConsensusSchema,
  regime: mtfRegimeSchema,
});

const vwapLevelSchema = z.object({
  value: z.number(),
  position: vwapPositionSchema,
});

const orbLevelSchema = z.object({
  high: z.number(),
  low: z.number(),
  state: orbStateSchema,
});

const levelsBlockSchema = z.object({
  vwap: vwapLevelSchema,
  orb: orbLevelSchema,
});

const invalidationSchema = z.object({
  level: z.number(),
});

const riskContextBlockSchema = z.object({
  invalidation: invalidationSchema,
  entry_mode_hint: entryModeHintSchema,
});

/** Schema v1 - Required fields only. bar, exchange, session, source are optional. */
export const MTFBiasWebhookSchemaV1 = z
  .object({
    schema_version: z.string().optional(),
    event_type: z.string().min(1),
  event_ts_ms: z.number().int().positive(),
  event_id_raw: z.string().min(1),
  symbol: z.string().min(1),
  exchange: z.string().optional(),
  session: z.string().optional(),
  source: z.string().optional(),
  chart_tf: z.string().min(1),
  bar: z
    .object({
      time_ms: z.number(),
      open: z.number(),
      high: z.number(),
      low: z.number(),
      close: z.number(),
      volume: z.number(),
    })
    .optional(),
  mtf: mtfBlockSchema,
  levels: levelsBlockSchema,
  risk_context: riskContextBlockSchema,
})
  .refine(
    (data) => {
      const v = data.schema_version;
      if (!v) return true;
      return v === '1' || v === MTF_BIAS_SCHEMA_VERSION;
    },
    { message: 'Unknown schema_version - only v1 supported' }
  );

export type MTFBiasWebhookPayloadV1 = z.infer<typeof MTFBiasWebhookSchemaV1>;

/** Alias for Phase 1 MarketStateWriter - Pine MTF Bias payload */
export const MTFBiasPayloadV1 = MTFBiasWebhookSchemaV1;
export type MTFBiasPayloadV1Type = MTFBiasWebhookPayloadV1;

/** Validate schema_version if present. Reject unknown versions. */
export const SCHEMA_VERSIONS = [MTF_BIAS_SCHEMA_VERSION, '1'] as const;

export function parseMTFBiasWebhook(
  payload: unknown
): { success: true; data: MTFBiasWebhookPayloadV1 } | { success: false; error: z.ZodError } {
  const parsed = MTFBiasWebhookSchemaV1.safeParse(payload);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }
  return { success: false, error: parsed.error };
}
