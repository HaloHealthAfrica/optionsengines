/**
 * Bias State Aggregator - Unit tests
 * Tests: V3 schema, normalizer, transition detector, gamma merge
 */

import { parseMTFBiasWebhookV3, isV3Payload } from '../lib/mtfBias/schemas-v3.js';
import { normalizePayloadToState } from '../services/bias-state-aggregator/normalizer.js';
import { detectTransitions } from '../services/bias-state-aggregator/transition-detector.js';
import { mergeGammaIntoState } from '../services/bias-state-aggregator/gamma-merge.service.js';
import type { UnifiedBiasState } from '../lib/mtfBias/types-v3.js';
import type { GammaContextNormalizedV1 } from '../lib/gammaContext/schemas.js';

const validV3Payload = {
  event_type: 'BIAS_SNAPSHOT' as const,
  event_ts_ms: 1739475600000,
  event_id_raw: 'MTF_BIAS_ENGINE_V3|SPY|5|1739475600000|BIAS_SNAPSHOT',
  symbol: 'SPY',
  exchange: 'AMEX',
  session: 'RTH' as const,
  source: 'MTF_BIAS_ENGINE_V3' as const,
  chart_tf: '5',
  bar: {
    time_ms: 1739475600000,
    open: 501.22,
    high: 502.1,
    low: 500.85,
    close: 501.95,
    volume: 34211000,
  },
  mtf: {
    timeframes: [
      {
        tf: '1D',
        bias: 'BULLISH' as const,
        strength: 82,
        structure: 'HH_HL' as const,
        momentum: 'IMPULSE_UP' as const,
        volatility: 'EXPANDING' as const,
        ema21: 500,
        ema55: 498,
        slope_ema55: 0.5,
        atr: 1.2,
      },
    ],
    consensus: {
      bias_consensus: 'BULLISH' as const,
      bias_score: 74,
      confidence_score: 0.78,
      alignment_score: 75,
      conflict_score: 0,
    },
    regime: {
      type: 'TREND' as const,
      chop_score: 18,
      adx_15m: 25,
      atr_state_15m: 'EXPANDING' as const,
    },
  },
  macro: {
    state: {
      macro_class: 'MACRO_TREND_UP' as const,
      macro_confidence: 0.8,
      macro_support_1: 498,
      macro_resistance_1: 505,
      macro_measured_move_target: 508,
    },
  },
  levels: {
    vwap: {
      enabled: true,
      value: 501.2,
      position: 'ABOVE' as const,
      dist_atr: 0.5,
    },
    orb: {
      enabled: true,
      window_min: 30,
      high: 502.3,
      low: 500.4,
      mid: 501.35,
      state: 'INSIDE' as const,
      age_min: 15,
    },
    swings: {
      h1_last_pivot_high: 503,
      h1_last_pivot_low: 499,
      m15_last_pivot_high: 502,
      m15_last_pivot_low: 500.5,
      dist_to_res_atr: 1.5,
      dist_to_sup_atr: 0.8,
    },
  },
  trigger: {
    bar_type: '2_UP' as const,
    pattern: '2-1-2_UP' as const,
    triggered: true,
  },
  liquidity: {
    sweep_high: false,
    sweep_low: false,
    reclaim: true,
    equal_high_cluster: false,
    equal_low_cluster: false,
  },
  space: {
    room_to_resistance: 'MEDIUM' as const,
    room_to_support: 'HIGH' as const,
  },
  intent: {
    type: 'PULLBACK' as const,
    confidence: 0.75,
    regime_transition: false,
    trend_phase: 'MID' as const,
  },
  risk_context: {
    invalidation: { level: 500.4, method: 'M15_PIVOT_LOW' as const },
    entry_mode_hint: 'PULLBACK' as const,
  },
};

const gammaPayload: GammaContextNormalizedV1 = {
  symbol: 'SPY',
  as_of_ts_ms: 1739475700000,
  net_gex: 1e9,
  total_gex: 5e9,
  gamma_environment: 'POSITIVE',
  gamma_magnitude: 'HIGH',
  gamma_flip_level: 505,
  distance_to_flip: 3.5,
  call_wall: 510,
  put_wall: 495,
  wall_method: 'PROVIDER',
  zero_dte_gamma_ratio: 0.3,
  vol_regime_bias: 'EXPANSION_LIKELY',
};

describe('Bias State Aggregator - V3 Schema', () => {
  it('accepts valid V3 payload', () => {
    const result = parseMTFBiasWebhookV3(validV3Payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.symbol).toBe('SPY');
      expect(result.data.mtf.consensus.bias_consensus).toBe('BULLISH');
      expect(result.data.macro.state.macro_class).toBe('MACRO_TREND_UP');
      expect(result.data.intent.type).toBe('PULLBACK');
      expect(result.data.liquidity.reclaim).toBe(true);
    }
  });

  it('rejects payload without macro', () => {
    const invalid = { ...validV3Payload, macro: undefined };
    const result = parseMTFBiasWebhookV3(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects wrong source', () => {
    const invalid = { ...validV3Payload, source: 'MTF_BIAS_ENGINE_V1' };
    const result = parseMTFBiasWebhookV3(invalid);
    expect(result.success).toBe(false);
  });

  it('isV3Payload returns true for V3 structure', () => {
    expect(isV3Payload(validV3Payload)).toBe(true);
    expect(isV3Payload({ source: 'MTF_BIAS_ENGINE_V3' })).toBe(true);
    expect(isV3Payload({ macro: {}, intent: {}, liquidity: {}, space: {}, trigger: {} })).toBe(true);
    expect(isV3Payload({})).toBe(false);
  });
});

describe('Bias State Aggregator - Normalizer', () => {
  it('normalizes payload to unified state shape', () => {
    const result = parseMTFBiasWebhookV3(validV3Payload);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const normalized = normalizePayloadToState(result.data, 'evt-123');
    expect(normalized.symbol).toBe('SPY');
    expect(normalized.bias).toBe('BULLISH');
    expect(normalized.biasScore).toBe(74);
    expect(normalized.confidence).toBe(0.78);
    expect(normalized.macroClass).toBe('MACRO_TREND_UP');
    expect(normalized.intentType).toBe('PULLBACK');
    expect(normalized.liquidity.reclaim).toBe(true);
    expect(normalized.space.roomToResistance).toBe('MEDIUM');
    expect(normalized.levels.vwap.value).toBe(501.2);
    expect(normalized.levels.orb.state).toBe('INSIDE');
  });
});

describe('Bias State Aggregator - Transition Detector', () => {
  it('detects bias flip when consensus changes bullish to bearish', () => {
    const prev: UnifiedBiasState = {
      ...({} as UnifiedBiasState),
      bias: 'BULLISH',
      regimeType: 'TREND',
      macroClass: 'MACRO_TREND_UP',
      intentType: 'PULLBACK',
      liquidity: { sweepHigh: false, sweepLow: false, reclaim: false, equalHighCluster: false, equalLowCluster: false },
      chopScore: 20,
      regimeTransition: false,
      atrState15m: 'NORMAL',
    };
    const curr: UnifiedBiasState = {
      ...prev,
      bias: 'BEARISH',
    };
    const t = detectTransitions({ prev, curr });
    expect(t.biasFlip).toBe(true);
    expect(t.regimeFlip).toBe(false);
  });

  it('detects regime flip', () => {
    const prev: UnifiedBiasState = {
      ...({} as UnifiedBiasState),
      bias: 'BULLISH',
      regimeType: 'TREND',
      macroClass: 'MACRO_TREND_UP',
      intentType: 'PULLBACK',
      liquidity: { sweepHigh: false, sweepLow: false, reclaim: false, equalHighCluster: false, equalLowCluster: false },
      chopScore: 20,
      regimeTransition: false,
      atrState15m: 'NORMAL',
    };
    const curr: UnifiedBiasState = {
      ...prev,
      regimeType: 'RANGE',
    };
    const t = detectTransitions({ prev, curr });
    expect(t.regimeFlip).toBe(true);
  });

  it('detects liquidity event when reclaim toggles true', () => {
    const prev: UnifiedBiasState = {
      ...({} as UnifiedBiasState),
      bias: 'BULLISH',
      regimeType: 'TREND',
      macroClass: 'MACRO_TREND_UP',
      intentType: 'PULLBACK',
      liquidity: { sweepHigh: false, sweepLow: false, reclaim: false, equalHighCluster: false, equalLowCluster: false },
      chopScore: 20,
      regimeTransition: false,
      atrState15m: 'NORMAL',
    };
    const curr: UnifiedBiasState = {
      ...prev,
      liquidity: { ...prev.liquidity, reclaim: true },
    };
    const t = detectTransitions({ prev, curr });
    expect(t.liquidityEvent).toBe(true);
  });

  it('returns empty transitions when no prev state', () => {
    const parsed = parseMTFBiasWebhookV3(validV3Payload);
    expect(parsed.success).toBe(true);
    const curr = normalizePayloadToState(
      (parsed as { success: true; data: typeof validV3Payload }).data,
      'evt-1'
    ) as UnifiedBiasState;
    const t = detectTransitions({ prev: null, curr });
    expect(t.biasFlip).toBe(false);
    expect(t.regimeFlip).toBe(false);
    expect(t.macroFlip).toBe(false);
    expect(t.intentChange).toBe(false);
    expect(t.liquidityEvent).toBe(true);
  });
});

describe('Bias State Aggregator - Gamma Merge', () => {
  it('merges gamma into state', () => {
    const result = parseMTFBiasWebhookV3(validV3Payload);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const normalized = normalizePayloadToState(
      result.data as Parameters<typeof normalizePayloadToState>[0],
      'evt-123'
    ) as UnifiedBiasState;
    const merged = mergeGammaIntoState(normalized, gammaPayload);

    expect(merged.gamma).toBeDefined();
    expect(merged.gamma?.gammaEnvironment).toBe('POSITIVE');
    expect(merged.gamma?.gammaMagnitude).toBe('HIGH');
    expect(merged.gamma?.gammaFlipLevel).toBe(505);
    expect(merged.gamma?.distanceToFlip).toBe(3.5);
    expect(merged.gamma?.callWall).toBe(510);
    expect(merged.gamma?.putWall).toBe(495);
    expect(merged.gamma?.volRegimeBias).toBe('EXPANSION_LIKELY');
    expect(merged.gamma?.gammaUpdatedAtMs).toBe(1739475700000);
  });
});
