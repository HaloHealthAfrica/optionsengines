#!/usr/bin/env tsx
/**
 * Run Adaptive Feedback Simulation - 100 synthetic trades, verify bounded tuning.
 */

import { runAdaptiveFeedbackSimulation } from '../src/simulation/adaptive-feedback-simulator.js';

async function main() {
  console.log('Adaptive Feedback Simulator...\n');
  const report = await runAdaptiveFeedbackSimulation();

  console.log('Trade count:', report.tradeCount);
  console.log('Rolling win rate:', (report.rollingStats.winRate * 100).toFixed(1) + '%');
  console.log('Rolling avg R:', report.rollingStats.avgR.toFixed(2));
  console.log('Breakout in RANGE win rate:', (report.rollingStats.breakoutWinRateInRange * 100).toFixed(1) + '%');
  console.log('Tuner updated:', report.tunerResult.updated);
  console.log('Changes:', report.tunerResult.changes.length);

  if (report.tunerResult.changes.length > 0) {
    console.log('\nApplied changes:');
    for (const c of report.tunerResult.changes) {
      console.log(`  ${c.parameter}: ${c.previous} → ${c.new}`);
    }
  }

  console.log('\nPassed:', report.passed);
  if (report.anomalies.length > 0) {
    console.log('Anomalies:', report.anomalies);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
