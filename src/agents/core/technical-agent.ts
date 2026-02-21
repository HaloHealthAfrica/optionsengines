import { BaseAgent } from '../base-agent.js';
import { AgentOutput, EnrichedSignal, MarketData } from '../../types/index.js';
import {
  computeRSI,
  computeMACD,
  computeVWAP,
  computeVolumeRatio,
  computeADX,
  last,
} from '../utils/technical-indicators.js';

interface IndicatorScore {
  name: string;
  score: number;
  weight: number;
  direction: 'bullish' | 'bearish' | 'neutral';
}

const WEIGHTS = {
  emaTrend: 0.20,
  rsi: 0.15,
  macd: 0.15,
  vwap: 0.10,
  volume: 0.10,
  bollingerPosition: 0.10,
  adxStrength: 0.10,
  priceAction: 0.10,
} as const;

export class TechnicalAgent extends BaseAgent {
  constructor() {
    super('technical', 'core');
  }

  async analyze(signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput> {
    const { candles, indicators, currentPrice } = marketData;
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const volumes = candles.map((c) => c.volume);
    const scores: IndicatorScore[] = [];
    const reasons: string[] = [];

    const ema8 = last(indicators.ema8);
    const ema21 = last(indicators.ema21);
    const ema48 = last(indicators.ema48);
    {
      let dir: IndicatorScore['direction'] = 'neutral';
      let s = 50;
      if (ema8 > ema21 && ema21 > ema48 && currentPrice > ema8) {
        dir = 'bullish'; s = 85;
        reasons.push('strong_bullish_ema_stack');
      } else if (ema8 > ema21 && currentPrice > ema21) {
        dir = 'bullish'; s = 70;
        reasons.push('bullish_ema_alignment');
      } else if (ema8 < ema21 && ema21 < ema48 && currentPrice < ema8) {
        dir = 'bearish'; s = 85;
        reasons.push('strong_bearish_ema_stack');
      } else if (ema8 < ema21 && currentPrice < ema21) {
        dir = 'bearish'; s = 70;
        reasons.push('bearish_ema_alignment');
      } else {
        reasons.push('mixed_ema');
      }
      scores.push({ name: 'emaTrend', score: s, weight: WEIGHTS.emaTrend, direction: dir });
    }

    {
      const rsiArr = computeRSI(closes);
      const rsi = rsiArr.length > 0 ? rsiArr[rsiArr.length - 1] : 50;
      let dir: IndicatorScore['direction'] = 'neutral';
      let s = 50;
      if (rsi > 70) {
        dir = 'bearish'; s = 30;
        reasons.push('rsi_overbought');
      } else if (rsi < 30) {
        dir = 'bullish'; s = 30;
        reasons.push('rsi_oversold');
      } else if (rsi > 55 && rsi <= 70) {
        dir = 'bullish'; s = 65;
        reasons.push('rsi_bullish_momentum');
      } else if (rsi < 45 && rsi >= 30) {
        dir = 'bearish'; s = 65;
        reasons.push('rsi_bearish_momentum');
      }
      scores.push({ name: 'rsi', score: s, weight: WEIGHTS.rsi, direction: dir });
    }

    {
      const macd = computeMACD(closes);
      let dir: IndicatorScore['direction'] = 'neutral';
      let s = 50;
      if (macd.histogram.length > 1) {
        const curr = macd.histogram[macd.histogram.length - 1];
        const prev = macd.histogram[macd.histogram.length - 2];
        if (curr > 0 && curr > prev) {
          dir = 'bullish'; s = 75;
          reasons.push('macd_bullish_expanding');
        } else if (curr > 0 && curr <= prev) {
          dir = 'bullish'; s = 55;
          reasons.push('macd_bullish_fading');
        } else if (curr < 0 && curr < prev) {
          dir = 'bearish'; s = 75;
          reasons.push('macd_bearish_expanding');
        } else if (curr < 0 && curr >= prev) {
          dir = 'bearish'; s = 55;
          reasons.push('macd_bearish_fading');
        }
      }
      scores.push({ name: 'macd', score: s, weight: WEIGHTS.macd, direction: dir });
    }

    {
      const vwap = computeVWAP(candles);
      let dir: IndicatorScore['direction'] = 'neutral';
      let s = 50;
      if (vwap > 0 && currentPrice > 0) {
        const dist = ((currentPrice - vwap) / vwap) * 100;
        if (dist > 0.2) {
          dir = 'bullish'; s = 65;
          reasons.push('price_above_vwap');
        } else if (dist < -0.2) {
          dir = 'bearish'; s = 65;
          reasons.push('price_below_vwap');
        }
      }
      scores.push({ name: 'vwap', score: s, weight: WEIGHTS.vwap, direction: dir });
    }

    {
      const volRatio = computeVolumeRatio(volumes);
      let dir: IndicatorScore['direction'] = 'neutral';
      let s = 50;
      if (volRatio > 1.5) {
        s = 70;
        dir = signal.direction === 'long' ? 'bullish' : 'bearish';
        reasons.push('volume_confirmation');
      } else if (volRatio < 0.5) {
        s = 35;
        reasons.push('low_volume_caution');
      }
      scores.push({ name: 'volume', score: s, weight: WEIGHTS.volume, direction: dir });
    }

    {
      const bbUpper = last(indicators.bollingerBands.upper);
      const bbLower = last(indicators.bollingerBands.lower);
      let dir: IndicatorScore['direction'] = 'neutral';
      let s = 50;
      if (bbUpper > bbLower && bbUpper > 0) {
        const bbRange = bbUpper - bbLower;
        const pos = (currentPrice - bbLower) / bbRange;
        if (pos > 0.9) {
          dir = 'bullish'; s = 40;
          reasons.push('near_upper_bollinger');
        } else if (pos < 0.1) {
          dir = 'bearish'; s = 40;
          reasons.push('near_lower_bollinger');
        } else if (pos > 0.5) {
          dir = 'bullish'; s = 60;
        } else {
          dir = 'bearish'; s = 60;
        }
      }
      scores.push({ name: 'bollingerPosition', score: s, weight: WEIGHTS.bollingerPosition, direction: dir });
    }

    {
      const adxArr = computeADX(highs, lows, closes, 14);
      const adx = adxArr.length > 0 ? adxArr[adxArr.length - 1] : 20;
      let s = 50;
      let dir: IndicatorScore['direction'] = 'neutral';
      if (adx > 30) {
        s = 75;
        dir = signal.direction === 'long' ? 'bullish' : 'bearish';
        reasons.push('strong_trend_adx');
      } else if (adx < 15) {
        s = 30;
        reasons.push('weak_trend_adx');
      }
      scores.push({ name: 'adxStrength', score: s, weight: WEIGHTS.adxStrength, direction: dir });
    }

    {
      let dir: IndicatorScore['direction'] = 'neutral';
      let s = 50;
      if (candles.length >= 3) {
        const last3 = candles.slice(-3);
        const isHigherHighs = last3[2].high > last3[1].high && last3[1].high > last3[0].high;
        const isHigherLows = last3[2].low > last3[1].low && last3[1].low > last3[0].low;
        const isLowerHighs = last3[2].high < last3[1].high && last3[1].high < last3[0].high;
        const isLowerLows = last3[2].low < last3[1].low && last3[1].low < last3[0].low;
        if (isHigherHighs && isHigherLows) {
          dir = 'bullish'; s = 70;
          reasons.push('higher_highs_higher_lows');
        } else if (isLowerHighs && isLowerLows) {
          dir = 'bearish'; s = 70;
          reasons.push('lower_highs_lower_lows');
        }
      }
      scores.push({ name: 'priceAction', score: s, weight: WEIGHTS.priceAction, direction: dir });
    }

    let bullishWeight = 0;
    let totalWeight = 0;
    let weightedScore = 0;

    for (const ind of scores) {
      totalWeight += ind.weight;
      if (ind.direction === 'bullish') {
        bullishWeight += ind.weight * (ind.score / 100);
        weightedScore += ind.weight * ind.score;
      } else if (ind.direction === 'bearish') {
        bullishWeight -= ind.weight * (ind.score / 100);
        weightedScore += ind.weight * (100 - ind.score);
      } else {
        weightedScore += ind.weight * 50;
      }
    }

    const conflictingCount = scores.filter(
      (s) => s.direction !== 'neutral' && s.direction !== (bullishWeight > 0 ? 'bullish' : 'bearish')
    ).length;

    let bias: AgentOutput['bias'] = 'neutral';
    let confidence = Math.round(weightedScore / totalWeight);

    if (bullishWeight > 0.15) {
      bias = 'bullish';
    } else if (bullishWeight < -0.15) {
      bias = 'bearish';
    }

    if (conflictingCount >= 3) {
      confidence = Math.min(confidence, 45);
      reasons.push('multiple_conflicting_indicators');
    }

    confidence = Math.max(15, Math.min(90, confidence));

    return this.buildOutput(bias, confidence, reasons, false, {
      agentType: 'core',
      indicatorScores: scores.map((s) => ({
        name: s.name,
        direction: s.direction,
        score: s.score,
      })),
      bullishWeight: Math.round(bullishWeight * 1000) / 1000,
      conflictingCount,
    });
  }
}
