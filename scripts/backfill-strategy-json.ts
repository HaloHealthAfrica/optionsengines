/**
 * One-time backfill: populate strategy_json for existing decision_snapshots
 * that were created before migration 064.
 *
 * Joins decision_snapshots → signals, rebuilds a UDCSignal, re-runs the
 * strategy router, and updates strategy_json for each matching row.
 *
 * Usage: npx tsx scripts/backfill-strategy-json.ts
 */

import { db } from '../src/services/database.service.js';
import { strategyRouter } from '../src/lib/udc/strategy-router.js';
import type { UDCSignal } from '../src/lib/udc/types.js';

async function main() {
  console.log('Backfilling strategy_json for existing decision_snapshots...\n');

  const result = await db.query(`
    SELECT ds.id, ds.signal_id, s.symbol, s.direction, s.timeframe, s.timestamp, s.raw_payload
    FROM decision_snapshots ds
    JOIN signals s ON s.signal_id::text = ds.signal_id
    WHERE ds.strategy_json IS NULL
      AND ds.status = 'PLAN_CREATED'
    ORDER BY ds.created_at DESC
  `);

  console.log(`Found ${result.rows.length} snapshots to backfill.\n`);

  let updated = 0;
  let skipped = 0;

  for (const row of result.rows) {
    const signal: UDCSignal = {
      id: row.signal_id,
      symbol: row.symbol,
      direction: row.direction === 'long' ? 'long' : 'short',
      timeframe: row.timeframe,
      timestamp: new Date(row.timestamp).getTime(),
      pattern: row.raw_payload?.pattern ?? row.raw_payload?.setup_type,
      confidence: row.raw_payload?.confidence,
      raw_payload: row.raw_payload,
    };

    const candidate = strategyRouter(signal);

    if (!candidate) {
      console.log(`  [skip] ${row.id} — no strategy match for signal ${row.signal_id}`);
      skipped++;
      continue;
    }

    await db.query(
      `UPDATE decision_snapshots SET strategy_json = $1 WHERE id = $2`,
      [JSON.stringify(candidate), row.id],
    );

    console.log(`  [ok]   ${row.id} → ${candidate.intent.strategy} (${candidate.intent.direction}, conf=${candidate.confidence})`);
    updated++;
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
