import { IVRegime, TermShape } from '../../engine/types/enums';

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../config/index', () => ({
  config: { logLevel: 'info', databaseUrl: '', dbPoolMax: 5, slowRequestMs: 1000 },
}));
jest.mock('../../engine/config/loader', () => ({
  getEngineConfig: () => ({
    buckets: { ORB: 0.30, GEX: 0.30, Spread: 0.30, Experimental: 0.10 },
    regime: { ivLowThreshold: 0.33, ivHighThreshold: 0.66, minIVSampleDays: 63, hysteresisCount: 3 },
  }),
}));

const mockDbQuery = jest.fn();
jest.mock('../../services/database.service', () => ({
  db: { query: (...args: any[]) => mockDbQuery(...args) },
}));

import { RegimePolicyEngine } from '../../engine/regime/RegimePolicyEngine';
import type { PolicyRule, RegimeContext, RuleCondition } from '../../engine/regime/RegimePolicyEngine';

describe('RegimePolicyEngine', () => {
  let engine: RegimePolicyEngine;

  const makeContext = (overrides: Partial<RegimeContext> = {}): RegimeContext => ({
    ivRegime: IVRegime.HIGH,
    termShape: TermShape.BACKWARDATION,
    ivPercentile: 0.78,
    skew: 0.08,
    ...overrides,
  });

  beforeEach(() => {
    engine = new RegimePolicyEngine();
    mockDbQuery.mockReset();
  });

  describe('matchesCondition', () => {
    const ctx = makeContext();

    test('matches exact ivRegime', () => {
      expect(engine.matchesCondition({ ivRegime: 'HIGH' }, ctx)).toBe(true);
      expect(engine.matchesCondition({ ivRegime: 'LOW' }, ctx)).toBe(false);
    });

    test('matches ivRegimeIn array', () => {
      expect(engine.matchesCondition({ ivRegimeIn: ['HIGH', 'NEUTRAL'] }, ctx)).toBe(true);
      expect(engine.matchesCondition({ ivRegimeIn: ['LOW'] }, ctx)).toBe(false);
    });

    test('matches exact termShape', () => {
      expect(engine.matchesCondition({ termShape: 'BACKWARDATION' }, ctx)).toBe(true);
      expect(engine.matchesCondition({ termShape: 'CONTANGO' }, ctx)).toBe(false);
    });

    test('matches termShapeIn array', () => {
      expect(engine.matchesCondition({ termShapeIn: ['BACKWARDATION', 'FLAT'] }, ctx)).toBe(true);
      expect(engine.matchesCondition({ termShapeIn: ['CONTANGO'] }, ctx)).toBe(false);
    });

    test('matches skewAbove', () => {
      expect(engine.matchesCondition({ skewAbove: 0.05 }, ctx)).toBe(true);
      expect(engine.matchesCondition({ skewAbove: 0.10 }, ctx)).toBe(false);
    });

    test('matches skewBelow', () => {
      expect(engine.matchesCondition({ skewBelow: 0.10 }, ctx)).toBe(true);
      expect(engine.matchesCondition({ skewBelow: 0.05 }, ctx)).toBe(false);
    });

    test('matches ivPercentileAbove', () => {
      expect(engine.matchesCondition({ ivPercentileAbove: 0.70 }, ctx)).toBe(true);
      expect(engine.matchesCondition({ ivPercentileAbove: 0.80 }, ctx)).toBe(false);
    });

    test('matches ivPercentileBelow', () => {
      expect(engine.matchesCondition({ ivPercentileBelow: 0.80 }, ctx)).toBe(true);
      expect(engine.matchesCondition({ ivPercentileBelow: 0.70 }, ctx)).toBe(false);
    });

    test('fails when skew is null and condition requires it', () => {
      const ctxNoSkew = makeContext({ skew: null });
      expect(engine.matchesCondition({ skewAbove: 0.05 }, ctxNoSkew)).toBe(false);
    });

    test('empty condition matches everything', () => {
      expect(engine.matchesCondition({}, ctx)).toBe(true);
    });

    test('all conditions must match (AND logic)', () => {
      const combo: RuleCondition = { ivRegime: 'HIGH', termShapeIn: ['BACKWARDATION', 'FLAT'] };
      expect(engine.matchesCondition(combo, ctx)).toBe(true);

      const mismatch: RuleCondition = { ivRegime: 'HIGH', termShape: 'CONTANGO' };
      expect(engine.matchesCondition(mismatch, ctx)).toBe(false);
    });
  });

  describe('evaluate', () => {
    test('returns default snapshot when no policy exists', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // getActivePolicy
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // persistSnapshot

      const result = await engine.evaluate('acct-1', makeContext());

      expect(result.regimeTag).toBe('HIGH:BACKWARDATION');
      expect(result.notes).toContain('No matching policy rules');
      expect(result.denyStrategies).toHaveLength(0);
    });

    test('applies matching rules', async () => {
      const rules: PolicyRule[] = [
        {
          when: { ivRegime: 'HIGH', termShapeIn: ['BACKWARDATION', 'FLAT'] },
          then: {
            bucketLimits: { Spread: 0.40, GEX: 0.35, ORB: 0.20, Experimental: 0.05 },
            strategyWeights: { SPREAD: 1.2, ORB: 0.8 },
            risk: { globalSize: 0.85 },
            denyStrategies: ['LONG_PREMIUM'],
          },
          priority: 1,
        },
      ];

      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          id: 'p1', account_id: 'acct-1', policy_version: '1.0.0',
          enabled: true, rules, created_at: new Date(), updated_at: new Date(),
        }],
      });
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // persistSnapshot

      const result = await engine.evaluate('acct-1', makeContext());

      expect(result.bucketLimits['Spread']).toBe(0.40);
      expect(result.strategyWeightOverrides['SPREAD']).toBe(1.2);
      expect(result.riskMultipliers['globalSize']).toBe(0.85);
      expect(result.denyStrategies).toContain('LONG_PREMIUM');
      expect(result.notes).toContain('1 rule(s) matched');
    });

    test('merges multiple matching rules', async () => {
      const rules: PolicyRule[] = [
        {
          when: { ivRegime: 'HIGH' },
          then: {
            strategyWeights: { SPREAD: 1.2 },
            denyStrategies: ['LONG_PREMIUM'],
          },
          priority: 1,
        },
        {
          when: { termShapeIn: ['BACKWARDATION'] },
          then: {
            strategyWeights: { GEX: 1.1 },
            risk: { globalSize: 0.90 },
            denyStrategies: ['NAKED_PUTS'],
          },
          priority: 2,
        },
      ];

      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          id: 'p1', account_id: 'acct-1', policy_version: '1.0.0',
          enabled: true, rules, created_at: new Date(), updated_at: new Date(),
        }],
      });
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const result = await engine.evaluate('acct-1', makeContext());

      expect(result.strategyWeightOverrides['SPREAD']).toBe(1.2);
      expect(result.strategyWeightOverrides['GEX']).toBe(1.1);
      expect(result.riskMultipliers['globalSize']).toBe(0.90);
      expect(result.denyStrategies).toContain('LONG_PREMIUM');
      expect(result.denyStrategies).toContain('NAKED_PUTS');
      expect(result.notes).toContain('2 rule(s) matched');
    });

    test('skips non-matching rules', async () => {
      const rules: PolicyRule[] = [
        {
          when: { ivRegime: 'LOW' },
          then: { denyStrategies: ['EVERYTHING'] },
        },
      ];

      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          id: 'p1', account_id: 'acct-1', policy_version: '1.0.0',
          enabled: true, rules, created_at: new Date(), updated_at: new Date(),
        }],
      });
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const result = await engine.evaluate('acct-1', makeContext());

      expect(result.denyStrategies).toHaveLength(0);
      expect(result.notes).toContain('No matching policy rules');
    });

    test('disabled policy returns defaults', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          id: 'p1', account_id: 'acct-1', policy_version: '1.0.0',
          enabled: false, rules: [{ when: {}, then: { denyStrategies: ['ALL'] } }],
          created_at: new Date(), updated_at: new Date(),
        }],
      });
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const result = await engine.evaluate('acct-1', makeContext());
      expect(result.denyStrategies).toHaveLength(0);
    });
  });

  describe('isStrategyAllowed', () => {
    test('returns true when not denied', () => {
      const snap = { denyStrategies: ['LONG_PREMIUM'] } as any;
      expect(engine.isStrategyAllowed('SPREAD', snap)).toBe(true);
    });

    test('returns false when denied', () => {
      const snap = { denyStrategies: ['SPREAD', 'LONG_PREMIUM'] } as any;
      expect(engine.isStrategyAllowed('SPREAD', snap)).toBe(false);
    });
  });

  describe('getStrategyWeight', () => {
    test('returns override when present', () => {
      const snap = { strategyWeightOverrides: { SPREAD: 1.2, ORB: 0.8 } } as any;
      expect(engine.getStrategyWeight('SPREAD', snap)).toBe(1.2);
    });

    test('returns 1.0 when no override', () => {
      const snap = { strategyWeightOverrides: {} } as any;
      expect(engine.getStrategyWeight('GEX', snap)).toBe(1.0);
    });
  });

  describe('getGlobalSizeMultiplier', () => {
    test('returns multiplier when present', () => {
      const snap = { riskMultipliers: { globalSize: 0.85 } } as any;
      expect(engine.getGlobalSizeMultiplier(snap)).toBe(0.85);
    });

    test('returns 1.0 when not present', () => {
      const snap = { riskMultipliers: {} } as any;
      expect(engine.getGlobalSizeMultiplier(snap)).toBe(1.0);
    });
  });

  describe('createPolicy', () => {
    test('persists policy to DB', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const rules: PolicyRule[] = [
        { when: { ivRegime: 'HIGH' }, then: { denyStrategies: ['LONG_PREMIUM'] } },
      ];

      const policy = await engine.createPolicy('acct-1', rules, '1.0.0');

      expect(policy.accountId).toBe('acct-1');
      expect(policy.rules).toHaveLength(1);
      expect(policy.enabled).toBe(true);
      expect(mockDbQuery).toHaveBeenCalledTimes(1);
    });
  });
});
