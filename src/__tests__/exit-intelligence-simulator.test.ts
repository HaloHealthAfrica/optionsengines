import {
  runScenarioX,
  runScenarioY,
  runScenarioZ,
  runExitMonteCarlo,
  runExitIntelligenceSimulation,
} from '../simulation/exit-intelligence-simulator.js';

describe('Exit Intelligence Simulator', () => {
  it('X: macro flip in profit triggers partial or tighten', async () => {
    const report = runScenarioX();
    expect(report.passed).toBe(true);
    expect(report.anomaliesDetected).toHaveLength(0);
    expect(report.actual.reasonCodes.length).toBeGreaterThan(0);
  });

  it('Y: acceleration collapse triggers trailing or tighten', async () => {
    const report = runScenarioY();
    expect(report.passed).toBe(true);
    expect(report.actual.reasonCodes).toContain('ACCELERATION_DECAY');
  });

  it('Z: liquidity trap triggers immediate full exit', async () => {
    const report = runScenarioZ();
    expect(report.passed).toBe(true);
    expect(report.actual.forceFullExit).toBe(true);
    expect(report.actual.reasonCodes).toContain('LIQUIDITY_TRAP_EXIT');
  });

  it('Monte Carlo: no contradictory adjustments', async () => {
    const mc = runExitMonteCarlo();
    expect(mc.contradictoryCount).toBe(0);
  });

  it('runs full exit intelligence simulation', async () => {
    const { reports, monteCarlo, summary } = await runExitIntelligenceSimulation();
    expect(reports).toHaveLength(3);
    expect(summary.allPassed).toBe(true);
    expect(summary.noContradictions).toBe(true);
    expect(monteCarlo.totalRuns).toBe(200);
  });
});
