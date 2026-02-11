import { evaluateEntryDecision } from '../lib/entryEngine/index.js';
import type { EntryDecisionInput } from '../lib/entryEngine/types.js';

const baseInput: EntryDecisionInput = {
  symbol: 'SPY',
  timestamp: 1700000000000,
  direction: 'CALL',
  setupType: 'SWING',
  signal: {
    confidence: 75,
    pattern: 'BREAKOUT',
    timeframe: '15m',
  },
  marketContext: {
    price: 450,
    regime: 'BULL',
    gexState: 'NEUTRAL',
    volatility: 0.2,
    ivPercentile: 50,
  },
  timingContext: {
    session: 'MORNING',
    minutesFromOpen: 45,
    liquidityState: 'NORMAL',
  },
  riskContext: {
    dailyPnL: 100,
    openTradesCount: 2,
    portfolioDelta: 50,
    portfolioTheta: -20,
  },
};

describe('Entry Decision Engine', () => {
  test('blocks when signal confidence is too low', () => {
    const input: EntryDecisionInput = {
      ...baseInput,
      signal: { ...baseInput.signal, confidence: 10 },
    };

    const result = evaluateEntryDecision(input);
    expect(result.action).toBe('BLOCK');
    expect(result.triggeredRules.some((rule) => rule.rule === 'LOW_SIGNAL_CONFIDENCE')).toBe(true);
  });

  test('waits when confirmation is pending', () => {
    const input: EntryDecisionInput = {
      ...baseInput,
      signal: { ...baseInput.signal, confirmationPending: true },
    };

    const result = evaluateEntryDecision(input);
    expect(result.action).toBe('WAIT');
    expect(result.triggeredRules.some((rule) => rule.rule === 'CONFIRMATION_PENDING')).toBe(true);
  });

  test('enters with swing instructions when approved', () => {
    const result = evaluateEntryDecision(baseInput);
    expect(result.action).toBe('ENTER');
    expect(result.entryInstructions?.entryType).toBe('LIMIT');
    expect(result.timestamp).toBe(baseInput.timestamp);
  });
});
