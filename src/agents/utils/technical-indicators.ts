import type { Candle } from '../../types/index.js';

function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

export function computeRSI(closes: number[], period = 14): number[] {
  if (closes.length < period + 1) return [];
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const rsi: number[] = [];

  for (let i = period; i < gains.length; i++) {
    if (i > period) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rs));
  }
  return rsi;
}

export interface MACDResult {
  macdLine: number[];
  signalLine: number[];
  histogram: number[];
}

export function computeMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MACDResult {
  if (closes.length < slowPeriod + signalPeriod) {
    return { macdLine: [], signalLine: [], histogram: [] };
  }
  const fastEma = ema(closes, fastPeriod);
  const slowEma = ema(closes, slowPeriod);
  const macdLine = fastEma.map((f, i) => f - slowEma[i]);
  const signalLine = ema(macdLine.slice(slowPeriod - 1), signalPeriod);
  const offset = macdLine.length - signalLine.length;
  const histogram = signalLine.map((s, i) => macdLine[i + offset] - s);
  return { macdLine, signalLine, histogram };
}

export interface ADXResult {
  adx: number[];
  plusDI: number[];
  minusDI: number[];
}

export function computeADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): ADXResult {
  const len = highs.length;
  if (len < period * 2) return { adx: [], plusDI: [], minusDI: [] };

  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < len; i++) {
    const hiDiff = highs[i] - highs[i - 1];
    const loDiff = lows[i - 1] - lows[i];
    plusDM.push(hiDiff > loDiff && hiDiff > 0 ? hiDiff : 0);
    minusDM.push(loDiff > hiDiff && loDiff > 0 ? loDiff : 0);
    tr.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      )
    );
  }

  const smooth = (arr: number[]): number[] => {
    const result: number[] = [arr.slice(0, period).reduce((a, b) => a + b, 0)];
    for (let i = period; i < arr.length; i++) {
      result.push(result[result.length - 1] - result[result.length - 1] / period + arr[i]);
    }
    return result;
  };

  const smoothTR = smooth(tr);
  const smoothPlusDM = smooth(plusDM);
  const smoothMinusDM = smooth(minusDM);

  const dx: number[] = [];
  const plusDIArr: number[] = [];
  const minusDIArr: number[] = [];
  for (let i = 0; i < smoothTR.length; i++) {
    if (smoothTR[i] === 0) {
      dx.push(0);
      plusDIArr.push(0);
      minusDIArr.push(0);
      continue;
    }
    const pdi = (smoothPlusDM[i] / smoothTR[i]) * 100;
    const mdi = (smoothMinusDM[i] / smoothTR[i]) * 100;
    plusDIArr.push(pdi);
    minusDIArr.push(mdi);
    const sum = pdi + mdi;
    dx.push(sum === 0 ? 0 : (Math.abs(pdi - mdi) / sum) * 100);
  }

  if (dx.length < period) return { adx: [], plusDI: [], minusDI: [] };
  const adx: number[] = [dx.slice(0, period).reduce((a, b) => a + b, 0) / period];
  for (let i = period; i < dx.length; i++) {
    adx.push((adx[adx.length - 1] * (period - 1) + dx[i]) / period);
  }

  const diOffset = plusDIArr.length - adx.length;
  return {
    adx,
    plusDI: plusDIArr.slice(diOffset),
    minusDI: minusDIArr.slice(diOffset),
  };
}

export function computeVWAP(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  let cumTPV = 0;
  let cumVol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumTPV += tp * c.volume;
    cumVol += c.volume;
  }
  return cumVol === 0 ? candles[candles.length - 1].close : cumTPV / cumVol;
}

export function computeVolumeRatio(volumes: number[], period = 20): number {
  if (volumes.length < period + 1) return 1;
  const recent = volumes[volumes.length - 1];
  const avg =
    volumes.slice(-period - 1, -1).reduce((a, b) => a + b, 0) / period;
  return avg === 0 ? 1 : recent / avg;
}

export function computeBBWidthPercentile(
  upper: number[],
  lower: number[],
  middle: number[],
  lookback = 120
): number {
  const widths: number[] = [];
  const len = Math.min(upper.length, lower.length, middle.length);
  for (let i = 0; i < len; i++) {
    const mid = middle[i] || 1;
    widths.push((upper[i] - lower[i]) / mid);
  }
  if (widths.length < 2) return 50;
  const current = widths[widths.length - 1];
  const sample = widths.slice(-lookback);
  const sorted = [...sample].sort((a, b) => a - b);
  const rank = sorted.filter((w) => w <= current).length;
  return (rank / sorted.length) * 100;
}

export function latestN(arr: number[], n: number): number[] {
  return arr.slice(-n);
}

export function last(arr: number[]): number {
  return arr[arr.length - 1] ?? 0;
}
