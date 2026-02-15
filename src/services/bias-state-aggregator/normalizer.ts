/**
 * Normalizer - Maps MTF_BIAS_ENGINE_V3 webhook payload to internal unified shape.
 * Does NOT compute transitions or effective gating - aggregator does that.
 */

import type { MTFBiasWebhookPayloadV3 } from '../../lib/mtfBias/schemas-v3.js';
import type {
  UnifiedBiasState,
  BiasTransitions,
  EffectiveGating,
  UnifiedLevels,
  UnifiedLiquidity,
  UnifiedSpace,
  UnifiedTrigger,
  UnifiedRiskContext,
} from '../../lib/mtfBias/types-v3.js';

const EMPTY_TRANSITIONS: BiasTransitions = {
  biasFlip: false,
  regimeFlip: false,
  macroFlip: false,
  intentChange: false,
  liquidityEvent: false,
  expansionEvent: false,
  compressionEvent: false,
};

const DEFAULT_EFFECTIVE: EffectiveGating = {
  tradeSuppressed: false,
  effectiveBiasScore: 0,
  effectiveConfidence: 0,
  riskMultiplier: 1,
  notes: [],
};

/** Normalize V3 payload to unified state shape (transitions/effective are placeholders) */
export function normalizePayloadToState(
  payload: MTFBiasWebhookPayloadV3,
  eventId: string
): Omit<UnifiedBiasState, 'transitions' | 'effective'> & {
  transitions: BiasTransitions;
  effective: EffectiveGating;
} {
  const c = payload.mtf.consensus;
  const r = payload.mtf.regime;
  const macro = payload.macro.state;
  const levels = payload.levels;
  const swings = levels.swings ?? {};

  const unifiedLevels: UnifiedLevels = {
    vwap: {
      enabled: levels.vwap.enabled,
      value: levels.vwap.value,
      position: levels.vwap.position,
      distAtr: levels.vwap.dist_atr,
    },
    orb: {
      enabled: levels.orb.enabled,
      windowMin: levels.orb.window_min,
      high: levels.orb.high,
      low: levels.orb.low,
      mid: levels.orb.mid ?? null,
      state: levels.orb.state,
      ageMin: levels.orb.age_min,
    },
    swings: {
      h1LastPivotHigh: swings.h1_last_pivot_high ?? null,
      h1LastPivotLow: swings.h1_last_pivot_low ?? null,
      m15LastPivotHigh: swings.m15_last_pivot_high ?? null,
      m15LastPivotLow: swings.m15_last_pivot_low ?? null,
      distToResAtr: swings.dist_to_res_atr ?? null,
      distToSupAtr: swings.dist_to_sup_atr ?? null,
    },
  };

  const unifiedLiquidity: UnifiedLiquidity = {
    sweepHigh: payload.liquidity.sweep_high,
    sweepLow: payload.liquidity.sweep_low,
    reclaim: payload.liquidity.reclaim,
    equalHighCluster: payload.liquidity.equal_high_cluster,
    equalLowCluster: payload.liquidity.equal_low_cluster,
  };

  const unifiedSpace: UnifiedSpace = {
    roomToResistance: payload.space.room_to_resistance,
    roomToSupport: payload.space.room_to_support,
  };

  const unifiedTrigger: UnifiedTrigger = {
    barType: payload.trigger.bar_type,
    pattern: payload.trigger.pattern,
    triggered: payload.trigger.triggered,
  };

  const unifiedRiskContext: UnifiedRiskContext = {
    invalidation: {
      level: payload.risk_context.invalidation.level,
      method: payload.risk_context.invalidation.method,
    },
    entryModeHint: payload.risk_context.entry_mode_hint,
  };

  return {
    symbol: payload.symbol.toUpperCase(),
    updatedAtMs: payload.event_ts_ms,
    source: payload.source,
    chartTf: payload.chart_tf,
    session: payload.session,

    bias: c.bias_consensus,
    biasScore: c.bias_score,
    confidence: c.confidence_score,
    alignmentScore: c.alignment_score,
    conflictScore: c.conflict_score,

    regimeType: r.type,
    chopScore: r.chop_score,
    adx15m: r.adx_15m,
    atrState15m: r.atr_state_15m,

    macroClass: macro.macro_class,
    macroConfidence: macro.macro_confidence,
    macroSupport1: macro.macro_support_1,
    macroResistance1: macro.macro_resistance_1,
    macroMeasuredMoveTarget: macro.macro_measured_move_target,

    intentType: payload.intent.type,
    intentConfidence: payload.intent.confidence,
    regimeTransition: payload.intent.regime_transition,
    trendPhase: payload.intent.trend_phase,

    levels: unifiedLevels,
    trigger: unifiedTrigger,
    liquidity: unifiedLiquidity,
    space: unifiedSpace,
    riskContext: unifiedRiskContext,

    transitions: EMPTY_TRANSITIONS,
    effective: DEFAULT_EFFECTIVE,

    lastEventId: eventId,
    eventType: payload.event_type,
  };
}
