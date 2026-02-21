import { BaseAgent } from '../base-agent.js';
import { AgentOutput, EnrichedSignal, MarketData, RegimeContext } from '../../types/index.js';
import { computeADX, computeBBWidthPercentile, computeVolumeRatio, last } from '../utils/technical-indicators.js';

type RegimeType = 'trend' | 'range' | 'compression' | 'expansion' | 'transitional';
type VolatilityState = 'low' | 'normal' | 'high';

function classifyVolatility(atrPercentile: number): VolatilityState {
  if (atrPercentile < 25) return 'low';
  if (atrPercentile > 75) return 'high';
  return 'normal';
}

function computeATRPercentile(atrValues: number[]): number {
  if (atrValues.length < 10) return 50;
  const current = atrValues[atrValues.length - 1];
  const sorted = [...atrValues].sort((a, b) => a - b);
  const rank = sorted.filter((v) => v <= current).length;
  return (rank / sorted.length) * 100;
}

export class RegimeClassifierAgent extends BaseAgent {
  constructor() {
    super('regime_classifier', 'core');
  }

  async analyze(signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput> {
    const { candles, indicators, currentPrice } = marketData;
    const reasons: string[] = [];

    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const volumes = candles.map((c) => c.volume);

    const adxValues = computeADX(highs, lows, closes, 14);
    const adx = adxValues.length > 0 ? adxValues[adxValues.length - 1] : 20;

    const atrPercentile = computeATRPercentile(indicators.atr);
    const volatilityState = classifyVolatility(atrPercentile);

    const bbWidthPct = computeBBWidthPercentile(
      indicators.bollingerBands.upper,
      indicators.bollingerBands.lower,
      indicators.bollingerBands.middle
    );

    const volumeRatio = computeVolumeRatio(volumes);

    let regime: RegimeType;
    let regimeConfidence = 50;

    if (adx > 30 && atrPercentile > 50) {
      regime = 'trend';
      regimeConfidence = 60 + Math.min(30, (adx - 30) * 1.5);
      reasons.push(`strong_trend_adx_${Math.round(adx)}`);
    } else if (bbWidthPct < 15 && adx < 20) {
      regime = 'compression';
      regimeConfidence = 65 + Math.min(25, (20 - bbWidthPct) * 1.5);
      reasons.push('bollinger_compression');
    } else if (bbWidthPct > 85 && atrPercentile > 70) {
      regime = 'expansion';
      regimeConfidence = 60 + Math.min(25, (bbWidthPct - 85));
      reasons.push('volatility_expansion');
    } else if (adx < 20 && atrPercentile < 50) {
      regime = 'range';
      regimeConfidence = 55 + Math.min(25, (20 - adx) * 2);
      reasons.push('range_bound');
    } else {
      regime = 'transitional';
      regimeConfidence = 40;
      reasons.push('transitional_regime');
    }

    if (volumeRatio > 2) {
      reasons.push('volume_surge');
      if (regime === 'compression') {
        regime = 'expansion';
        reasons.push('compression_breaking_on_volume');
      }
    } else if (volumeRatio < 0.5) {
      reasons.push('volume_dry_up');
    }

    reasons.push(`vol_state_${volatilityState}`);
    reasons.push(`bb_width_pct_${Math.round(bbWidthPct)}`);

    const regimeContext: RegimeContext = {
      regime,
      volatilityState,
      trendStrength: Math.round(adx),
      confidence: Math.round(regimeConfidence),
    };

    let bias: AgentOutput['bias'] = 'neutral';
    let confidence = Math.round(regimeConfidence);

    if (regime === 'trend' && adx > 25) {
      const ema8 = last(indicators.ema8);
      const ema21 = last(indicators.ema21);
      if (ema8 > ema21 && currentPrice > ema21) {
        bias = signal.direction === 'long' ? 'bullish' : 'bearish';
        if (signal.direction === 'long') {
          confidence = Math.min(85, confidence + 10);
          reasons.push('trend_supports_long');
        } else {
          confidence = Math.max(30, confidence - 10);
          reasons.push('trend_opposes_short_in_uptrend');
        }
      } else if (ema8 < ema21 && currentPrice < ema21) {
        bias = signal.direction === 'long' ? 'bullish' : 'bearish';
        if (signal.direction === 'short') {
          confidence = Math.min(85, confidence + 10);
          reasons.push('trend_supports_short');
        } else {
          confidence = Math.max(30, confidence - 10);
          reasons.push('trend_opposes_long_in_downtrend');
        }
      }
    }

    if (regime === 'range') {
      if (signal.setupType === 'breakout') {
        confidence = Math.max(25, confidence - 15);
        reasons.push('breakout_penalized_in_range');
      } else if (signal.setupType === 'mean_revert') {
        confidence = Math.min(80, confidence + 10);
        reasons.push('mean_revert_favored_in_range');
      }
    }

    confidence = Math.max(15, Math.min(90, confidence));

    return this.buildOutput(bias, confidence, reasons, false, {
      agentType: 'core',
      regimeContext,
      adx: Math.round(adx),
      atrPercentile: Math.round(atrPercentile),
      bbWidthPercentile: Math.round(bbWidthPct),
      volumeRatio: Math.round(volumeRatio * 100) / 100,
    });
  }
}
