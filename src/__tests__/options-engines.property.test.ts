import fc from 'fast-check';
import { evaluateEntryDecision } from '../lib/entryEngine/index.js';
import { selectStrike } from '../lib/strikeSelection/index.js';
import { evaluateExitDecision } from '../lib/exitEngine/index.js';
import type { EntryDecisionInput } from '../lib/entryEngine/types.js';
import type { StrikeSelectionInput } from '../lib/strikeSelection/types.js';
import type { ExitDecisionInput } from '../lib/exitEngine/types.js';
import { DTE_POLICY, ENTRY_MIN_CONFIDENCE } from '../lib/shared/constants.js';
import type { GEXState, RegimeType, SetupType } from '../lib/shared/types.js';

const setupTypeArb = fc.constantFrom<SetupType>('SCALP_GUARDED', 'SWING', 'POSITION', 'LEAPS');
const regimeArb = fc.constantFrom<RegimeType>(
  'STRONG_BULL',
  'BULL',
  'NEUTRAL',
  'BEAR',
  'STRONG_BEAR',
  'CHOPPY',
  'BREAKOUT',
  'BREAKDOWN'
);
const gexArb = fc.constantFrom<GEXState>('POSITIVE_HIGH', 'POSITIVE_LOW', 'NEUTRAL', 'NEGATIVE_LOW', 'NEGATIVE_HIGH');
const liquidityArb = fc.constantFrom('HIGH', 'NORMAL', 'LOW', 'ILLIQUID');
const sessionArb = fc.constantFrom('PRE_MARKET', 'OPEN', 'MORNING', 'LUNCH', 'AFTERNOON', 'CLOSE', 'AFTER_HOURS');
const finiteDouble = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

const entryInputArb = fc.record({
  symbol: fc.stringOf(fc.constantFrom('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'), {
    minLength: 1,
    maxLength: 5,
  }),
  timestamp: fc.integer({ min: 1600000000000, max: 1900000000000 }),
  direction: fc.constantFrom('CALL', 'PUT'),
  setupType: setupTypeArb,
  signal: fc.record({
    confidence: fc.integer({ min: 0, max: 100 }),
    pattern: fc.constantFrom('BREAKOUT', 'PULLBACK', 'REVERSAL', 'CONTINUATION'),
    timeframe: fc.constantFrom('1m', '5m', '15m', '1h', '4h', 'D'),
    confirmationPending: fc.boolean(),
  }),
  marketContext: fc.record({
    price: finiteDouble(10, 1000),
    regime: regimeArb,
    gexState: gexArb,
    volatility: finiteDouble(0, 2),
    ivPercentile: fc.integer({ min: 0, max: 100 }),
  }),
  timingContext: fc.record({
    session: sessionArb,
    minutesFromOpen: fc.integer({ min: 0, max: 390 }),
    liquidityState: liquidityArb,
  }),
  riskContext: fc.record({
    dailyPnL: finiteDouble(-2000, 2000),
    openTradesCount: fc.integer({ min: 0, max: 20 }),
    portfolioDelta: finiteDouble(-1000, 1000),
    portfolioTheta: finiteDouble(-500, 500),
  }),
});

const optionContractArb = fc.record({
  expiry: fc.date({ min: new Date('2025-01-01'), max: new Date('2027-01-01') }).map((d) => d.toISOString()),
  dte: fc.integer({ min: 1, max: 720 }),
  strike: finiteDouble(50, 600),
  bid: finiteDouble(0.01, 50),
  ask: finiteDouble(0.02, 50),
  mid: finiteDouble(0.02, 50),
  openInterest: fc.integer({ min: 0, max: 5000 }),
  volume: fc.integer({ min: 0, max: 5000 }),
  greeks: fc.record({
    delta: finiteDouble(-1, 1),
    gamma: finiteDouble(0, 0.2),
    theta: finiteDouble(-1, 0),
    vega: finiteDouble(0, 1),
  }),
  iv: finiteDouble(0.05, 3),
});

const strikeInputArb: fc.Arbitrary<StrikeSelectionInput> = fc.record({
  symbol: fc.stringOf(fc.constantFrom('S', 'P', 'Y', 'Q', 'Q', 'Q'), { minLength: 1, maxLength: 4 }),
  spotPrice: finiteDouble(50, 800),
  direction: fc.constantFrom('CALL', 'PUT'),
  setupType: setupTypeArb,
  signalConfidence: fc.integer({ min: 0, max: 100 }),
  expectedHoldTime: fc.integer({ min: 30, max: 60 * 24 * 60 }),
  expectedMovePercent: finiteDouble(0.5, 15),
  regime: regimeArb,
  gexState: gexArb,
  ivPercentile: fc.integer({ min: 0, max: 100 }),
  eventRisk: fc.array(
    fc.record({
      type: fc.constantFrom('EARNINGS', 'FOMC', 'OPEX', 'DIVIDEND', 'ECONOMIC_DATA'),
      date: fc.date({ min: new Date('2025-01-01'), max: new Date('2027-01-01') }).map((d) => d.toISOString()),
      daysUntil: fc.integer({ min: 0, max: 365 }),
    }),
    { maxLength: 3 }
  ),
  riskBudget: fc.record({
    maxPremiumLoss: finiteDouble(50, 5000),
    maxCapitalAllocation: finiteDouble(200, 20000),
  }),
  optionChain: fc.array(optionContractArb, { minLength: 1, maxLength: 25 }),
});

const exitInputArb: fc.Arbitrary<ExitDecisionInput> = fc.record({
  tradePosition: fc.record({
    id: fc.uuid(),
    symbol: fc.stringOf(fc.constantFrom('A', 'M', 'Z', 'N', 'V', 'D'), { minLength: 1, maxLength: 5 }),
    direction: fc.constantFrom('CALL', 'PUT'),
    setupType: setupTypeArb,
  }),
  entryData: fc.record({
    timestamp: fc.integer({ min: 1600000000000, max: 1900000000000 }),
    underlyingEntryPrice: finiteDouble(10, 1000),
    optionEntryPrice: finiteDouble(0.1, 50),
    contracts: fc.integer({ min: 1, max: 20 }),
  }),
  contractDetails: fc.record({
    expiry: fc.date({ min: new Date('2025-01-01'), max: new Date('2027-01-01') }).map((d) => d.toISOString()),
    dteAtEntry: fc.integer({ min: 1, max: 720 }),
    strike: finiteDouble(50, 600),
    greeksAtEntry: fc.record({
      delta: finiteDouble(-1, 1),
      gamma: finiteDouble(0, 0.2),
      theta: finiteDouble(-1, 0),
      vega: finiteDouble(0, 1),
    }),
    ivAtEntry: finiteDouble(0.05, 3),
  }),
  guardrails: fc.record({
    maxHoldTime: fc.integer({ min: 30, max: 365 * 24 * 60 }),
    timeStops: fc.array(fc.integer({ min: 30, max: 365 * 24 * 60 }), { maxLength: 3 }),
    progressChecks: fc.array(
      fc.record({
        atMinute: fc.integer({ min: 30, max: 365 * 24 * 60 }),
        minProfitPercent: finiteDouble(-50, 200),
      }),
      { maxLength: 3 }
    ),
    thetaBurnLimit: finiteDouble(5, 80),
    invalidationLevels: fc.record({
      stopLoss: finiteDouble(-80, -5),
      thesisInvalidation: finiteDouble(-60, -1),
    }),
  }),
  targets: fc.record({
    partialTakeProfitPercent: fc.array(finiteDouble(5, 200), { minLength: 1, maxLength: 3 }),
    fullTakeProfitPercent: finiteDouble(10, 250),
    stopLossPercent: finiteDouble(5, 80),
  }),
  liveMarket: fc.record({
    timestamp: fc.integer({ min: 1600000000000, max: 1900000000000 }),
    underlyingPrice: finiteDouble(10, 1000),
    optionBid: finiteDouble(0.01, 50),
    optionAsk: finiteDouble(0.02, 50),
    optionMid: finiteDouble(0.02, 50),
    currentGreeks: fc.record({
      delta: finiteDouble(-1, 1),
      gamma: finiteDouble(0, 0.2),
      theta: finiteDouble(-1, 0),
      vega: finiteDouble(0, 1),
    }),
    currentIV: finiteDouble(0.05, 3),
    currentDTE: fc.integer({ min: 0, max: 720 }),
    spreadPercent: finiteDouble(0, 50),
    regime: regimeArb,
    gexState: gexArb,
  }),
  thesisStatus: fc.option(
    fc.record({
      confidenceNow: fc.integer({ min: 0, max: 100 }),
      thesisValid: fc.boolean(),
      htfInvalidation: fc.boolean(),
    })
  ),
});

describe('Options engines property tests', () => {
  test('entry engine determinism', () => {
    fc.assert(
      fc.property(entryInputArb, (input) => {
        const a = evaluateEntryDecision(input as EntryDecisionInput);
        const b = evaluateEntryDecision(JSON.parse(JSON.stringify(input)) as EntryDecisionInput);
        expect(a).toEqual(b);
      }),
      { numRuns: 50 }
    );
  });

  test('entry engine blocks low confidence', () => {
    const lowConfidenceArb = entryInputArb.map((input) => {
      const min = ENTRY_MIN_CONFIDENCE[input.setupType];
      return {
        ...input,
        signal: {
          ...input.signal,
          confidence: Math.max(0, min - 5),
        },
      } as EntryDecisionInput;
    });

    fc.assert(
      fc.property(lowConfidenceArb, (input) => {
        const result = evaluateEntryDecision(input);
        expect(result.action).toBe('BLOCK');
      }),
      { numRuns: 50 }
    );
  });

  test('strike selection determinism', () => {
    fc.assert(
      fc.property(strikeInputArb, (input) => {
        const a = selectStrike(input as StrikeSelectionInput);
        const b = selectStrike(JSON.parse(JSON.stringify(input)) as StrikeSelectionInput);
        expect(a).toEqual(b);
      }),
      { numRuns: 50 }
    );
  });

  test('strike selection fails when DTE policy filters all contracts', () => {
    const invalidDteArb = strikeInputArb.map((input) => {
      const policy = DTE_POLICY[input.setupType];
      const maxDte = Math.max(1, policy.min - 1);
      const optionChain = input.optionChain.map((contract) => ({
        ...contract,
        dte: Math.min(contract.dte, maxDte),
      }));
      return { ...input, optionChain } as StrikeSelectionInput;
    });

    fc.assert(
      fc.property(invalidDteArb, (input) => {
        const result = selectStrike(input);
        expect(result.success).toBe(false);
        expect(result.failureReason).toBe('NO_VALID_STRIKE');
        expect(result.failedChecks?.includes('DTE_POLICY')).toBe(true);
      }),
      { numRuns: 25 }
    );
  });

  test('exit engine determinism', () => {
    fc.assert(
      fc.property(exitInputArb, (input) => {
        const normalized = {
          ...input,
          liveMarket: {
            ...input.liveMarket,
            timestamp: Math.max(input.liveMarket.timestamp, input.entryData.timestamp),
          },
        } as ExitDecisionInput;
        const a = evaluateExitDecision(normalized);
        const b = evaluateExitDecision(JSON.parse(JSON.stringify(normalized)) as ExitDecisionInput);
        expect(a).toEqual(b);
      }),
      { numRuns: 50 }
    );
  });

  test('exit engine exits on thesis invalidation', () => {
    const thesisInvalidArb = exitInputArb.map((input) => ({
      ...input,
      liveMarket: {
        ...input.liveMarket,
        timestamp: Math.max(input.liveMarket.timestamp, input.entryData.timestamp),
      },
      thesisStatus: { confidenceNow: 10, thesisValid: false, htfInvalidation: true },
    }));

    fc.assert(
      fc.property(thesisInvalidArb, (input) => {
        const result = evaluateExitDecision(input as ExitDecisionInput);
        expect(result.action).toBe('FULL_EXIT');
      }),
      { numRuns: 50 }
    );
  });
});
