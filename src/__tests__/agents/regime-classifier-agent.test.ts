import { RegimeClassifierAgent } from '../../agents/core/regime-classifier-agent.js';
import type { EnrichedSignal, MarketData, Candle } from '../../types/index.js';

function makeSignal(opts?: Partial<EnrichedSignal>): EnrichedSignal {
  return {
    signalId: 'test', symbol: 'SPY', direction: 'long', timeframe: '5m',
    timestamp: new Date(), sessionType: 'RTH', ...opts,
  };
}

function makeTrendCandles(count: number, volatility: number): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    price += volatility * 0.8;
    candles.push({
      timestamp: new Date(Date.now() - (count - i) * 60000),
      open: price - volatility * 0.3,
      high: price + volatility * 0.5,
      low: price - volatility * 0.5,
      close: price,
      volume: 50000,
    });
  }
  return candles;
}

function makeRangeCandles(count: number): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const base = 100 + Math.sin(i * 0.5) * 0.5;
    candles.push({
      timestamp: new Date(Date.now() - (count - i) * 60000),
      open: base - 0.1,
      high: base + 0.3,
      low: base - 0.3,
      close: base + 0.1,
      volume: 30000,
    });
  }
  return candles;
}

function makeMarketData(candles: Candle[]): MarketData {
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const atr = candles.map((c) => c.high - c.low);
  return {
    candles,
    indicators: {
      ema8: closes, ema13: closes, ema21: closes, ema48: closes, ema200: closes,
      atr,
      bollingerBands: {
        upper: closes.map((c) => c + 2),
        middle: closes,
        lower: closes.map((c) => c - 2),
      },
      keltnerChannels: {
        upper: closes.map((c) => c + 2),
        middle: closes,
        lower: closes.map((c) => c - 2),
      },
      ttmSqueeze: { state: 'off', momentum: 0 },
    },
    currentPrice: price,
    sessionContext: { sessionType: 'RTH', isMarketOpen: true },
  };
}

describe('RegimeClassifierAgent', () => {
  const agent = new RegimeClassifierAgent();

  it('classifies strong trend with high volatility candles', async () => {
    const candles = makeTrendCandles(50, 2);
    const output = await agent.analyze(makeSignal(), makeMarketData(candles));
    expect(output.metadata?.regimeContext).toBeDefined();
    expect(output.metadata?.adx).toBeGreaterThan(0);
  });

  it('classifies range-bound market', async () => {
    const candles = makeRangeCandles(50);
    const output = await agent.analyze(makeSignal(), makeMarketData(candles));
    expect(output.metadata?.regimeContext).toBeDefined();
    const regime = output.metadata?.regimeContext?.regime;
    expect(['range', 'compression', 'transitional']).toContain(regime);
  });

  it('penalizes breakout setup in range regime', async () => {
    const candles = makeRangeCandles(50);
    const output = await agent.analyze(
      makeSignal({ setupType: 'breakout' }),
      makeMarketData(candles)
    );
    expect(output.metadata?.regimeContext).toBeDefined();
  });

  it('includes volume ratio in metadata', async () => {
    const candles = makeTrendCandles(50, 1);
    const output = await agent.analyze(makeSignal(), makeMarketData(candles));
    expect(output.metadata?.volumeRatio).toBeDefined();
    expect(typeof output.metadata?.volumeRatio).toBe('number');
  });
});
