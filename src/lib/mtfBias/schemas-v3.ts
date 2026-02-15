/**
 * MTF Bias Webhook Zod Schema v3 - MTF_BIAS_ENGINE_V3.
 * Full spec: bar, mtf (structure/momentum/volatility), macro, trigger, liquidity, space, intent.
 */

import { z } from 'zod';
import {
  BIAS_VALUES_V3,
  REGIME_TYPES_V3,
  STRUCTURE_VALUES,
  MOMENTUM_VALUES,
  VOLATILITY_VALUES,
  ATR_STATE_VALUES,
  MACRO_CLASS_VALUES,
  VWAP_POSITIONS_V3,
  ORB_STATES_V3,
  SPACE_BUCKET_VALUES,
  INTENT_TYPES,
  TREND_PHASE_VALUES,
  BAR_TYPE_VALUES,
  PATTERN_VALUES,
  ENTRY_MODE_HINTS_V3,
  INVALIDATION_METHOD_VALUES,
  EVENT_TYPES_V3,
  SESSION_VALUES,
} from './constants-v3.js';

const biasSchema = z.enum(BIAS_VALUES_V3);
const regimeTypeSchema = z.enum(REGIME_TYPES_V3);
const structureSchema = z.enum(STRUCTURE_VALUES);
const momentumSchema = z.enum(MOMENTUM_VALUES);
const volatilitySchema = z.enum(VOLATILITY_VALUES);
const atrStateSchema = z.enum(ATR_STATE_VALUES);
const macroClassSchema = z.enum(MACRO_CLASS_VALUES);
const vwapPositionSchema = z.enum(VWAP_POSITIONS_V3);
const orbStateSchema = z.enum(ORB_STATES_V3);
const spaceBucketSchema = z.enum(SPACE_BUCKET_VALUES);
const intentTypeSchema = z.enum(INTENT_TYPES);
const trendPhaseSchema = z.enum(TREND_PHASE_VALUES);
const barTypeSchema = z.enum(BAR_TYPE_VALUES);
const patternSchema = z.enum(PATTERN_VALUES);
const entryModeHintSchema = z.enum(ENTRY_MODE_HINTS_V3);
const invalidationMethodSchema = z.enum(INVALIDATION_METHOD_VALUES);
const eventTypeSchema = z.enum(EVENT_TYPES_V3);
const sessionSchema = z.enum(SESSION_VALUES);

const barSchema = z.object({
  time_ms: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});

const mtfTimeframeSchema = z.object({
  tf: z.string().min(1),
  bias: biasSchema,
  strength: z.number().min(0).max(100),
  structure: structureSchema,
  momentum: momentumSchema,
  volatility: volatilitySchema,
  ema21: z.number(),
  ema55: z.number(),
  slope_ema55: z.number(),
  atr: z.number(),
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
  adx_15m: z.number().optional(),
  atr_state_15m: atrStateSchema.optional(),
});

const mtfBlockSchema = z.object({
  timeframes: z.array(mtfTimeframeSchema).min(1),
  consensus: mtfConsensusSchema,
  regime: mtfRegimeSchema,
});

const macroTimeframeSchema = z.object({
  tf: z.string().min(1),
  bias: biasSchema,
  strength: z.number().min(0).max(100),
  structure: structureSchema,
  momentum: momentumSchema,
  volatility: volatilitySchema,
});

const macroStateSchema = z.object({
  macro_class: macroClassSchema,
  macro_confidence: z.number().min(0).max(1),
  macro_support_1: z.number().nullable(),
  macro_resistance_1: z.number().nullable(),
  macro_measured_move_target: z.number().nullable(),
});

const macroBlockSchema = z.object({
  timeframes: z.array(macroTimeframeSchema).optional(),
  state: macroStateSchema,
});

const vwapLevelSchema = z.object({
  enabled: z.boolean(),
  value: z.number().nullable(),
  position: vwapPositionSchema,
  dist_atr: z.number().nullable(),
});

const orbLevelSchema = z.object({
  enabled: z.boolean(),
  window_min: z.number(),
  high: z.number().nullable(),
  low: z.number().nullable(),
  mid: z.number().nullable(),
  state: orbStateSchema,
  age_min: z.number().nullable(),
});

const swingsSchema = z.object({
  h1_last_pivot_high: z.number().nullable().optional(),
  h1_last_pivot_low: z.number().nullable().optional(),
  m15_last_pivot_high: z.number().nullable().optional(),
  m15_last_pivot_low: z.number().nullable().optional(),
  dist_to_res_atr: z.number().nullable().optional(),
  dist_to_sup_atr: z.number().nullable().optional(),
});

const levelsBlockSchema = z.object({
  vwap: vwapLevelSchema,
  orb: orbLevelSchema,
  swings: swingsSchema.optional(),
});

const triggerBlockSchema = z.object({
  bar_type: barTypeSchema,
  pattern: patternSchema,
  triggered: z.boolean(),
});

const liquidityBlockSchema = z.object({
  sweep_high: z.boolean(),
  sweep_low: z.boolean(),
  reclaim: z.boolean(),
  equal_high_cluster: z.boolean(),
  equal_low_cluster: z.boolean(),
});

const spaceBlockSchema = z.object({
  room_to_resistance: spaceBucketSchema,
  room_to_support: spaceBucketSchema,
});

const intentBlockSchema = z.object({
  type: intentTypeSchema,
  confidence: z.number().min(0).max(1),
  regime_transition: z.boolean(),
  trend_phase: trendPhaseSchema,
});

const invalidationSchema = z.object({
  level: z.number().nullable(),
  method: invalidationMethodSchema,
});

const riskContextBlockSchema = z.object({
  invalidation: invalidationSchema,
  entry_mode_hint: entryModeHintSchema,
});

/** MTF_BIAS_ENGINE_V3 webhook payload schema */
export const MTFBiasWebhookSchemaV3 = z.object({
  event_type: eventTypeSchema,
  event_ts_ms: z.number().int().positive(),
  event_id_raw: z.string().min(1),
  symbol: z.string().min(1),
  exchange: z.string().optional().default(''),
  session: sessionSchema,
  source: z.literal('MTF_BIAS_ENGINE_V3'),
  chart_tf: z.string().min(1),
  bar: barSchema,
  mtf: mtfBlockSchema,
  macro: macroBlockSchema,
  levels: levelsBlockSchema,
  trigger: triggerBlockSchema,
  liquidity: liquidityBlockSchema,
  space: spaceBlockSchema,
  intent: intentBlockSchema,
  risk_context: riskContextBlockSchema,
});

export type MTFBiasWebhookPayloadV3 = z.infer<typeof MTFBiasWebhookSchemaV3>;

/** Parse V3 webhook - strict validation */
export function parseMTFBiasWebhookV3(
  payload: unknown
): { success: true; data: MTFBiasWebhookPayloadV3 } | { success: false; error: z.ZodError } {
  const parsed = MTFBiasWebhookSchemaV3.safeParse(payload);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }
  return { success: false, error: parsed.error };
}

/** Check if payload looks like V3 (source or structure) */
export function isV3Payload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  if (p.source === 'MTF_BIAS_ENGINE_V3') return true;
  return !!(p.macro && p.intent && p.liquidity && p.space && p.trigger);
}
