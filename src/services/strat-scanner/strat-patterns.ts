/**
 * Strat Pattern Logic - Rob Smith's Strat candle classification
 * Pure functions for candle classification and pattern detection.
 * C3 → C2 → C1 (C1 = most recent/current candle)
 */

import type { Candle } from '../../types/index.js';

export type StratCandleType = '1' | '2U' | '2D' | '3';

export interface StratCandle {
  type: StratCandleType;
  direction: 'inside' | 'outside' | 'up' | 'down';
}

/**
 * Classify a candle relative to the previous candle (Rob Smith Strat)
 */
export function classifyCandle(current: Candle, previous: Candle): StratCandle {
  const isInsideBar = current.high <= previous.high && current.low >= previous.low;
  const isOutsideBar = current.high > previous.high && current.low < previous.low;

  if (isInsideBar) return { type: '1', direction: 'inside' };
  if (isOutsideBar) return { type: '3', direction: 'outside' };

  // Directional bar (2)
  if (current.high > previous.high) return { type: '2U', direction: 'up' };
  if (current.low < previous.low) return { type: '2D', direction: 'down' };

  return { type: '1', direction: 'inside' }; // edge case fallback
}

/**
 * Classify C1 candle body shape for context
 */
export function classifyCandleShape(candle: Candle): string {
  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;
  if (range === 0) return 'doji';

  const bodyRatio = body / range;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;

  if (bodyRatio < 0.1) return 'doji';
  if (bodyRatio < 0.3 && lowerWick > body * 2) return 'hammer';
  if (bodyRatio < 0.3 && upperWick > body * 2) return 'shooting star';
  if (bodyRatio > 0.8 && candle.close > candle.open) return 'bullish marubozu';
  if (bodyRatio > 0.8 && candle.close < candle.open) return 'bearish marubozu';
  if (bodyRatio > 0.6 && candle.close > candle.open) return 'bullish';
  if (bodyRatio > 0.6 && candle.close < candle.open) return 'bearish';
  return 'spinning top';
}

export interface DetectedPattern {
  setup: string;
  direction: 'long' | 'short';
  c1: Candle;
  c2: Candle;
  c3: Candle;
  c1Type: StratCandleType;
  c2Type: StratCandleType;
  c3Type: StratCandleType;
}

/**
 * Detect actionable Strat patterns from last 3 candles.
 * C1 = most recent, C2 = previous, C3 = before that.
 */
export function detectStratPatterns(candles: Candle[]): DetectedPattern[] {
  if (candles.length < 3) return [];

  const results: DetectedPattern[] = [];
  const c1 = candles[candles.length - 1];
  const c2 = candles[candles.length - 2];
  const c3 = candles[candles.length - 3];

  const s1 = classifyCandle(c1, c2);
  const s2 = classifyCandle(c2, c3);
  const s3 = classifyCandle(c3, candles[candles.length - 4] ?? c3);

  // Bullish setups (Long) - waiting for next candle to break C1 high
  if (s2.type === '2D' && s1.type === '1') {
    results.push({
      setup: '2-1-2U Rev',
      direction: 'long',
      c1,
      c2,
      c3,
      c1Type: s1.type,
      c2Type: s2.type,
      c3Type: s3.type,
    });
    results.push({
      setup: '2-1-2D Cont',
      direction: 'short',
      c1,
      c2,
      c3,
      c1Type: s1.type,
      c2Type: s2.type,
      c3Type: s3.type,
    });
  }
  if (s2.type === '3' && s1.type === '1') {
    results.push({
      setup: '3-1-2U Rev',
      direction: 'long',
      c1,
      c2,
      c3,
      c1Type: s1.type,
      c2Type: s2.type,
      c3Type: s3.type,
    });
  }
  if (s2.type === '2U' && s1.type === '1') {
    results.push({
      setup: '2-1-2U Cont',
      direction: 'long',
      c1,
      c2,
      c3,
      c1Type: s1.type,
      c2Type: s2.type,
      c3Type: s3.type,
    });
  }
  if (s2.type === '3' && s1.type === '2U') {
    results.push({
      setup: '3-2U-2U Cont',
      direction: 'long',
      c1,
      c2,
      c3,
      c1Type: s1.type,
      c2Type: s2.type,
      c3Type: s3.type,
    });
  }

  // Bearish setups (Short) - waiting for next candle to break C1 low
  if (s2.type === '2U' && s1.type === '1') {
    results.push({
      setup: '2-1-2D Rev',
      direction: 'short',
      c1,
      c2,
      c3,
      c1Type: s1.type,
      c2Type: s2.type,
      c3Type: s3.type,
    });
  }
  if (s2.type === '3' && s1.type === '1') {
    results.push({
      setup: '3-1-2D Rev',
      direction: 'short',
      c1,
      c2,
      c3,
      c1Type: s1.type,
      c2Type: s2.type,
      c3Type: s3.type,
    });
  }
  if (s2.type === '3' && s1.type === '2D') {
    results.push({
      setup: '3-2D-2D Cont',
      direction: 'short',
      c1,
      c2,
      c3,
      c1Type: s1.type,
      c2Type: s2.type,
      c3Type: s3.type,
    });
  }

  // Deduplicate: same candle set can match multiple patterns (e.g. 2-1-2U Rev and 2-1-2D Rev)
  // Keep first match per direction
  const seen = new Set<string>();
  return results.filter((p) => {
    const key = `${p.direction}:${p.setup}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
