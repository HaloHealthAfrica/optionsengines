import {
  GovernorDecision,
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

import { PortfolioGovernor } from '../../engine/risk/PortfolioGovernor';
import type { PortfolioSnapshot } from '../../engine/risk/PortfolioGovernor';

describe('PortfolioGovernor', () => {
  let governor: PortfolioGovernor;

  const defaultPortfolioCfg = {
    maxNetDeltaPct: 0.15,
    maxShockLossPct: 0.75,
    maxUnderlyingRiskPct: 0.25,
    maxDTEConcentrationPct: 0.60,
    underlyingLiquidityFloorPct: 0.50,
    underlyingLiquidityRejectPct: 0.30,
    maxCorrelationBucketRiskPct: 0.40,
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
    underlyingPrice: 500,
    ivPercentile: 0.55,
    ivRegime: IVRegime.NEUTRAL,
    termShape: TermShape.CONTANGO,
    underlyingVolume: 50000000,
    avgVolume30D: 45000000,
  };

  function makePlan(overrides?: Partial<TradePlan>): TradePlan {
    return {
      tradePlanId: 'tp-1', accountId: 'acct-1', strategyTag: 'ORB',
      structure: TradeStructure.LONG_CALL, underlying: 'SPY', contracts: 1,
      legs: [{
        legRole: LegRole.LONG, optionTicker: 'O:SPY260315C00500000',
        expiration: '2026-03-15', strike: 500, option_right: OptionRight.C,
        dte: 21, delta: 0.10, gamma: 0.01, vega: 0.05, iv: 0.25,
        greekSource: GreekSource.MASSIVE, bid: 1.00, ask: 1.10, mid: 1.05,
        volume: 2500, oi: 10000, spreadWidth: 0.10, spreadWidthPct: 0.10,
        liquidityScore: 0.70, sanityCheckPassed: true, quoteTimestamp: new Date(),
      }],
      entryModel: { expectedPrice: 1.05, limitPrice: 1.10, maxRepricingAttempts: 3, repriceIntervalSeconds: 10 },
      exitModel: { profitTargetPct: 0.50, stopLossPct: 1.00, maxHoldDays: 20 },
      riskModel: { maxLossPerContract: 105, maxLossTotal: 105, creditPerSpread: 0, spreadWidthDollars: 0 },
      liquidityModel: { liquidityScore: 0.70, spreadWidthPct: 0.10, volumeNorm: 0.50, oiNorm: 0.50 },
      marketContext: defaultMarketContext,
      constructionVersion: '1.0.0', constructionLatencyMs: 50, createdAt: new Date(),
      ...overrides,
    };
  }

  function mockEmptyPortfolio(): void {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] }) // positions query
      .mockResolvedValueOnce({ rows: [{ total_equity: '99500' }] }); // account equity
  }

  beforeEach(() => {
    governor = new PortfolioGovernor();
    mockGetEngineConfig.mockReturnValue({ portfolio: defaultPortfolioCfg });
    mockDbQuery.mockReset();
  });

  // ─── Exposure Computation ───

  describe('computeProposedExposure', () => {
    test('computes delta and gamma for single long call', () => {
      const plan = makePlan({
        contracts: 2,
        legs: [{
          legRole: LegRole.LONG, optionTicker: 'O:SPY260315C00500000',
          expiration: '2026-03-15', strike: 500, option_right: OptionRight.C,
          dte: 21, delta: 0.45, gamma: 0.03, vega: 0.12, iv: 0.25,
          greekSource: GreekSource.MASSIVE, bid: 4.50, ask: 4.70, mid: 4.60,
          volume: 2500, oi: 10000, spreadWidth: 0.20, spreadWidthPct: 0.04,
          liquidityScore: 0.70, sanityCheckPassed: true, quoteTimestamp: new Date(),
        }],
      });
      const exposure = governor.computeProposedExposure(plan, 500);

      // delta * contracts * 100 * underlyingPrice
      // 0.45 * 2 * 100 = 90 deltas, * 500 = 45000
      expect(exposure.deltaExposureDollars).toBe(45000);
      // gamma * contracts * 100 = 0.03 * 2 * 100 = 6
      expect(exposure.gammaExposure).toBe(6);
    });

    test('computes net exposure for credit spread (short + long)', () => {
      const plan = makePlan({
        contracts: 2,
        structure: TradeStructure.CREDIT_PUT_SPREAD,
        legs: [
          {
            legRole: LegRole.SHORT, optionTicker: 'O:SPY_P495',
            expiration: '2026-03-15', strike: 495, option_right: OptionRight.P,
            dte: 21, delta: -0.40, gamma: 0.03, vega: 0.12, iv: 0.25,
            greekSource: GreekSource.MASSIVE, bid: 4.90, ask: 5.00, mid: 4.95,
            volume: 3000, oi: 12000, spreadWidth: 0.10, spreadWidthPct: 0.02,
            liquidityScore: 0.80, sanityCheckPassed: true, quoteTimestamp: new Date(),
          },
          {
            legRole: LegRole.LONG, optionTicker: 'O:SPY_P490',
            expiration: '2026-03-15', strike: 490, option_right: OptionRight.P,
            dte: 21, delta: -0.28, gamma: 0.025, vega: 0.10, iv: 0.24,
            greekSource: GreekSource.MASSIVE, bid: 2.90, ask: 3.00, mid: 2.95,
            volume: 2500, oi: 10000, spreadWidth: 0.10, spreadWidthPct: 0.03,
            liquidityScore: 0.75, sanityCheckPassed: true, quoteTimestamp: new Date(),
          },
        ],
      });

      const exposure = governor.computeProposedExposure(plan, 500);

      // Short leg: -1 * (-0.40) * 2 * 100 = 80
      // Long leg:  +1 * (-0.28) * 2 * 100 = -56
      // Net delta = 80 + (-56) = 24, * 500 = 12000
      expect(exposure.deltaExposureDollars).toBeCloseTo(12000, -1);
    });
  });

  // ─── Shock Simulation ───

  describe('simulateShock', () => {
    test('computes worst-case shock loss', () => {
      const snapshot: PortfolioSnapshot = {
        positions: [], totalEquity: 100000,
        netDeltaDollars: 10000, netGamma: 5,
        totalMaxLoss: 5000, dteConcentration: new Map(),
        underlyingConcentration: new Map(), bucketUsage: new Map(),
      };
      const proposed = { deltaExposureDollars: 5000, gammaExposure: 2 };

      const shockLoss = governor.simulateShock(snapshot, proposed, 500);

      // totalDelta = 15000, totalGamma = 7, priceMove = 10
      // pnlUp = 15000 * 0.02 + 0.5 * 7 * 100 = 300 + 350 = 650
      // pnlDown = -15000 * 0.02 + 0.5 * 7 * 100 = -300 + 350 = 50
      // worst = min(650, 50) = 50 (positive, no loss)
      expect(shockLoss).toBe(50);
    });

    test('negative shock loss means portfolio loses money', () => {
      const snapshot: PortfolioSnapshot = {
        positions: [], totalEquity: 100000,
        netDeltaDollars: 50000, netGamma: -10,
        totalMaxLoss: 10000, dteConcentration: new Map(),
        underlyingConcentration: new Map(), bucketUsage: new Map(),
      };
      const proposed = { deltaExposureDollars: 0, gammaExposure: 0 };

      const shockLoss = governor.simulateShock(snapshot, proposed, 500);

      // totalDelta = 50000, totalGamma = -10, priceMove = 10
      // pnlUp = 50000*0.02 + 0.5*(-10)*100 = 1000 - 500 = 500
      // pnlDown = -50000*0.02 + 0.5*(-10)*100 = -1000 - 500 = -1500
      // worst = -1500
      expect(shockLoss).toBe(-1500);
    });
  });

  // ─── Full Evaluation ───

  describe('evaluate', () => {
    test('APPROVE when all checks pass', async () => {
      mockEmptyPortfolio();
      const plan = makePlan();

      const result = await governor.evaluate(plan, defaultAccount, defaultMarketContext);

      expect(result.decision).toBe(GovernorDecision.APPROVE);
      expect(result.sizeMultiplier).toBe(1.0);
      expect(result.reasonCodes).toContain('ALL_CHECKS_PASSED');
    });

    test('REJECT when net delta exceeded by large margin', async () => {
      mockEmptyPortfolio();
      const plan = makePlan({
        contracts: 100,
        riskModel: { maxLossPerContract: 460, maxLossTotal: 46000, creditPerSpread: 0, spreadWidthDollars: 0 },
      });

      const result = await governor.evaluate(plan, defaultAccount, defaultMarketContext);

      // 100 contracts * 0.45 * 100 * 500 = $2,250,000 delta exposure
      // cap = 99500 * 0.15 = $14,925
      // ratio = 14925/2250000 ≈ 0.006 < 0.5 → REJECT
      expect(result.decision).toBe(GovernorDecision.REJECT);
      expect(result.reasonCodes).toContain('NET_DELTA_EXCEEDED');
    });

    test('RESIZE when delta slightly exceeds cap', async () => {
      mockEmptyPortfolio();
      // Carefully sized to slightly exceed delta cap
      // cap = 99500 * 0.15 = 14925
      // 4 contracts * 0.45 * 100 * 500 = 90000 → too big, will REJECT
      // Need ratio > 0.5 → deltaExposure < 2*cap = 29850
      // 0.45 * n * 100 * 500 < 29850 → n < 1.33 → not useful for test
      // Use smaller delta instead
      const plan = makePlan({
        contracts: 2,
        legs: [{
          legRole: LegRole.LONG, optionTicker: 'O:SPY',
          expiration: '2026-03-15', strike: 500, option_right: OptionRight.C,
          dte: 21, delta: 0.20, gamma: 0.03, vega: 0.12, iv: 0.25,
          greekSource: GreekSource.MASSIVE, bid: 2.00, ask: 2.20, mid: 2.10,
          volume: 2500, oi: 10000, spreadWidth: 0.20, spreadWidthPct: 0.10,
          liquidityScore: 0.70, sanityCheckPassed: true, quoteTimestamp: new Date(),
        }],
      });

      // delta exposure = 0.20 * 2 * 100 * 500 = 20000
      // cap = 14925, ratio = 14925/20000 = 0.746 > 0.5 → RESIZE
      const result = await governor.evaluate(plan, defaultAccount, defaultMarketContext);

      expect(result.decision).toBe(GovernorDecision.RESIZE);
      expect(result.sizeMultiplier).toBeLessThan(1.0);
      expect(result.reasonCodes).toContain('NET_DELTA_RESIZED');
    });

    test('REJECT when underlying concentration exceeded', async () => {
      // Mock a portfolio with existing SPY positions using up most of the underlying cap
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{
            position_id: 'pos-existing', trade_plan_id: 'tp-old',
            underlying: 'SPY', strategy_tag: 'ORB', contracts: '10',
            entry_avg_price: '5.00', state: 'OPEN', entry_filled_qty: 10,
          }],
        })
        .mockResolvedValueOnce({ rows: [] }) // trade plan legs for existing
        .mockResolvedValueOnce({ rows: [{ total_equity: '99500' }] });

      // Small delta so delta check passes, but huge maxLossTotal to exceed underlying concentration
      const plan = makePlan({
        riskModel: { maxLossPerContract: 25000, maxLossTotal: 25000, creditPerSpread: 0, spreadWidthDollars: 0 },
      });

      // underlyingCap = 99500 * 0.25 = 24875
      // existing SPY risk ≈ 5 * 10 * 100 = 5000
      // proposed = 25000 → total = 30000 > 24875 → REJECT
      const result = await governor.evaluate(plan, defaultAccount, defaultMarketContext);

      expect(result.decision).toBe(GovernorDecision.REJECT);
      expect(result.reasonCodes).toContain('UNDERLYING_CONCENTRATION_EXCEEDED');
    });

    test('REJECT when underlying is illiquid', async () => {
      mockEmptyPortfolio();
      const illiquidContext = {
        ...defaultMarketContext,
        underlyingVolume: 10000000,
        avgVolume30D: 45000000, // ratio = 0.22 < 0.30 → REJECT
      };

      const result = await governor.evaluate(makePlan(), defaultAccount, illiquidContext);

      expect(result.decision).toBe(GovernorDecision.REJECT);
      expect(result.reasonCodes).toContain('UNDERLYING_ILLIQUID_REJECT');
    });

    test('RESIZE when underlying is moderately illiquid', async () => {
      mockEmptyPortfolio();
      const modIlliquidContext = {
        ...defaultMarketContext,
        underlyingVolume: 18000000,
        avgVolume30D: 45000000, // ratio = 0.40 → below 0.50 floor but above 0.30 reject
      };

      const result = await governor.evaluate(makePlan(), defaultAccount, modIlliquidContext);

      expect(result.decision).toBe(GovernorDecision.RESIZE);
      expect(result.reasonCodes).toContain('UNDERLYING_ILLIQUID_RESIZE');
      expect(result.sizeMultiplier).toBeLessThanOrEqual(0.5);
    });

    test('REJECT when correlation bucket exceeded', async () => {
      mockEmptyPortfolio();
      const buckets = new Map([
        ['B1', ['SPY', 'QQQ', 'IWM']],
      ]);

      // Small delta so delta check passes, but large risk for bucket check
      const plan = makePlan({
        riskModel: { maxLossPerContract: 5000, maxLossTotal: 5000, creditPerSpread: 0, spreadWidthDollars: 0 },
      });

      const result = await governor.evaluate(plan, defaultAccount, defaultMarketContext, buckets);

      // bucketRisk = 5000, totalRisk = 5000, bucketRiskPct = 1.0 > 0.40
      expect(result.decision).toBe(GovernorDecision.REJECT);
      expect(result.reasonCodes).toContain('CORRELATION_BUCKET_EXCEEDED');
    });
  });
});
