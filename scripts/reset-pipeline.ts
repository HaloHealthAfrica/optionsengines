/**
 * Reset pipeline data - zero out orders, trades, signals, etc. for a clean start.
 * Preserves: users, exit_rules, risk_limits, feature_flags, config tables.
 *
 * Usage: npx tsx scripts/reset-pipeline.ts [--confirm]
 */

import { db } from '../src/services/database.service.js';

const CONFIRM = process.argv.includes('--confirm');

const TABLES = [
  'trades',
  'shadow_positions',
  'shadow_trades',
  'trade_outcomes',
  'agent_decisions',
  'decision_recommendations',
  'execution_policies',
  'orders',
  'market_contexts',
  'refactored_signals',
  'experiments',
  'webhook_events',
  'refactored_positions',
  'signals',
];

async function main() {
  if (!CONFIRM) {
    console.error('This will DELETE all pipeline data (orders, trades, signals, etc.).');
    console.error('Run with --confirm to proceed: npx tsx scripts/reset-pipeline.ts --confirm');
    process.exit(1);
  }

  console.log('Resetting pipeline data...');

  for (const table of TABLES) {
    try {
      const r = await db.query(`DELETE FROM ${table}`);
      console.log(`  ${table}: ${r.rowCount ?? 0} rows deleted`);
    } catch (err: any) {
      console.error(`  ${table}: ERROR - ${err?.message}`);
      process.exit(1);
    }
  }

  console.log('\nDone. Pipeline reset complete.');
  process.exit(0);
}

main();
