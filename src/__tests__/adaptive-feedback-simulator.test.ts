import { runAdaptiveFeedbackSimulation } from '../simulation/adaptive-feedback-simulator.js';

describe('Adaptive Feedback Simulator', () => {
  it('runs simulation and verifies bounded tuning', async () => {
    const report = await runAdaptiveFeedbackSimulation();
    expect(report.tradeCount).toBe(100);
    expect(report.rollingStats.tradeCount).toBeGreaterThan(0);
    expect(report.passed).toBe(true);
    expect(report.anomalies).toHaveLength(0);
  });

  it('rolling stats calculated correctly', async () => {
    const report = await runAdaptiveFeedbackSimulation();
    expect(typeof report.rollingStats.winRate).toBe('number');
    expect(typeof report.rollingStats.avgR).toBe('number');
    expect(report.rollingStats.winRate).toBeGreaterThanOrEqual(0);
    expect(report.rollingStats.winRate).toBeLessThanOrEqual(1);
  });
});
