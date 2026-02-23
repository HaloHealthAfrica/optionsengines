import {
  RejectionCode,
  TradeStructure,
  LegRole,
  OptionRight,
  GreekSource,
  IVRegime,
  TermShape,
} from '../../engine/types/enums';
import type { TradePlan, TradingAccount, MarketContext } from '../../engine/types/index';

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../config/index', () => ({
  config: { logLevel: 'info', databaseUrl: '', dbPoolMax: 5, slowRequestMs: 1000 },
}));

const mockGetEngineConfig = jest.fn();
jest.mock('../../engine/config/loader', () => ({
  getEngineConfig: () => mockGetEngineConfig(),
}));

const mockDbQuery = jest.fn();
jest.mock('../../services/database.service', () => ({
  db: { query: (...args: any[]) => mockDbQuery(...args) },
}));

import { CapitalAllocator } from '../../engine/risk/CapitalAllocator';

describe('CapitalAllocator', () => {
  let allocator: CapitalAllocator;

  const defaultConfig = {
    buckets: { ORB: 0.30, GEX: 0.30, Spread: 0.30, Experimental: 0.10 },
    tapering: {
      level1DrawdownPct: 0.50,
      level1SizeMultiplier: 0.50,
      level2DrawdownPct: 0.80,
      level2FreezeEntries: true,
    },
  };

  const defaultAccount: TradingAccount = {
    id: 'acct-1', name: 'Test', initialCapital: 100000,
    currentCash: 95000, reservedCapital: 5000,
    realizedPnL: 0, unrealizedPnL: -500, totalEquity: 99500,
    maxDailyLoss: 2000, maxPortfolioRisk: 10000,
    peakEquity: 100000, intradayRealizedPnL: 0, intradayStartEquity: 100000,
    entryFrozen: false, brokerSyncWarning: false, brokerSyncFrozen: false,
    brokerSyncedAt: null, createdAt: new Date(),
  };

  const defaultMarketContext: MarketContext = {
    underlyingPrice: 500, ivPercentile: 0.55, ivRegime: IVRegime.NEUTRAL,
    termShape: TermShape.CONTANGO, underlyingVolume: 50000000, avgVolume30D: 45000000,
  };

  function makePlan(strategyTag: string = 'ORB', maxLossTotal: number = 920): TradePlan {
    return {
      tradePlanId: 'tp-1', accountId: 'acct-1', strategyTag,
      structure: TradeStructure.LONG_CALL, underlying: 'SPY', contracts: 2,
      legs: [{
        legRole: LegRole.LONG, optionTicker: 'O:SPY260315C00500000',
        expiration: '2026-03-15', strike: 500, option_right: OptionRight.C,
        dte: 21, delta: 0.45, gamma: 0.03, vega: 0.12, iv: 0.25,
        greekSource: GreekSource.MASSIVE, bid: 4.50, ask: 4.70, mid: 4.60,
        volume: 2500, oi: 10000, spreadWidth: 0.20, spreadWidthPct: 0.04,
        liquidityScore: 0.70, sanityCheckPassed: true, quoteTimestamp: new Date(),
      }],
      entryModel: { expectedPrice: 4.60, limitPrice: 4.70, maxRepricingAttempts: 3, repriceIntervalSeconds: 10 },
      exitModel: { profitTargetPct: 0.50, stopLossPct: 1.00, maxHoldDays: 20 },
      riskModel: { maxLossPerContract: 460, maxLossTotal, creditPerSpread: 0, spreadWidthDollars: 0 },
      liquidityModel: { liquidityScore: 0.70, spreadWidthPct: 0.04, volumeNorm: 0.50, oiNorm: 0.50 },
      marketContext: defaultMarketContext,
      constructionVersion: '1.0.0', constructionLatencyMs: 50, createdAt: new Date(),
    };
  }

  beforeEach(() => {
    allocator = new CapitalAllocator();
    mockGetEngineConfig.mockReturnValue(defaultConfig);
    mockDbQuery.mockReset();
  });

  // ─── Strategy → Bucket Mapping ───

  describe('mapStrategyToBucket', () => {
    test('maps ORB strategy to ORB bucket', () => {
      expect(allocator.mapStrategyToBucket('ORB')).toBe('ORB');
      expect(allocator.mapStrategyToBucket('ORB_BULLISH')).toBe('ORB');
    });

    test('maps GEX strategy to GEX bucket', () => {
      expect(allocator.mapStrategyToBucket('GEX')).toBe('GEX');
      expect(allocator.mapStrategyToBucket('GEX_FLOW')).toBe('GEX');
    });

    test('maps SPREAD strategy to Spread bucket', () => {
      expect(allocator.mapStrategyToBucket('CREDIT_SPREAD')).toBe('Spread');
      expect(allocator.mapStrategyToBucket('SPREAD_V2')).toBe('Spread');
    });

    test('maps unknown strategies to Experimental', () => {
      expect(allocator.mapStrategyToBucket('NEW_ALGO')).toBe('Experimental');
      expect(allocator.mapStrategyToBucket('test')).toBe('Experimental');
    });
  });

  // ─── Drawdown ───

  describe('computeDrawdownPct', () => {
    test('returns 0 when at peak', () => {
      expect(allocator.computeDrawdownPct(defaultAccount)).toBeCloseTo(0.005, 3);
    });

    test('returns correct drawdown pct', () => {
      const account = { ...defaultAccount, totalEquity: 80000, peakEquity: 100000 };
      expect(allocator.computeDrawdownPct(account)).toBeCloseTo(0.20, 3);
    });

    test('returns 0 when peakEquity is 0', () => {
      const account = { ...defaultAccount, peakEquity: 0 };
      expect(allocator.computeDrawdownPct(account)).toBe(0);
    });
  });

  // ─── Full Evaluation ───

  describe('evaluate', () => {
    test('allows trade when bucket has capacity', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // no existing positions

      const result = await allocator.evaluate(makePlan(), defaultAccount);

      expect(result.allowed).toBe(true);
      expect(result.allocatedBucket).toBe('ORB');
      expect(result.sizeMultiplier).toBe(1.0);
      expect(result.taperingLevel).toBe(0);
      // capacity = 99500 * 0.30 = 29850
      expect(result.bucketCapacity).toBeCloseTo(29850, 0);
    });

    test('rejects when bucket is exhausted', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{ strategy_tag: 'ORB', total_risk: '29000' }],
      });

      const result = await allocator.evaluate(makePlan('ORB', 1000), defaultAccount);

      // capacity = 29850, used = 29000, proposed = 1000 → 30000 > 29850
      expect(result.allowed).toBe(false);
      expect(result.rejectionCode).toBe(RejectionCode.BUCKET_EXHAUSTED);
    });

    test('applies Level 1 tapering at 50% drawdown', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const account = { ...defaultAccount, totalEquity: 50000, peakEquity: 100000 };
      const result = await allocator.evaluate(makePlan(), account);

      expect(result.allowed).toBe(true);
      expect(result.taperingLevel).toBe(1);
      expect(result.sizeMultiplier).toBe(0.50);
    });

    test('freezes entries at Level 2 tapering (80% drawdown)', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const account = { ...defaultAccount, totalEquity: 20000, peakEquity: 100000 };
      const result = await allocator.evaluate(makePlan(), account);

      expect(result.allowed).toBe(false);
      expect(result.rejectionCode).toBe(RejectionCode.INSUFFICIENT_CAPITAL);
      expect(result.taperingLevel).toBe(2);
    });

    test('maps CREDIT strategy to Spread bucket', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const result = await allocator.evaluate(makePlan('CREDIT_PUT'), defaultAccount);

      expect(result.allowed).toBe(true);
      expect(result.allocatedBucket).toBe('Spread');
    });

    test('rejects unknown bucket with no allocation', async () => {
      mockGetEngineConfig.mockReturnValue({
        ...defaultConfig,
        buckets: { ORB: 0.50, GEX: 0.50 },
      });
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const result = await allocator.evaluate(makePlan('NEW_ALGO'), defaultAccount);

      // Experimental bucket has no allocation → BUCKET_EXHAUSTED
      expect(result.allowed).toBe(false);
      expect(result.rejectionCode).toBe(RejectionCode.BUCKET_EXHAUSTED);
    });
  });

  // ─── Bucket Statuses ───

  describe('getBucketStatuses', () => {
    test('returns all bucket statuses with usage', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          { strategy_tag: 'ORB', total_risk: '10000' },
          { strategy_tag: 'GEX_FLOW', total_risk: '5000' },
        ],
      });

      const statuses = await allocator.getBucketStatuses('acct-1', 100000);

      expect(statuses).toHaveLength(4);

      const orbStatus = statuses.find(s => s.bucket === 'ORB');
      expect(orbStatus!.usedRisk).toBe(10000);
      expect(orbStatus!.capacityRisk).toBe(30000);
      expect(orbStatus!.usagePct).toBeCloseTo(0.333, 2);
      expect(orbStatus!.remaining).toBe(20000);

      const gexStatus = statuses.find(s => s.bucket === 'GEX');
      expect(gexStatus!.usedRisk).toBe(5000);
    });

    test('returns zero usage when no positions', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const statuses = await allocator.getBucketStatuses('acct-1', 100000);

      for (const s of statuses) {
        expect(s.usedRisk).toBe(0);
        expect(s.usagePct).toBe(0);
      }
    });
  });
});
