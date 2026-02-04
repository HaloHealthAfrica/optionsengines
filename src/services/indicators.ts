// Technical Indicators - Derived from OHLCV data (no additional API calls)
import { Candle, Indicators } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class IndicatorService {
  /**
   * Calculate Exponential Moving Average (EMA)
   */
  calculateEMA(values: number[], period: number): number[] {
    if (values.length < period) {
      return [];
    }

    const ema: number[] = [];
    const multiplier = 2 / (period + 1);

    // Start with SMA for first value
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += values[i];
    }
    ema.push(sum / period);

    // Calculate EMA for remaining values
    for (let i = period; i < values.length; i++) {
      const value = (values[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
      ema.push(value);
    }

    return ema;
  }

  /**
   * Calculate Simple Moving Average (SMA)
   */
  calculateSMA(values: number[], period: number): number[] {
    if (values.length < period) {
      return [];
    }

    const sma: number[] = [];

    for (let i = period - 1; i < values.length; i++) {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += values[i - j];
      }
      sma.push(sum / period);
    }

    return sma;
  }

  /**
   * Calculate Average True Range (ATR)
   */
  calculateATR(candles: Candle[], period: number = 14): number[] {
    if (candles.length < period + 1) {
      return [];
    }

    const trueRanges: number[] = [];

    // Calculate True Range for each candle
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );

      trueRanges.push(tr);
    }

    // Calculate ATR using EMA of True Ranges
    return this.calculateEMA(trueRanges, period);
  }

  /**
   * Calculate Bollinger Bands
   */
  calculateBollingerBands(
    values: number[],
    period: number = 20,
    stdDev: number = 2
  ): { upper: number[]; middle: number[]; lower: number[] } {
    const sma = this.calculateSMA(values, period);
    const upper: number[] = [];
    const lower: number[] = [];

    for (let i = 0; i < sma.length; i++) {
      const dataIndex = i + period - 1;
      
      // Calculate standard deviation for this window
      let sumSquaredDiff = 0;
      for (let j = 0; j < period; j++) {
        const diff = values[dataIndex - j] - sma[i];
        sumSquaredDiff += diff * diff;
      }
      const std = Math.sqrt(sumSquaredDiff / period);

      upper.push(sma[i] + stdDev * std);
      lower.push(sma[i] - stdDev * std);
    }

    return {
      upper,
      middle: sma,
      lower,
    };
  }

  /**
   * Calculate Keltner Channels
   */
  calculateKeltnerChannels(
    candles: Candle[],
    period: number = 20,
    atrMultiplier: number = 1.5
  ): { upper: number[]; middle: number[]; lower: number[] } {
    const closes = candles.map((c) => c.close);
    const ema = this.calculateEMA(closes, period);
    const atr = this.calculateATR(candles, period);

    const upper: number[] = [];
    const lower: number[] = [];

    // Align arrays (ATR is one element shorter due to TR calculation)
    const startIndex = closes.length - ema.length;

    for (let i = 0; i < ema.length; i++) {
      const atrIndex = i + startIndex - 1;
      const atrValue = atrIndex >= 0 && atrIndex < atr.length ? atr[atrIndex] : 0;

      upper.push(ema[i] + atrMultiplier * atrValue);
      lower.push(ema[i] - atrMultiplier * atrValue);
    }

    return {
      upper,
      middle: ema,
      lower,
    };
  }

  /**
   * Calculate TTM Squeeze indicator
   * Squeeze ON: Bollinger Bands inside Keltner Channels
   * Squeeze OFF: Bollinger Bands outside Keltner Channels
   */
  calculateTTMSqueeze(candles: Candle[]): {
    state: 'on' | 'off';
    momentum: number;
  } {
    if (candles.length < 20) {
      return { state: 'off', momentum: 0 };
    }

    const closes = candles.map((c) => c.close);
    
    // Calculate Bollinger Bands (20, 2)
    const bb = this.calculateBollingerBands(closes, 20, 2);
    
    // Calculate Keltner Channels (20, 1.5)
    const kc = this.calculateKeltnerChannels(candles, 20, 1.5);

    // Get latest values
    const bbUpper = bb.upper[bb.upper.length - 1];
    const bbLower = bb.lower[bb.lower.length - 1];
    const kcUpper = kc.upper[kc.upper.length - 1];
    const kcLower = kc.lower[kc.lower.length - 1];

    // Squeeze is ON when BB is inside KC
    const squeezeOn = bbUpper < kcUpper && bbLower > kcLower;

    // Calculate momentum (linear regression of close - SMA)
    const sma = this.calculateSMA(closes, 20);
    const momentum = this.calculateMomentum(closes, sma);

    return {
      state: squeezeOn ? 'on' : 'off',
      momentum,
    };
  }

  /**
   * Calculate momentum for TTM Squeeze
   * Uses linear regression of (close - SMA)
   */
  private calculateMomentum(closes: number[], sma: number[]): number {
    if (sma.length < 2) {
      return 0;
    }

    const values: number[] = [];
    const startIndex = closes.length - sma.length;

    for (let i = 0; i < sma.length; i++) {
      values.push(closes[startIndex + i] - sma[i]);
    }

    // Simple linear regression slope
    const n = values.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

    return slope;
  }

  /**
   * Derive all indicators from candles
   */
  deriveIndicators(candles: Candle[]): Indicators {
    if (candles.length < 200) {
      logger.warn('Insufficient candles for full indicator calculation', {
        count: candles.length,
      });
    }

    const closes = candles.map((c) => c.close);

    // Calculate EMAs
    const ema8 = this.calculateEMA(closes, 8);
    const ema13 = this.calculateEMA(closes, 13);
    const ema21 = this.calculateEMA(closes, 21);
    const ema48 = this.calculateEMA(closes, 48);
    const ema200 = this.calculateEMA(closes, 200);

    // Calculate ATR
    const atr = this.calculateATR(candles, 20);

    // Calculate Bollinger Bands
    const bollingerBands = this.calculateBollingerBands(closes, 20, 2);

    // Calculate Keltner Channels
    const keltnerChannels = this.calculateKeltnerChannels(candles, 20, 1.5);

    // Calculate TTM Squeeze
    const ttmSqueeze = this.calculateTTMSqueeze(candles);

    logger.debug('Indicators derived from candles', {
      candleCount: candles.length,
      ema8Length: ema8.length,
      ema200Length: ema200.length,
      ttmState: ttmSqueeze.state,
    });

    return {
      ema8,
      ema13,
      ema21,
      ema48,
      ema200,
      atr,
      bollingerBands,
      keltnerChannels,
      ttmSqueeze,
    };
  }

  /**
   * Get latest indicator values (most recent)
   */
  getLatestValues(indicators: Indicators): {
    ema8: number;
    ema13: number;
    ema21: number;
    ema48: number;
    ema200: number;
    atr: number;
    bbUpper: number;
    bbMiddle: number;
    bbLower: number;
    kcUpper: number;
    kcMiddle: number;
    kcLower: number;
    ttmState: 'on' | 'off';
    ttmMomentum: number;
  } {
    return {
      ema8: indicators.ema8[indicators.ema8.length - 1] || 0,
      ema13: indicators.ema13[indicators.ema13.length - 1] || 0,
      ema21: indicators.ema21[indicators.ema21.length - 1] || 0,
      ema48: indicators.ema48[indicators.ema48.length - 1] || 0,
      ema200: indicators.ema200[indicators.ema200.length - 1] || 0,
      atr: indicators.atr[indicators.atr.length - 1] || 0,
      bbUpper: indicators.bollingerBands.upper[indicators.bollingerBands.upper.length - 1] || 0,
      bbMiddle: indicators.bollingerBands.middle[indicators.bollingerBands.middle.length - 1] || 0,
      bbLower: indicators.bollingerBands.lower[indicators.bollingerBands.lower.length - 1] || 0,
      kcUpper: indicators.keltnerChannels.upper[indicators.keltnerChannels.upper.length - 1] || 0,
      kcMiddle: indicators.keltnerChannels.middle[indicators.keltnerChannels.middle.length - 1] || 0,
      kcLower: indicators.keltnerChannels.lower[indicators.keltnerChannels.lower.length - 1] || 0,
      ttmState: indicators.ttmSqueeze.state,
      ttmMomentum: indicators.ttmSqueeze.momentum,
    };
  }
}

// Singleton instance
export const indicators = new IndicatorService();
