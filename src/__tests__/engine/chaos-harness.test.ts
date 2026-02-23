jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { ChaosHarness } from '../../engine/replay/ChaosHarness';

describe('ChaosHarness', () => {
  let harness: ChaosHarness;

  beforeEach(() => {
    harness = new ChaosHarness();
  });

  describe('enable/disable', () => {
    test('starts disabled', () => {
      expect(harness.isEnabled()).toBe(false);
    });

    test('enables with scenarios', () => {
      harness.enable(['MISSING_GREEKS', 'STALE_SNAPSHOT']);
      expect(harness.isEnabled()).toBe(true);
      expect(harness.getActiveScenarios()).toContain('MISSING_GREEKS');
      expect(harness.getActiveScenarios()).toContain('STALE_SNAPSHOT');
    });

    test('disables and clears scenarios', () => {
      harness.enable(['LOCK_TIMEOUT']);
      harness.disable();
      expect(harness.isEnabled()).toBe(false);
      expect(harness.getActiveScenarios()).toHaveLength(0);
    });
  });

  describe('shouldInject', () => {
    test('returns false when disabled', () => {
      const result = harness.shouldInject('MISSING_GREEKS');
      expect(result.triggered).toBe(false);
    });

    test('returns false when scenario not active', () => {
      harness.enable(['STALE_SNAPSHOT']);
      const result = harness.shouldInject('MISSING_GREEKS');
      expect(result.triggered).toBe(false);
    });

    test('respects probability (100%)', () => {
      harness.enable(['MISSING_GREEKS']);
      harness.setFailureProbability(1.0);
      const result = harness.shouldInject('MISSING_GREEKS');
      expect(result.triggered).toBe(true);
    });

    test('respects probability (0%)', () => {
      harness.enable(['MISSING_GREEKS']);
      harness.setFailureProbability(0);
      const result = harness.shouldInject('MISSING_GREEKS');
      expect(result.triggered).toBe(false);
    });
  });

  describe('forceInject', () => {
    test('always triggers when enabled', () => {
      harness.enable([]);
      const result = harness.forceInject('LOCK_TIMEOUT');
      expect(result.triggered).toBe(true);
    });

    test('returns false when not enabled', () => {
      const result = harness.forceInject('LOCK_TIMEOUT');
      expect(result.triggered).toBe(false);
    });
  });

  describe('data generators', () => {
    test('generateMissingGreeksQuote has null greeks', () => {
      const quote = harness.generateMissingGreeksQuote();
      expect(quote.delta).toBeNull();
      expect(quote.gamma).toBeNull();
      expect(quote.iv).toBeNull();
      expect(quote.greekSource).toBe('MISSING');
    });

    test('generateStaleTimestamp is old', () => {
      const ts = harness.generateStaleTimestamp();
      expect(Date.now() - ts.getTime()).toBeGreaterThan(60_000);
    });

    test('generateCorruptQuote has bid > ask', () => {
      const quote = harness.generateCorruptQuote();
      expect(quote.bid).toBeGreaterThan(quote.ask);
    });

    test('generateZeroLiquidity is zero', () => {
      const liq = harness.generateZeroLiquidity();
      expect(liq.volume).toBe(0);
      expect(liq.oi).toBe(0);
    });

    test('generateBrokerMismatch exceeds threshold', () => {
      const mm = harness.generateBrokerMismatch(100000);
      expect(mm.mismatchPct).toBeGreaterThan(0.05);
    });

    test('generateIVSpike shows large jump', () => {
      const spike = harness.generateIVSpike();
      expect(spike.currentIVPercentile - spike.previousIVPercentile).toBeGreaterThan(0.3);
    });
  });

  describe('reset', () => {
    test('resets all state', () => {
      harness.enable(['MISSING_GREEKS', 'DB_TIMEOUT']);
      harness.setFailureProbability(1.0);
      harness.reset();

      expect(harness.isEnabled()).toBe(false);
      expect(harness.getActiveScenarios()).toHaveLength(0);
    });
  });
});
