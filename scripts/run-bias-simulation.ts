#!/usr/bin/env tsx
/**
 * Run Bias Control Simulation - Behavioral validation under stress.
 * No trades executed.
 */

import { runBiasControlSimulation } from '../src/simulation/bias-control-simulator.js';

async function main() {
  console.log('Bias Control Simulator - Running scenarios...\n');
  const { reports, summary } = await runBiasControlSimulation();

  for (const r of reports) {
    console.log(`\n=== ${r.scenarioName} ===`);
    console.log('Passed:', r.passed);
    if (r.anomaliesDetected.length > 0) {
      console.log('Anomalies:', r.anomaliesDetected);
    }
    console.log('Risk changes (last step):', JSON.stringify(r.riskChanges[r.riskChanges.length - 1], null, 2));
    console.log('Exposure (last step):', r.exposureDecisions[r.exposureDecisions.length - 1]);
    console.log('Setup validator (last step):', r.setupValidatorBlocks[r.setupValidatorBlocks.length - 1]);
  }

  console.log('\n=== SUMMARY ===');
  console.log('All passed:', summary.allPassed);
  console.log('Risk modifier distribution:', JSON.stringify(summary.riskModifierDistribution, null, 2));
  if (summary.anomaliesFound.length > 0) {
    console.log('Anomalies found:', summary.anomaliesFound);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
