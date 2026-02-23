import { FillStatus, GreekSource, TradeStructure, LegRole, OptionRight, IVRegime, TermShape } from '../../engine/types/enums';
import type { TradePlan } from '../../engine/types/index';

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

const mockDbQuery = jest.fn();
jest.mock('../../services/database.service', () => ({
  db: {
    query: (...args: any[]) => mockDbQuery(...args),
  },
}));

const mockGetContractSnapshot = jest.fn();
const mockIsQuoteStale = jest.fn();
jest.mock('../../engine/data/MassiveOptionsService', () => ({
  massiveOptionsService: {
    getContractSnapshot: (...args: any[]) => mockGetContractSnapshot(...args),
    isQuoteStale: (...args: any[]) => mockIsQuoteStale(...args),
  },
}));
jest.mock('../../services/redis-cache.service', () => ({
  redisCache: { get: jest.fn(), set: jest.fn() },
}));

import { LiquiditySlippageService } from '../../engine/construction/LiquiditySlippageService';

describe('LiquiditySlippageService', () => {
  let service: LiquiditySlippageService;

  const defaultSlippageConfig = {
    repriceAttempts: 3,
    repriceIntervalSeconds: 10,
    repriceSpreadImprovement: [0.10, 0.20],
    fillTimeoutSeconds: 30,
    maxMidMovement15s: 0.10,
    maxUnderlyingMovement15s: 0.005,
  };

  beforeEach(() => {
    service = new LiquiditySlippageService();
    mockGetEngineConfig.mockReturnValue({ slippage: defaultSlippageConfig });
    mockDbQuery.mockReset();
    mockGetContractSnapshot.mockReset();
    mockIsQuoteStale.mockReset();
  });

  // ─── Quote Instability ───

  describe('checkQuoteInstability', () => {
    test('stable when no movement', () => {
      const result = service.checkQuoteInstability(4.60, 4.60, 500, 500);
      expect(result.stable).toBe(true);
      expect(result.midMovement).toBe(0);
    });

    test('unstable when mid moves > 10%', () => {
      const result = service.checkQuoteInstability(5.20, 4.60, 500, 500);
      expect(result.stable).toBe(false);
      expect(result.reason).toContain('Option mid moved');
    });

    test('unstable when underlying moves > 0.5%', () => {
      const result = service.checkQuoteInstability(4.60, 4.60, 504, 500);
      expect(result.stable).toBe(false);
      expect(result.reason).toContain('Underlying moved');
    });

    test('stable for small movements within thresholds', () => {
      const result = service.checkQuoteInstability(4.64, 4.60, 500.5, 500);
      expect(result.stable).toBe(true);
    });

    test('handles zero reference mid gracefully', () => {
      const result = service.checkQuoteInstability(4.60, 0, 500, 500);
      expect(result.stable).toBe(true);
      expect(result.midMovement).toBe(0);
    });
  });

  // ─── Reprice Ladder ───

  describe('buildRepriceLadder', () => {
    test('builds SELL ladder (conceding toward bid)', () => {
      const ladder = service.buildRepriceLadder(4.60, 4.50, 4.70, 'SELL');

      expect(ladder).toHaveLength(3);
      // attempt 1: 0% improvement → at mid
      expect(ladder[0]).toBe(4.60);
      // attempt 2: 10% of spread toward bid
      expect(ladder[1]).toBe(4.58);
      // attempt 3: 20% of spread toward bid
      expect(ladder[2]).toBe(4.56);
    });

    test('builds BUY ladder (conceding toward ask)', () => {
      const ladder = service.buildRepriceLadder(4.60, 4.50, 4.70, 'BUY');

      expect(ladder).toHaveLength(3);
      expect(ladder[0]).toBe(4.60);
      expect(ladder[1]).toBe(4.62);
      expect(ladder[2]).toBe(4.64);
    });

    test('SELL never goes below bid', () => {
      const ladder = service.buildRepriceLadder(4.52, 4.50, 4.70, 'SELL');
      for (const price of ladder) {
        expect(price).toBeGreaterThanOrEqual(4.50);
      }
    });

    test('BUY never goes above ask', () => {
      const ladder = service.buildRepriceLadder(4.68, 4.50, 4.70, 'BUY');
      for (const price of ladder) {
        expect(price).toBeLessThanOrEqual(4.70);
      }
    });
  });

  // ─── Executable Exit Prices ───

  describe('getExecutableExitPrice', () => {
    test('SELL_TO_CLOSE uses bid', () => {
      expect(service.getExecutableExitPrice(4.50, 4.70, 'SELL_TO_CLOSE')).toBe(4.50);
    });

    test('BUY_TO_CLOSE uses ask', () => {
      expect(service.getExecutableExitPrice(4.50, 4.70, 'BUY_TO_CLOSE')).toBe(4.70);
    });
  });

  // ─── DTE Validation ───

  describe('validateDTERange', () => {
    function makePlan(dte: number): TradePlan {
      return {
        tradePlanId: 'tp-1', accountId: 'acct-1', strategyTag: 'ORB',
        structure: TradeStructure.LONG_CALL, underlying: 'SPY', contracts: 1,
        legs: [{
          legRole: LegRole.LONG, optionTicker: 'O:SPY', expiration: '2026-03-15',
          strike: 500, right: OptionRight.C, dte, delta: 0.40, gamma: 0.03,
          vega: 0.12, iv: 0.25, greekSource: GreekSource.MASSIVE,
          bid: 4.50, ask: 4.70, mid: 4.60, volume: 1500, oi: 8000,
          spreadWidth: 0.20, spreadWidthPct: 0.04, liquidityScore: 0.70,
          sanityCheckPassed: true, quoteTimestamp: new Date(),
        }],
        entryModel: { expectedPrice: 4.60, limitPrice: 4.70, maxRepricingAttempts: 3, repriceIntervalSeconds: 10 },
        exitModel: { profitTargetPct: 0.50, stopLossPct: 1.00, maxHoldDays: 20 },
        riskModel: { maxLossPerContract: 460, maxLossTotal: 460, creditPerSpread: 0, spreadWidthDollars: 0 },
        liquidityModel: { liquidityScore: 0.70, spreadWidthPct: 0.04, volumeNorm: 0.30, oiNorm: 0.40 },
        marketContext: { underlyingPrice: 500, ivPercentile: 0.55, ivRegime: IVRegime.NEUTRAL, termShape: TermShape.CONTANGO, underlyingVolume: 50000000, avgVolume30D: 45000000 },
        constructionVersion: '1.0.0', constructionLatencyMs: 50, createdAt: new Date(),
      };
    }

    test('valid for DTE 21', () => {
      expect(service.validateDTERange(makePlan(21)).valid).toBe(true);
    });

    test('invalid for DTE < 7', () => {
      const result = service.validateDTERange(makePlan(5));
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('below minimum 7');
    });

    test('invalid for DTE > 30', () => {
      const result = service.validateDTERange(makePlan(45));
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('exceeds maximum 30');
    });

    test('valid at boundary DTE 7', () => {
      expect(service.validateDTERange(makePlan(7)).valid).toBe(true);
    });

    test('valid at boundary DTE 30', () => {
      expect(service.validateDTERange(makePlan(30)).valid).toBe(true);
    });
  });

  // ─── Slippage Audit Write ───

  describe('writeSlippageAudit', () => {
    test('writes audit row and returns record', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [] }) // idempotency check
        .mockResolvedValueOnce({ rows: [] }); // insert

      const audit = await service.writeSlippageAudit({
        tradeId: 'trade-1',
        accountId: 'acct-1',
        positionId: 'pos-1',
        optionTicker: 'O:SPY260315C00500000',
        expectedPrice: 4.60,
        submittedLimitPrice: 4.65,
        fillPrice: 4.63,
        spreadWidthPctAtSubmit: 0.04,
        liquidityScoreAtSubmit: 0.70,
        underlyingPriceAtSubmit: 500,
        secondsToFill: 5,
        repriceCount: 0,
        fillStatus: FillStatus.FILLED,
        idempotencyKey: 'idem-1',
      });

      expect(audit.slippageDollars).toBeCloseTo(0.03, 2);
      expect(audit.slippagePct).toBeCloseTo(0.03 / 4.60, 4);
      expect(audit.fillStatus).toBe(FillStatus.FILLED);
      expect(mockDbQuery).toHaveBeenCalledTimes(2);
    });

    test('returns existing record on idempotent duplicate', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'existing-id' }] }) // idempotency check
        .mockResolvedValueOnce({
          rows: [{
            id: 'existing-id', trade_id: 'trade-1', account_id: 'acct-1',
            position_id: 'pos-1', option_ticker: 'O:SPY', expected_price: '4.60',
            submitted_limit_price: '4.65', fill_price: '4.63',
            slippage_dollars: '0.03', slippage_pct: '0.0065',
            spread_width_pct_at_submit: '0.04', liquidity_score_at_submit: '0.70',
            underlying_price_at_submit: '500', seconds_to_fill: '5',
            reprice_count: '0', fill_status: 'FILLED', created_at: new Date().toISOString(),
            idempotency_key: 'idem-1',
          }],
        });

      const audit = await service.writeSlippageAudit({
        tradeId: 'trade-1',
        accountId: 'acct-1',
        positionId: 'pos-1',
        optionTicker: 'O:SPY',
        expectedPrice: 4.60,
        submittedLimitPrice: 4.65,
        fillPrice: 4.63,
        spreadWidthPctAtSubmit: 0.04,
        liquidityScoreAtSubmit: 0.70,
        underlyingPriceAtSubmit: 500,
        secondsToFill: 5,
        repriceCount: 0,
        fillStatus: FillStatus.FILLED,
        idempotencyKey: 'idem-1',
      });

      expect(audit.id).toBe('existing-id');
    });

    test('handles null fill price (timeout)', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [] }) // idempotency check
        .mockResolvedValueOnce({ rows: [] }); // insert

      const audit = await service.writeSlippageAudit({
        tradeId: 'trade-1',
        accountId: 'acct-1',
        positionId: 'pos-1',
        optionTicker: 'O:SPY',
        expectedPrice: 4.60,
        submittedLimitPrice: 4.65,
        fillPrice: null,
        spreadWidthPctAtSubmit: 0.04,
        liquidityScoreAtSubmit: 0.70,
        underlyingPriceAtSubmit: 500,
        secondsToFill: null,
        repriceCount: 2,
        fillStatus: FillStatus.TIMEOUT,
        idempotencyKey: 'idem-2',
      });

      expect(audit.slippageDollars).toBe(0);
      expect(audit.slippagePct).toBe(0);
      expect(audit.fillStatus).toBe(FillStatus.TIMEOUT);
    });
  });

  // ─── Quote Revalidation ───

  describe('revalidateQuoteAtSubmission', () => {
    test('returns fresh=true when quote is not stale', async () => {
      mockGetContractSnapshot.mockResolvedValue({
        bid: 4.50, ask: 4.70, mid: 4.60, quoteTimestamp: new Date(),
      });
      mockIsQuoteStale.mockReturnValue(false);

      const result = await service.revalidateQuoteAtSubmission('O:SPY260315C00500000');

      expect(result.fresh).toBe(true);
      expect(result.currentMid).toBe(4.60);
    });

    test('returns fresh=false when quote is stale', async () => {
      mockGetContractSnapshot.mockResolvedValue({
        bid: 4.50, ask: 4.70, mid: 4.60, quoteTimestamp: new Date(Date.now() - 60000),
      });
      mockIsQuoteStale.mockReturnValue(true);

      const result = await service.revalidateQuoteAtSubmission('O:SPY260315C00500000');

      expect(result.fresh).toBe(false);
    });

    test('returns fresh=false on snapshot fetch error', async () => {
      mockGetContractSnapshot.mockRejectedValue(new Error('Network error'));

      const result = await service.revalidateQuoteAtSubmission('O:SPY_BAD');

      expect(result.fresh).toBe(false);
      expect(result.currentBid).toBe(0);
    });
  });
});
