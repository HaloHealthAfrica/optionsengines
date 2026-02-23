import {
  TradeStructure,
  TradeDirection,
  OptionRight,
  LegRole,
  GreekSource,
  RejectionCode,
  IVRegime,
  TermShape,
} from '../../engine/types/enums';
import type { TradeIntent, OptionCandidate, MarketContext } from '../../engine/types/index';

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
jest.mock('../../config/index', () => ({
  config: {
    logLevel: 'info', databaseUrl: '', dbPoolMax: 5, slowRequestMs: 1000,
    polygonApiKey: 'test-key', polygonBaseUrl: 'https://api.polygon.io',
  },
}));

const mockGetEngineConfig = jest.fn();
jest.mock('../../engine/config/loader', () => ({
  getEngineConfig: () => mockGetEngineConfig(),
}));

const mockGetOptionsChain = jest.fn();
const mockGetOptionsSnapshot = jest.fn();
jest.mock('../../engine/data/MassiveOptionsService', () => ({
  massiveOptionsService: {
    getOptionsChain: (...args: any[]) => mockGetOptionsChain(...args),
    getOptionsSnapshot: (...args: any[]) => mockGetOptionsSnapshot(...args),
  },
}));

const mockValidateUnderlying = jest.fn();
const mockValidateCandidate = jest.fn();
jest.mock('../../engine/data/DataSanityValidator', () => ({
  dataSanityValidator: {
    validateUnderlying: (...args: any[]) => mockValidateUnderlying(...args),
    validateCandidate: (...args: any[]) => mockValidateCandidate(...args),
  },
}));

jest.mock('../../services/redis-cache.service', () => ({
  redisCache: { get: jest.fn(), set: jest.fn() },
}));

import { OptionsConstructionEngine } from '../../engine/construction/OptionsConstructionEngine';

describe('OptionsConstructionEngine', () => {
  let engine: OptionsConstructionEngine;

  const defaultConfig = {
    latency: { maxConstructionLatencyMs: 400 },
    liquidity: {
      minOI: 200, minVolume: 50, maxSpreadWidthPct: 0.15,
      minLiquidityScore: 0.55, minCreditRatio: 0.33,
      volumeMaxRefDefault: 5000, oiMaxRefDefault: 20000,
    },
    sanity: { maxDelta: 1.05, maxIV: 5.0 },
    slippage: { repriceAttempts: 3, repriceIntervalSeconds: 10 },
    exits: { creditSpread: { profitTargetPct: 0.50, stopLossPct: 1.00 } },
    cache: { chainTTLSeconds: 300, snapshotTTLSeconds: 2 },
  };

  const defaultIntent: TradeIntent = {
    underlying: 'SPY',
    structure: TradeStructure.LONG_CALL,
    direction: TradeDirection.BULLISH,
    targetDTE: 21,
    dteTolerance: 7,
    targetDelta: 0.40,
    deltaTolerance: 0.15,
    maxRiskPerTrade: 500,
    confidenceScore: 0.75,
    strategyTag: 'ORB',
    accountId: 'acct-1',
    signalId: 'sig-1',
  };

  const defaultMarketContext: MarketContext = {
    underlyingPrice: 500,
    ivPercentile: 0.55,
    ivRegime: IVRegime.NEUTRAL,
    termShape: TermShape.CONTANGO,
    underlyingVolume: 50000000,
    avgVolume30D: 45000000,
  };

  function makeContracts(count: number): Array<{ ticker: string; underlying_ticker: string; contract_type: string; expiration_date: string; strike_price: number }> {
    return Array.from({ length: count }, (_, i) => ({
      ticker: `O:SPY260315C00${490 + i}000`,
      underlying_ticker: 'SPY',
      contract_type: 'call',
      expiration_date: (() => {
        const d = new Date();
        d.setDate(d.getDate() + 21);
        return d.toISOString().split('T')[0];
      })(),
      strike_price: 490 + i,
    }));
  }

  function makeQuotes(contracts: Array<{ ticker: string }>): Array<{
    optionTicker: string; bid: number; ask: number; mid: number; midpoint: number;
    delta: number; gamma: number; theta: number; vega: number; iv: number;
    volume: number; oi: number; greekSource: GreekSource;
    quoteTimestamp: Date; underlyingPrice: number;
  }> {
    return contracts.map((c, i) => ({
      optionTicker: c.ticker,
      underlyingTicker: 'SPY',
      contractType: 'call' as const,
      expirationDate: (() => { const d = new Date(); d.setDate(d.getDate() + 21); return d.toISOString().split('T')[0]; })(),
      strikePrice: 490 + i,
      bid: 4.50 - i * 0.3,
      ask: 4.70 - i * 0.3,
      mid: 4.60 - i * 0.3,
      midpoint: 4.60 - i * 0.3,
      delta: 0.45 - i * 0.03,
      gamma: 0.03,
      theta: -0.05,
      vega: 0.12,
      iv: 0.25,
      volume: 1500 + i * 100,
      oi: 8000 + i * 500,
      greekSource: GreekSource.MASSIVE,
      quoteTimestamp: new Date(),
      underlyingPrice: 500,
    }));
  }

  beforeEach(() => {
    engine = new OptionsConstructionEngine();
    mockGetEngineConfig.mockReturnValue(defaultConfig);
    mockValidateUnderlying.mockReturnValue({ passed: true });
    mockValidateCandidate.mockReturnValue({ passed: true });
  });

  afterEach(() => jest.restoreAllMocks());

  // ─── Liquidity Score Math ───

  describe('computeLiquidityScore', () => {
    const liqCfg = { volumeMaxRefDefault: 5000, oiMaxRefDefault: 20000 };

    test('computes score correctly for moderate values', () => {
      const score = engine.computeLiquidityScore(
        { volume: 2500, oi: 10000, spreadWidthPct: 0.05 },
        liqCfg
      );
      // volumeNorm = 0.5, oiNorm = 0.5, spreadScore = 0.95
      // 0.40*0.5 + 0.30*0.5 + 0.30*0.95 = 0.20 + 0.15 + 0.285 = 0.635
      expect(score).toBeCloseTo(0.635, 3);
    });

    test('clamps high volume/oi at 1.0', () => {
      const score = engine.computeLiquidityScore(
        { volume: 50000, oi: 100000, spreadWidthPct: 0.01 },
        liqCfg
      );
      // volumeNorm = 1, oiNorm = 1, spreadScore = 0.99
      // 0.40 + 0.30 + 0.30*0.99 = 0.997
      expect(score).toBeCloseTo(0.997, 3);
    });

    test('returns 0 for zero volume, oi, and max spread', () => {
      const score = engine.computeLiquidityScore(
        { volume: 0, oi: 0, spreadWidthPct: 1.0 },
        liqCfg
      );
      expect(score).toBe(0);
    });

    test('handles negative spreadWidthPct gracefully', () => {
      const score = engine.computeLiquidityScore(
        { volume: 5000, oi: 20000, spreadWidthPct: -0.5 },
        liqCfg
      );
      // spreadScore clamps to 1.0
      expect(score).toBeCloseTo(1.0, 3);
    });
  });

  // ─── Delta Score ───

  describe('computeDeltaScore', () => {
    test('returns 1 for exact target delta', () => {
      const score = engine.computeDeltaScore(
        { delta: 0.40 },
        defaultIntent
      );
      expect(score).toBe(1);
    });

    test('returns 0 for delta at tolerance boundary', () => {
      const score = engine.computeDeltaScore(
        { delta: 0.40 + 0.15 },
        defaultIntent
      );
      expect(score).toBe(0);
    });

    test('returns 0 for null delta', () => {
      expect(engine.computeDeltaScore({ delta: null }, defaultIntent)).toBe(0);
    });

    test('scales linearly between 0 and 1', () => {
      const score = engine.computeDeltaScore(
        { delta: 0.40 + 0.075 },
        defaultIntent
      );
      expect(score).toBeCloseTo(0.5, 2);
    });
  });

  // ─── DTE Score ───

  describe('computeDTEScore', () => {
    test('returns 1 for exact target DTE', () => {
      const score = engine.computeDTEScore({ dte: 21 }, defaultIntent);
      expect(score).toBe(1);
    });

    test('returns 0 for DTE at tolerance boundary', () => {
      const score = engine.computeDTEScore({ dte: 21 + 7 }, defaultIntent);
      expect(score).toBe(0);
    });

    test('returns 0.5 for DTE halfway to boundary', () => {
      const score = engine.computeDTEScore({ dte: 21 + 3.5 }, defaultIntent);
      expect(score).toBeCloseTo(0.5, 2);
    });
  });

  // ─── IV Context Score ───

  describe('computeIVContextScore', () => {
    test('returns 0.5 for UNKNOWN IV regime', () => {
      const ctx = { ...defaultMarketContext, ivRegime: IVRegime.UNKNOWN, ivPercentile: null };
      expect(engine.computeIVContextScore(ctx)).toBe(0.5);
    });

    test('returns IV percentile when known', () => {
      expect(engine.computeIVContextScore(defaultMarketContext)).toBe(0.55);
    });

    test('clamps percentile to 0-1 range', () => {
      const ctx = { ...defaultMarketContext, ivPercentile: 1.5 };
      expect(engine.computeIVContextScore(ctx)).toBe(1);
    });
  });

  // ─── Spread Math ───

  describe('computeSpreadRisk', () => {
    test('computes credit spread risk correctly', () => {
      const shortLeg: Partial<OptionCandidate> = { mid: 3.00, strike: 500 };
      const longLeg: Partial<OptionCandidate> = { mid: 1.50, strike: 505 };

      const risk = engine.computeSpreadRisk(
        shortLeg as OptionCandidate,
        longLeg as OptionCandidate
      );

      expect(risk.creditPerSpread).toBe(1.50);
      expect(risk.spreadWidthDollars).toBe(5);
      expect(risk.maxLossPerSpread).toBe(350); // (5 - 1.50) * 100
    });

    test('handles zero credit', () => {
      const shortLeg: Partial<OptionCandidate> = { mid: 1.50, strike: 500 };
      const longLeg: Partial<OptionCandidate> = { mid: 1.50, strike: 505 };

      const risk = engine.computeSpreadRisk(
        shortLeg as OptionCandidate,
        longLeg as OptionCandidate
      );

      expect(risk.creditPerSpread).toBe(0);
      expect(risk.maxLossPerSpread).toBe(500); // (5 - 0) * 100
    });

    test('handles negative credit (debit)', () => {
      const shortLeg: Partial<OptionCandidate> = { mid: 1.00, strike: 500 };
      const longLeg: Partial<OptionCandidate> = { mid: 2.00, strike: 505 };

      const risk = engine.computeSpreadRisk(
        shortLeg as OptionCandidate,
        longLeg as OptionCandidate
      );

      expect(risk.creditPerSpread).toBe(-1.00);
      expect(risk.maxLossPerSpread).toBe(600); // (5 - (-1)) * 100
    });
  });

  // ─── NaN Prevention ───

  describe('NaN prevention', () => {
    test('handles zero tolerance in delta score', () => {
      const intent = { ...defaultIntent, deltaTolerance: 0 };
      expect(engine.computeDeltaScore({ delta: 0.40 }, intent)).toBe(1);
      expect(engine.computeDeltaScore({ delta: 0.41 }, intent)).toBe(0);
    });

    test('handles zero tolerance in DTE score', () => {
      const intent = { ...defaultIntent, dteTolerance: 0 };
      expect(engine.computeDTEScore({ dte: 21 }, intent)).toBe(1);
      expect(engine.computeDTEScore({ dte: 22 }, intent)).toBe(0);
    });

    test('handles Infinity spreadWidthPct', () => {
      const score = engine.computeLiquidityScore(
        { volume: 1000, oi: 5000, spreadWidthPct: Infinity },
        { volumeMaxRefDefault: 5000, oiMaxRefDefault: 20000 }
      );
      expect(Number.isFinite(score)).toBe(true);
    });
  });

  // ─── Full Pipeline ───

  describe('construct (full pipeline)', () => {
    test('produces a TradePlan for single-leg intent with enough candidates', async () => {
      const contracts = makeContracts(5);
      const quotes = makeQuotes(contracts);

      mockGetOptionsChain.mockResolvedValue({
        underlying: 'SPY', contracts, fetchedAt: new Date(), fromCache: false,
      });
      mockGetOptionsSnapshot.mockResolvedValue({
        underlying: 'SPY', quotes, fetchedAt: new Date(), fromCache: false,
      });

      const result = await engine.construct(defaultIntent, defaultMarketContext);

      expect(result.success).toBe(true);
      expect(result.tradePlan).not.toBeNull();
      expect(result.tradePlan!.underlying).toBe('SPY');
      expect(result.tradePlan!.legs).toHaveLength(1);
      expect(result.tradePlan!.legs[0].legRole).toBe(LegRole.LONG);
      expect(result.tradePlan!.constructionVersion).toBe('1.0.0');
      expect(result.tradePlan!.constructionLatencyMs).toBeGreaterThanOrEqual(0);
    });

    test('rejects with INSUFFICIENT_CANDIDATES when < 3 pass', async () => {
      const contracts = makeContracts(2);
      const quotes = makeQuotes(contracts);

      mockGetOptionsChain.mockResolvedValue({
        underlying: 'SPY', contracts, fetchedAt: new Date(), fromCache: false,
      });
      mockGetOptionsSnapshot.mockResolvedValue({
        underlying: 'SPY', quotes, fetchedAt: new Date(), fromCache: false,
      });

      const result = await engine.construct(defaultIntent, defaultMarketContext);

      expect(result.success).toBe(false);
      expect(result.rejection!.rejectionCodes).toContain(RejectionCode.INSUFFICIENT_CANDIDATES);
    });

    test('rejects when underlying sanity fails', async () => {
      const contracts = makeContracts(5);
      const quotes = makeQuotes(contracts);

      mockGetOptionsChain.mockResolvedValue({
        underlying: 'SPY', contracts, fetchedAt: new Date(), fromCache: false,
      });
      mockGetOptionsSnapshot.mockResolvedValue({
        underlying: 'SPY', quotes, fetchedAt: new Date(), fromCache: false,
      });
      mockValidateUnderlying.mockReturnValue({ passed: false, rejectionCode: RejectionCode.UNDERLYING_PRICE_SANITY_FAILURE });

      const result = await engine.construct(defaultIntent, defaultMarketContext);

      expect(result.success).toBe(false);
      expect(result.rejection!.rejectionCodes).toContain(RejectionCode.UNDERLYING_PRICE_SANITY_FAILURE);
    });

    test('filters out candidates that fail data sanity', async () => {
      const contracts = makeContracts(5);
      const quotes = makeQuotes(contracts);

      mockGetOptionsChain.mockResolvedValue({
        underlying: 'SPY', contracts, fetchedAt: new Date(), fromCache: false,
      });
      mockGetOptionsSnapshot.mockResolvedValue({
        underlying: 'SPY', quotes, fetchedAt: new Date(), fromCache: false,
      });

      let callCount = 0;
      mockValidateCandidate.mockImplementation(() => {
        callCount++;
        // Fail first 3, pass last 2 — should result in < 3 viable
        return { passed: callCount > 3 };
      });

      const result = await engine.construct(defaultIntent, defaultMarketContext);

      expect(result.success).toBe(false);
      expect(result.rejection!.rejectionCodes).toContain(RejectionCode.INSUFFICIENT_CANDIDATES);
    });

    test('builds a credit spread plan for CREDIT_PUT_SPREAD', async () => {
      const today = new Date();
      const expDate = new Date(today);
      expDate.setDate(expDate.getDate() + 21);
      const expStr = expDate.toISOString().split('T')[0];

      const contracts = [
        { ticker: 'O:SPY_P495', underlying_ticker: 'SPY', contract_type: 'put', expiration_date: expStr, strike_price: 495 },
        { ticker: 'O:SPY_P493', underlying_ticker: 'SPY', contract_type: 'put', expiration_date: expStr, strike_price: 493 },
        { ticker: 'O:SPY_P490', underlying_ticker: 'SPY', contract_type: 'put', expiration_date: expStr, strike_price: 490 },
        { ticker: 'O:SPY_P488', underlying_ticker: 'SPY', contract_type: 'put', expiration_date: expStr, strike_price: 488 },
        { ticker: 'O:SPY_P485', underlying_ticker: 'SPY', contract_type: 'put', expiration_date: expStr, strike_price: 485 },
      ];

      // Tight bid-ask spreads and realistic pricing for a $5 wide credit put spread
      const quotes = [
        { optionTicker: 'O:SPY_P495', bid: 4.90, ask: 5.00, mid: 4.95, delta: -0.40, gamma: 0.03, theta: -0.05, vega: 0.12, iv: 0.25, volume: 3000, oi: 12000, greekSource: GreekSource.MASSIVE, quoteTimestamp: new Date(), underlyingPrice: 500, contractType: 'put', expirationDate: expStr, strikePrice: 495, underlyingTicker: 'SPY' },
        { optionTicker: 'O:SPY_P493', bid: 3.90, ask: 4.00, mid: 3.95, delta: -0.35, gamma: 0.028, theta: -0.045, vega: 0.11, iv: 0.245, volume: 2800, oi: 11000, greekSource: GreekSource.MASSIVE, quoteTimestamp: new Date(), underlyingPrice: 500, contractType: 'put', expirationDate: expStr, strikePrice: 493, underlyingTicker: 'SPY' },
        { optionTicker: 'O:SPY_P490', bid: 2.90, ask: 3.00, mid: 2.95, delta: -0.28, gamma: 0.025, theta: -0.04, vega: 0.10, iv: 0.24, volume: 2500, oi: 10000, greekSource: GreekSource.MASSIVE, quoteTimestamp: new Date(), underlyingPrice: 500, contractType: 'put', expirationDate: expStr, strikePrice: 490, underlyingTicker: 'SPY' },
        { optionTicker: 'O:SPY_P488', bid: 2.40, ask: 2.50, mid: 2.45, delta: -0.22, gamma: 0.02, theta: -0.035, vega: 0.08, iv: 0.235, volume: 2200, oi: 9500, greekSource: GreekSource.MASSIVE, quoteTimestamp: new Date(), underlyingPrice: 500, contractType: 'put', expirationDate: expStr, strikePrice: 488, underlyingTicker: 'SPY' },
        { optionTicker: 'O:SPY_P485', bid: 1.90, ask: 2.00, mid: 1.95, delta: -0.18, gamma: 0.015, theta: -0.03, vega: 0.06, iv: 0.23, volume: 2000, oi: 9000, greekSource: GreekSource.MASSIVE, quoteTimestamp: new Date(), underlyingPrice: 500, contractType: 'put', expirationDate: expStr, strikePrice: 485, underlyingTicker: 'SPY' },
      ];

      mockGetOptionsChain.mockResolvedValue({
        underlying: 'SPY', contracts, fetchedAt: new Date(), fromCache: false,
      });
      mockGetOptionsSnapshot.mockResolvedValue({
        underlying: 'SPY', quotes, fetchedAt: new Date(), fromCache: false,
      });

      const spreadIntent: TradeIntent = {
        ...defaultIntent,
        structure: TradeStructure.CREDIT_PUT_SPREAD,
        direction: TradeDirection.BULLISH,
        targetDelta: 0.40,
        deltaTolerance: 0.30,
      };

      const result = await engine.construct(spreadIntent, defaultMarketContext);

      expect(result.success).toBe(true);
      expect(result.tradePlan!.legs).toHaveLength(2);

      const shortLeg = result.tradePlan!.legs.find(l => l.legRole === LegRole.SHORT);
      const longLeg = result.tradePlan!.legs.find(l => l.legRole === LegRole.LONG);

      expect(shortLeg).toBeDefined();
      expect(longLeg).toBeDefined();
      expect(Math.abs(shortLeg!.delta)).toBeGreaterThan(Math.abs(longLeg!.delta));
      expect(result.tradePlan!.riskModel.creditPerSpread).toBeGreaterThan(0);
      expect(result.tradePlan!.riskModel.maxLossPerContract).toBeGreaterThan(0);
    });
  });

  // ─── Score Boundaries ───

  describe('score boundaries', () => {
    test('totalScore is always between 0 and 1', () => {
      const candidates: OptionCandidate[] = [
        {
          optionTicker: 'O:SPY_test', expiration: '2026-03-15', strike: 500,
          option_right: OptionRight.C, dte: 21, delta: 0.40, gamma: 0.03, vega: 0.12,
          iv: 0.25, greekSource: GreekSource.MASSIVE,
          bid: 4.50, ask: 4.70, mid: 4.60, volume: 2500, oi: 10000,
          spreadWidth: 0.20, spreadWidthPct: 0.04, liquidityScore: 0,
          quoteTimestamp: new Date(), deltaScore: 0, dteScore: 0,
          ivContextScore: 0, totalScore: 0, sanityCheckPassed: true,
        },
      ];

      engine.scoreCandidates(candidates, defaultIntent, defaultMarketContext);

      for (const c of candidates) {
        expect(c.totalScore).toBeGreaterThanOrEqual(0);
        expect(c.totalScore).toBeLessThanOrEqual(1);
        expect(Number.isFinite(c.totalScore)).toBe(true);
      }
    });
  });
});
