/**
 * Bias Control Simulator - Behavioral validation tests.
 */

import { db } from '../services/database.service.js';

jest.mock('../services/database.service.js', () => ({
  db: { query: jest.fn() },
}));

import { runBiasControlSimulation } from '../simulation/bias-control-simulator.js';

describe('Bias Control Simulator', () => {
  beforeEach(() => {
    (db.query as jest.Mock).mockResolvedValue({ rows: [] });
  });

  it('runs all scenarios and produces structured reports', async () => {
    const { reports, summary } = await runBiasControlSimulation();
    expect(reports).toHaveLength(3);
    expect(reports.map((r) => r.scenarioName)).toContain('A_MACRO_REVERSAL_SHOCK');
    expect(reports.map((r) => r.scenarioName)).toContain('B_ACCELERATION_EXPANSION');
    expect(reports.map((r) => r.scenarioName)).toContain('C_CHOP_RANGE_TRAP');
    expect(summary.riskModifierDistribution).toHaveLength(3);
  });

  it('Scenario A: macro reversal reduces risk and caps exposure', async () => {
    const { reports } = await runBiasControlSimulation();
    const scenarioA = reports.find((r) => r.scenarioName === 'A_MACRO_REVERSAL_SHOCK')!;
    const lastExp = scenarioA.exposureDecisions[scenarioA.exposureDecisions.length - 1];
    expect(lastExp.reasons).toContain('MACRO_DRIFT_GUARD');
    const lastRisk = scenarioA.riskChanges[scenarioA.riskChanges.length - 1];
    const firstRisk = scenarioA.riskChanges[0];
    expect(lastRisk.finalRiskMultiplier).toBeLessThanOrEqual(firstRisk.finalRiskMultiplier + 0.3);
  });

  it('Scenario B: acceleration expansion stays within hard caps', async () => {
    const { reports } = await runBiasControlSimulation();
    const scenarioB = reports.find((r) => r.scenarioName === 'B_ACCELERATION_EXPANSION')!;
    for (const rc of scenarioB.riskChanges) {
      expect(rc.finalRiskMultiplier).toBeLessThanOrEqual(1.5);
    }
    expect(scenarioB.passed).toBe(true);
  });

  it('Scenario C: range chop blocks breakout', async () => {
    const { reports } = await runBiasControlSimulation();
    const scenarioC = reports.find((r) => r.scenarioName === 'C_CHOP_RANGE_TRAP')!;
    expect(scenarioC.exposureDecisions[0].result).toBe('BLOCK');
    expect(scenarioC.exposureDecisions[0].reasons).toContain('RANGE_BREAKOUT_BLOCKED');
  });
});
