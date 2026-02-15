#!/usr/bin/env tsx
/**
 * Run Adaptive Tuner - Once per day. Call via cron or manually.
 */

import { runAdaptiveTuning } from '../src/services/performance-feedback/adaptive-tuner.service.js';

async function main() {
  console.log('Adaptive Tuner - Running...\n');
  const result = await runAdaptiveTuning();

  console.log('Trade count:', result.stats.tradeCount);
  console.log('Win rate:', (result.stats.winRate * 100).toFixed(1) + '%');
  console.log('Avg R:', result.stats.avgR.toFixed(2));
  console.log('Breakout in RANGE win rate:', (result.stats.breakoutWinRateInRange * 100).toFixed(1) + '%');
  console.log('Macro drift exit avg R:', result.stats.macroDriftExitAvgR.toFixed(2));
  console.log('Updated:', result.updated);

  if (result.changes.length > 0) {
    console.log('\nChanges applied:');
    for (const c of result.changes) {
      console.log(`  ${c.parameter}: ${c.previous} → ${c.new} (${c.reason})`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
