import { selectStrike } from '../lib/strikeSelection/index.js';
import type { StrikeSelectionInput } from '../lib/strikeSelection/types.js';

const baseInput: StrikeSelectionInput = {
  symbol: 'SPY',
  spotPrice: 450,
  direction: 'CALL',
  setupType: 'SWING',
  signalConfidence: 75,
  expectedHoldTime: 5 * 24 * 60,
  expectedMovePercent: 2,
  regime: 'BULL',
  gexState: 'NEUTRAL',
  ivPercentile: 40,
  eventRisk: [],
  riskBudget: {
    maxPremiumLoss: 500,
    maxCapitalAllocation: 2000,
  },
  optionChain: [
    {
      expiry: '2025-06-21',
      dte: 30,
      strike: 450,
      bid: 2.4,
      ask: 2.6,
      mid: 2.5,
      openInterest: 500,
      volume: 200,
      greeks: { delta: 0.32, gamma: 0.01, theta: -0.03, vega: 0.08 },
      iv: 0.2,
    },
    {
      expiry: '2025-06-28',
      dte: 37,
      strike: 455,
      bid: 2.1,
      ask: 2.3,
      mid: 2.2,
      openInterest: 400,
      volume: 150,
      greeks: { delta: 0.28, gamma: 0.015, theta: -0.025, vega: 0.07 },
      iv: 0.21,
    },
  ],
};

describe('Strike Selection Engine', () => {
  test('selects a valid strike when contracts pass filters', () => {
    const result = selectStrike(baseInput);
    expect(result.success).toBe(true);
    expect(result.tradeContract?.strike).toBe(450);
  });

  test('returns NO_VALID_STRIKE when DTE policy filters all contracts', () => {
    const input: StrikeSelectionInput = {
      ...baseInput,
      optionChain: baseInput.optionChain.map((contract) => ({ ...contract, dte: 5 })),
    };
    const result = selectStrike(input);
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('NO_VALID_STRIKE');
  });
});
