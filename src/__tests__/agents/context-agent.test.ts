import { ContextAgent } from '../../agents/core/context-agent.js';
import type { EnrichedSignal, MarketData, GexData } from '../../types/index.js';

function makeSignal(opts?: Partial<EnrichedSignal>): EnrichedSignal {
  return {
    signalId: 'test',
    symbol: 'SPY',
    direction: 'long',
    timeframe: '5m',
    timestamp: new Date(),
    sessionType: 'RTH',
    ...opts,
  };
}

function makeMarketData(opts?: { gex?: Partial<GexData>; isOpen?: boolean; atr?: number }): MarketData {
  const atr = opts?.atr ?? 1;
  return {
    candles: [],
    indicators: {
      ema8: [450], ema13: [449], ema21: [448], ema48: [447], ema200: [440],
      atr: [atr],
      bollingerBands: { upper: [455], middle: [450], lower: [445] },
      keltnerChannels: { upper: [455], middle: [450], lower: [445] },
      ttmSqueeze: { state: 'off', momentum: 0 },
    },
    currentPrice: 450,
    sessionContext: { sessionType: 'RTH', isMarketOpen: opts?.isOpen ?? true },
    gex: opts?.gex ? {
      symbol: 'SPY',
      netGex: 1000,
      totalCallGex: 2000,
      totalPutGex: 1000,
      dealerPosition: 'neutral',
      volatilityExpectation: 'neutral',
      updatedAt: new Date(),
      levels: [],
      ...opts.gex,
    } : null,
  };
}

describe('ContextAgent', () => {
  const agent = new ContextAgent();

  it('returns low confidence when market is closed', async () => {
    const output = await agent.analyze(makeSignal(), makeMarketData({ isOpen: false }));
    expect(output.confidence).toBeLessThanOrEqual(15);
    expect(output.reasons).toContain('market_closed');
  });

  it('caps confidence at 65 under long gamma regime', async () => {
    const output = await agent.analyze(
      makeSignal({ setupType: 'breakout' }),
      makeMarketData({ gex: { dealerPosition: 'long_gamma', netGex: 5000 } })
    );
    expect(output.confidence).toBeLessThanOrEqual(65);
    expect(output.metadata?.gammaRegime).toBe('mean_reversion');
    expect(output.reasons).toContain('gamma_resists_breakout');
  });

  it('allows higher confidence under short gamma for breakout', async () => {
    const output = await agent.analyze(
      makeSignal({ setupType: 'breakout' }),
      makeMarketData({ gex: { dealerPosition: 'short_gamma', netGex: -5000 } })
    );
    expect(output.confidence).toBeLessThanOrEqual(85);
    expect(output.metadata?.gammaRegime).toBe('vol_expansion');
    expect(output.reasons).toContain('gamma_supports_breakout');
  });

  it('supports pullback trades under long gamma', async () => {
    const output = await agent.analyze(
      makeSignal({ setupType: 'pullback' }),
      makeMarketData({ gex: { dealerPosition: 'long_gamma', netGex: 5000 } })
    );
    expect(output.reasons).toContain('gamma_supports_pullback');
  });

  it('penalizes extreme volatility', async () => {
    const output = await agent.analyze(
      makeSignal(),
      makeMarketData({ atr: 15 })
    );
    expect(output.reasons).toContain('extreme_volatility');
    expect(output.confidence).toBeLessThanOrEqual(35);
  });
});
