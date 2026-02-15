#!/usr/bin/env tsx
/**
 * Run Advanced Stability Simulation - Chaos & edge-case testing.
 */

import { runAdvancedStabilitySimulation } from '../src/simulation/advanced-stability-simulator.js';

async function main() {
  console.log('Advanced Stability Simulator - Chaos Testing...\n');
  const { reports, modifierAudit, monteCarlo, summary } = await runAdvancedStabilitySimulation();

  for (const r of reports) {
    console.log(`\n=== ${r.scenarioName} ===`);
    console.log('Passed:', r.passed);
    if (r.anomaliesDetected.length > 0) {
      console.log('Anomalies:', r.anomaliesDetected);
    }
    console.log('Metrics:', JSON.stringify(r.metrics, null, 2));
  }

  console.log('\n=== MODIFIER CONTRIBUTION VARIANCE ===');
  console.log(JSON.stringify(modifierAudit, null, 2));

  console.log('\n=== MONTE CARLO (500 random states) ===');
  console.log('Block rate:', (monteCarlo.blockRate * 100).toFixed(1) + '%');
  console.log('Mean risk multiplier:', monteCarlo.meanRiskMultiplier.toFixed(3));
  console.log('Exposure cap frequency:', (monteCarlo.exposureCapFrequency * 100).toFixed(1) + '%');
  console.log('Risk std dev:', monteCarlo.riskStdDev.toFixed(3));
  console.log('Risk histogram:', JSON.stringify(monteCarlo.riskDistributionHistogram, null, 2));
  console.log('Suppression reasons (top 5):', Object.entries(monteCarlo.suppressionReasonsDistribution)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', '));

  console.log('\n=== SUMMARY ===');
  console.log('All passed:', summary.allPassed);
  console.log('Block rate in 15-40%:', summary.blockRateInRange);
  if (summary.anomaliesFound.length > 0) {
    console.log('Anomalies:', summary.anomaliesFound);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
