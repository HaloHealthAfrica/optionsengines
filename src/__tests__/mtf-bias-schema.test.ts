/**
 * MTF Bias Webhook Schema v1 - Validation tests
 */

import { parseMTFBiasWebhook } from '../lib/mtfBias/schemas.js';

const validPayload = {
  event_type: 'BIAS_SNAPSHOT',
  event_ts_ms: 1739475600000,
  event_id_raw: 'MTF_BIAS_ENGINE_V1|SPY|5|1739475600000|BIAS_SNAPSHOT',
  symbol: 'SPY',
  exchange: 'AMEX',
  session: 'RTH',
  source: 'MTF_BIAS_ENGINE_V1',
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
      { tf: '1D', bias: 'BULLISH', strength: 82 },
      { tf: '1H', bias: 'BULLISH', strength: 76 },
      { tf: '15m', bias: 'BULLISH', strength: 71 },
      { tf: '5', bias: 'BULLISH', strength: 65 },
    ],
    consensus: {
      bias_consensus: 'BULLISH',
      bias_score: 74,
      confidence_score: 0.78,
      alignment_score: 75,
      conflict_score: 0,
    },
    regime: { type: 'TREND', chop_score: 18 },
  },
  levels: {
    vwap: { value: 501.2, position: 'ABOVE' },
    orb: { high: 502.3, low: 500.4, state: 'INSIDE' },
  },
  risk_context: {
    invalidation: { level: 500.4 },
    entry_mode_hint: 'PULLBACK',
  },
};

describe('MTF Bias Webhook Schema v1', () => {
  it('accepts valid payload', () => {
    const result = parseMTFBiasWebhook(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.symbol).toBe('SPY');
      expect(result.data.mtf.consensus.bias_consensus).toBe('BULLISH');
      expect(result.data.mtf.consensus.confidence_score).toBe(0.78);
      expect(result.data.risk_context.entry_mode_hint).toBe('PULLBACK');
    }
  });

  it('rejects missing mtf block', () => {
    const invalid = { ...validPayload, mtf: undefined };
    const result = parseMTFBiasWebhook(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects missing levels block', () => {
    const invalid = { ...validPayload, levels: undefined };
    const result = parseMTFBiasWebhook(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects missing risk_context block', () => {
    const invalid = { ...validPayload, risk_context: undefined };
    const result = parseMTFBiasWebhook(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects invalid bias value', () => {
    const invalid = {
      ...validPayload,
      mtf: {
        ...validPayload.mtf,
        consensus: { ...validPayload.mtf.consensus, bias_consensus: 'INVALID' },
      },
    };
    const result = parseMTFBiasWebhook(invalid);
    expect(result.success).toBe(false);
  });
});
