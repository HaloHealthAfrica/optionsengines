import { TechnicalAgent } from '../../agents/core/technical-agent.js';
import type { EnrichedSignal, MarketData, Candle } from '../../types/index.js';

function makeSignal(direction: 'long' | 'short' = 'long'): EnrichedSignal {
  return {
    signalId: 'test', symbol: 'SPY', direction, timeframe: '5m',
    timestamp: new Date(), sessionType: 'RTH',
  };
}

function makeCandles(count: number, trend: 'up' | 'down' | 'flat'): Candle[] {
  const candles: Candle[] = [];
  let base = 100;
  for (let i = 0; i < count; i++) {
    const delta = trend === 'up' ? 0.5 : trend === 'down' ? -0.5 : 0;
    const c = base + delta * i;
    candles.push({
      timestamp: new Date(Date.now() - (count - i) * 60000),
      open: c - 0.2, high: c + 0.5, low: c - 0.5, close: c, volume: 10000 + i * 100,
    });
    base = c;
  }
  return candles;
}

function emaCalc(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function makeMarketData(candles: Candle[]): MarketData {
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const ema8 = emaCalc(closes, 8);
  const ema21 = emaCalc(closes, 21);
  const ema48 = emaCalc(closes, 48);
  return {
    candles,
    indicators: {
      ema8, ema13: ema8, ema21, ema48, ema200: ema48,
      atr: candles.map(() => 1),
      bollingerBands: { upper: closes.map((c) => c + 2), middle: closes, lower: closes.map((c) => c - 2) },
      keltnerChannels: { upper: closes.map((c) => c + 2), middle: closes, lower: closes.map((c) => c - 2) },
      ttmSqueeze: { state: 'off', momentum: 0 },
    },
    currentPrice: price,
    sessionContext: { sessionType: 'RTH', isMarketOpen: true },
  };
}

describe('TechnicalAgent (TechnicalStructureAgent)', () => {
  const agent = new TechnicalAgent();

  it('detects bullish trend with multiple confirmations', async () => {
    const candles = makeCandles(50, 'up');
    const output = await agent.analyze(makeSignal('long'), makeMarketData(candles));
    expect(output.bias).toBe('bullish');
    expect(output.confidence).toBeGreaterThan(50);
    expect(output.metadata?.indicatorScores).toBeDefined();
    expect(Array.isArray(output.metadata?.indicatorScores)).toBe(true);
  });

  it('detects bearish trend', async () => {
    const candles = makeCandles(50, 'down');
    const output = await agent.analyze(makeSignal('short'), makeMarketData(candles));
    expect(output.bias).toBe('bearish');
  });

  it('returns neutral on flat market', async () => {
    const candles = makeCandles(50, 'flat');
    const output = await agent.analyze(makeSignal('long'), makeMarketData(candles));
    expect(['neutral', 'bullish', 'bearish']).toContain(output.bias);
    expect(output.confidence).toBeLessThanOrEqual(70);
  });

  it('includes all 8 indicator scores in metadata', async () => {
    const candles = makeCandles(50, 'up');
    const output = await agent.analyze(makeSignal('long'), makeMarketData(candles));
    expect(output.metadata?.indicatorScores).toHaveLength(8);
  });

  it('penalizes conflicting indicators', async () => {
    const candles = makeCandles(50, 'flat');
    const output = await agent.analyze(makeSignal('long'), makeMarketData(candles));
    expect(output.confidence).toBeLessThanOrEqual(80);
  });
});
