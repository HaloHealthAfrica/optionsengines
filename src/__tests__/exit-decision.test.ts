import { evaluateExitDecision } from '../lib/exitEngine/index.js';
import type { ExitDecisionInput } from '../lib/exitEngine/types.js';

const baseInput: ExitDecisionInput = {
  tradePosition: {
    id: 'pos-1',
    symbol: 'SPY',
    direction: 'CALL',
    setupType: 'SWING',
  },
  entryData: {
    timestamp: 1700000000000,
    underlyingEntryPrice: 450,
    optionEntryPrice: 2.5,
    contracts: 2,
  },
  contractDetails: {
    expiry: '2025-06-21',
    dteAtEntry: 30,
    strike: 450,
    greeksAtEntry: { delta: 0.32, gamma: 0.01, theta: -0.03, vega: 0.08 },
    ivAtEntry: 0.2,
  },
  guardrails: {
    maxHoldTime: 14 * 24 * 60,
    timeStops: [7 * 24 * 60],
    progressChecks: [{ atMinute: 3 * 24 * 60, minProfitPercent: 10 }],
    thetaBurnLimit: 30,
    invalidationLevels: { stopLoss: -25, thesisInvalidation: -20 },
  },
  targets: {
    partialTakeProfitPercent: [25, 50],
    fullTakeProfitPercent: 80,
    stopLossPercent: 25,
  },
  liveMarket: {
    timestamp: 1700000000000 + 60 * 60 * 1000,
    underlyingPrice: 452,
    optionBid: 2.6,
    optionAsk: 2.8,
    optionMid: 2.7,
    currentGreeks: { delta: 0.3, gamma: 0.009, theta: -0.028, vega: 0.075 },
    currentIV: 0.19,
    currentDTE: 29,
    spreadPercent: 8,
    regime: 'BULL',
    gexState: 'NEUTRAL',
  },
};

describe('Exit Decision Engine', () => {
  test('exits immediately when thesis invalidation occurs', () => {
    const input: ExitDecisionInput = {
      ...baseInput,
      thesisStatus: { confidenceNow: 20, thesisValid: false, htfInvalidation: true },
    };
    const result = evaluateExitDecision(input);
    expect(result.action).toBe('FULL_EXIT');
    expect(result.triggeredRules.some((rule) => rule.rule === 'THESIS_INVALIDATION')).toBe(true);
  });

  test('holds when no exit rules trigger', () => {
    const result = evaluateExitDecision(baseInput);
    expect(result.action).toBe('HOLD');
  });
});
