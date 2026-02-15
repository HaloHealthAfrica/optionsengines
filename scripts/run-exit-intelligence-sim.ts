#!/usr/bin/env tsx
/**
 * Run Exit Intelligence Simulation - Scenarios X, Y, Z + Monte Carlo.
 */

import { runExitIntelligenceSimulation } from '../src/simulation/exit-intelligence-simulator.js';

async function main() {
  console.log('Exit Intelligence Simulator...\n');
  const { reports, monteCarlo, summary } = await runExitIntelligenceSimulation();

  for (const r of reports) {
    console.log(`\n=== ${r.scenarioName} ===`);
    console.log('Passed:', r.passed);
    console.log('Expectations:', r.expectations.join('; '));
    console.log('Actual:', JSON.stringify(r.actual, null, 2));
    if (r.anomaliesDetected.length > 0) {
      console.log('Anomalies:', r.anomaliesDetected);
    }
  }

  console.log('\n=== MONTE CARLO (200 random sequences) ===');
  console.log('Full exit:', monteCarlo.fullExitCount);
  console.log('Partial exit:', monteCarlo.partialExitCount);
  console.log('Tighten stop:', monteCarlo.tightenCount);
  console.log('Convert trailing:', monteCarlo.trailingCount);
  console.log('Hold:', monteCarlo.holdCount);
  console.log('Contradictory adjustments:', monteCarlo.contradictoryCount);
  console.log('Oscillation count:', monteCarlo.oscillationCount);
  console.log(
    'Reason code distribution (top 5):',
    Object.entries(monteCarlo.reasonCodeDistribution)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')
  );

  console.log('\n=== SUMMARY ===');
  console.log('All scenarios passed:', summary.allPassed);
  console.log('No contradictory adjustments:', summary.noContradictions);
  console.log('No oscillation loops:', summary.noOscillation);

  if (!summary.allPassed || !summary.noContradictions) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
