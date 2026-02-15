/**
 * Advanced Stability Simulator - Chaos & edge-case tests.
 */

import { db } from '../services/database.service.js';

jest.mock('../services/database.service.js', () => ({
  db: { query: jest.fn() },
}));

import { runAdvancedStabilitySimulation } from '../simulation/advanced-stability-simulator.js';

describe('Advanced Stability Simulator', () => {
  beforeEach(() => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
  });

  it('runs all advanced scenarios', async () => {
    const { reports, modifierAudit, monteCarlo } = await runAdvancedStabilitySimulation();
    expect(reports).toHaveLength(5);
    expect(reports.map((r) => r.scenarioName)).toContain('D_OSCILLATION_STRESS');
    expect(reports.map((r) => r.scenarioName)).toContain('E_ACCELERATION_DECAY');
    expect(reports.map((r) => r.scenarioName)).toContain('F_PORTFOLIO_PRESSURE');
    expect(reports.map((r) => r.scenarioName)).toContain('G_STALENESS_ACCELERATION_CONFLICT');
    expect(reports.map((r) => r.scenarioName)).toContain('H_RISK_FLOOR_CEILING');
    expect(modifierAudit.modifierContributionVariance).toBeDefined();
    expect(monteCarlo.blockRate).toBeGreaterThanOrEqual(0);
    expect(monteCarlo.blockRate).toBeLessThanOrEqual(1);
  });

  it('D: oscillation keeps risk variance controlled', async () => {
    const { reports } = await runAdvancedStabilitySimulation();
    const d = reports.find((r) => r.scenarioName === 'D_OSCILLATION_STRESS')!;
    expect(d.metrics.riskStdDev).toBeLessThanOrEqual(0.4);
  });

  it('E: acceleration decay has no sudden cliff', async () => {
    const { reports } = await runAdvancedStabilitySimulation();
    const e = reports.find((r) => r.scenarioName === 'E_ACCELERATION_DECAY')!;
    expect(e.passed).toBe(true);
  });

  it('G: staleness dominates acceleration', async () => {
    const { reports } = await runAdvancedStabilitySimulation();
    const g = reports.find((r) => r.scenarioName === 'G_STALENESS_ACCELERATION_CONFLICT')!;
    expect(g.passed).toBe(true);
  });

  it('H: risk stays within floor and ceiling', async () => {
    const { reports } = await runAdvancedStabilitySimulation();
    const h = reports.find((r) => r.scenarioName === 'H_RISK_FLOOR_CEILING')!;
    for (const rc of h.riskChanges) {
      expect(rc.finalRiskMultiplier).toBeGreaterThanOrEqual(0.25);
      expect(rc.finalRiskMultiplier).toBeLessThanOrEqual(1.5);
    }
  });

  it('Monte Carlo: no risk runaway', async () => {
    const { monteCarlo } = await runAdvancedStabilitySimulation();
    expect(monteCarlo.meanRiskMultiplier).toBeLessThanOrEqual(1.5);
    expect(monteCarlo.riskStdDev).toBeLessThan(0.5);
  });
});
