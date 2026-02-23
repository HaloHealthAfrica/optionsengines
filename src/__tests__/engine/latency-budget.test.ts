import { LatencyMode } from '../../engine/types/enums';
import { LatencyBudgetExceededError } from '../../engine/types/errors';

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
jest.mock('../../config/index', () => ({
  config: { logLevel: 'info', databaseUrl: '', dbPoolMax: 5, slowRequestMs: 1000 },
}));
jest.mock('../../engine/config/loader', () => ({
  getEngineConfig: () => ({
    latency: {
      maxTotalDecisionCycleMs_cached: 700,
      maxTotalDecisionCycleMs_cold: 2000,
      maxConstructionLatencyMs: 400,
      maxGovernorLatencyMs: 150,
      maxLedgerLatencyMs: 100,
      maxSessionGuardLatencyMs: 50,
    },
  }),
}));

import { LatencyBudget } from '../../engine/core/LatencyBudget';

describe('LatencyBudget', () => {
  test('starts with COLD mode by default', () => {
    const budget = new LatencyBudget();
    const result = budget.toResult();
    expect(result.latencyMode).toBe(LatencyMode.COLD);
  });

  test('can switch to CACHED mode', () => {
    const budget = new LatencyBudget();
    budget.setMode(LatencyMode.CACHED);
    const result = budget.toResult();
    expect(result.latencyMode).toBe(LatencyMode.CACHED);
    expect(result.budgetMs).toBe(700);
  });

  test('COLD mode has 2000ms budget', () => {
    const budget = new LatencyBudget();
    budget.setMode(LatencyMode.COLD);
    const result = budget.toResult();
    expect(result.budgetMs).toBe(2000);
  });

  test('tracks stage durations', () => {
    const budget = new LatencyBudget();
    budget.startStage('construction');
    budget.endCurrentStage();
    budget.startStage('governor');
    budget.endCurrentStage();

    const result = budget.toResult();
    expect(result.stageDurations).toHaveProperty('construction');
    expect(result.stageDurations).toHaveProperty('governor');
    expect(typeof result.stageDurations.construction).toBe('number');
  });

  test('elapsed time is always >= 0', () => {
    const budget = new LatencyBudget();
    expect(budget.getElapsedMs()).toBeGreaterThanOrEqual(0);
  });

  test('toResult returns passed=true when within budget', () => {
    const budget = new LatencyBudget();
    budget.setMode(LatencyMode.COLD);
    const result = budget.toResult();
    expect(result.passed).toBe(true);
    expect(result.totalElapsedMs).toBeLessThan(2000);
  });

  test('check() does not throw when within budget', () => {
    const budget = new LatencyBudget();
    budget.setMode(LatencyMode.COLD);
    expect(() => budget.check()).not.toThrow();
  });

  test('checkStageBudget throws when stage exceeds limit', () => {
    const budget = new LatencyBudget();
    // Manually set a stage duration that exceeds the budget
    budget.startStage('test');
    budget.endCurrentStage();
    // Override the tracked value for testing
    (budget as any).stageDurations['test'] = 999;

    expect(() => budget.checkStageBudget('test', 100)).toThrow(LatencyBudgetExceededError);
  });

  test('checkStageBudget does not throw when within limit', () => {
    const budget = new LatencyBudget();
    (budget as any).stageDurations['test'] = 50;
    expect(() => budget.checkStageBudget('test', 100)).not.toThrow();
  });

  test('ending a stage that was not started is a no-op', () => {
    const budget = new LatencyBudget();
    budget.endCurrentStage();
    const result = budget.toResult();
    expect(Object.keys(result.stageDurations)).toHaveLength(0);
  });

  test('starting a new stage auto-ends the previous one', () => {
    const budget = new LatencyBudget();
    budget.startStage('first');
    budget.startStage('second');
    budget.endCurrentStage();

    const result = budget.toResult();
    expect(result.stageDurations).toHaveProperty('first');
    expect(result.stageDurations).toHaveProperty('second');
  });
});
