import { StratSpecialist } from '../../agents/specialists/strat-specialist.js';
import type { EnrichedSignal, MarketData, Candle } from '../../types/index.js';

jest.mock('../../services/feature-flag.service.js', () => ({
  featureFlags: { isEnabled: () => true },
}));

function makeCandle(o: number, h: number, l: number, c: number): Candle {
  return {
    timestamp: new Date(),
    open: o, high: h, low: l, close: c, volume: 1000,
  };
}

function makeSignal(direction: 'long' | 'short'): EnrichedSignal {
  return {
    signalId: 'test',
    symbol: 'SPY',
    direction,
    timeframe: '5m',
    timestamp: new Date(),
    sessionType: 'RTH',
  };
}

function makeMarketData(candles: Candle[]): MarketData {
  return {
    candles,
    indicators: {
      ema8: [100], ema13: [100], ema21: [100], ema48: [100], ema200: [100],
      atr: [1],
      bollingerBands: { upper: [102], middle: [100], lower: [98] },
      keltnerChannels: { upper: [102], middle: [100], lower: [98] },
      ttmSqueeze: { state: 'off', momentum: 0 },
    },
    currentPrice: 100,
    sessionContext: { sessionType: 'RTH', isMarketOpen: true },
  };
}

describe('StratSpecialist', () => {
  const agent = new StratSpecialist();

  it('detects bullish 2-1-2 pattern aligned with long signal', async () => {
    const candles = [
      makeCandle(98, 101, 97, 100),  // bar 0
      makeCandle(99, 100, 99, 99.5), // inside bar (1)
      makeCandle(99, 102, 98, 101),  // breakout up (2) → trigger closes > setup high
    ];
    const output = await agent.analyze(makeSignal('long'), makeMarketData(candles));
    expect(output.bias).toBe('bullish');
    expect(output.confidence).toBeGreaterThanOrEqual(70);
    expect(output.metadata?.signalAligned).toBe(true);
    expect(output.metadata?.patternDirection).toBe('bullish');
  });

  it('detects bearish 2-1-2 pattern aligned with short signal', async () => {
    const candles = [
      makeCandle(100, 103, 98, 99),  // bar 0
      makeCandle(100, 101, 99, 100), // inside bar (1)
      makeCandle(100, 100, 96, 97),  // breakout down (2) → trigger closes < setup low
    ];
    const output = await agent.analyze(makeSignal('short'), makeMarketData(candles));
    expect(output.bias).toBe('bearish');
    expect(output.confidence).toBeGreaterThanOrEqual(70);
    expect(output.metadata?.signalAligned).toBe(true);
    expect(output.metadata?.patternDirection).toBe('bearish');
  });

  it('returns neutral for no pattern', async () => {
    const candles = [
      makeCandle(100, 103, 98, 101),
      makeCandle(101, 105, 99, 104),  // directional (2)
      makeCandle(104, 108, 102, 107), // directional (2)
    ];
    const output = await agent.analyze(makeSignal('long'), makeMarketData(candles));
    expect(output.bias).toBe('neutral');
    expect(output.confidence).toBeLessThanOrEqual(30);
  });

  it('penalizes mismatch: bearish pattern + long signal', async () => {
    const candles = [
      makeCandle(100, 103, 98, 99),  // bar 0
      makeCandle(100, 101, 99, 100), // inside bar (1)
      makeCandle(100, 100, 96, 97),  // breakout down (2) → bearish
    ];
    const output = await agent.analyze(makeSignal('long'), makeMarketData(candles));
    expect(output.bias).toBe('bearish');
    expect(output.metadata?.signalAligned).toBe(false);
    expect(output.confidence).toBeLessThanOrEqual(35);
  });

  it('should not activate without feature flag', () => {
    jest.resetModules();
    jest.mock('../../services/feature-flag.service.js', () => ({
      featureFlags: { isEnabled: () => false },
    }));
    const agent2 = new StratSpecialist();
    // shouldActivate checks feature flag first
    expect(agent2.shouldActivate(makeSignal('long'), makeMarketData([
      makeCandle(100, 101, 99, 100),
      makeCandle(100, 101, 99, 100),
      makeCandle(100, 101, 99, 100),
    ]))).toBe(false);
  });
});
