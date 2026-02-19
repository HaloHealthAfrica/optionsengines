#!/usr/bin/env npx tsx
/**
 * Recompute P&L for all closed positions using direction-aware formula.
 * Updates realized_pnl in refactored_positions where computed differs from stored.
 *
 * Run: npm run recompute:pnl
 */

import { db } from '../src/services/database.service.js';
import { calculateRealizedPnL } from '../src/lib/pnl/calculate-realized-pnl.js';

const TOLERANCE = 0.01;

interface ClosedPosition {
  position_id: string;
  entry_price: number;
  exit_price: number;
  quantity: number;
  realized_pnl: number | null;
  position_side: string | null;
  multiplier: number | null;
}

async function run(): Promise<void> {
  console.log('=== Recompute P&L for Closed Positions ===\n');

  const result = await db.query<ClosedPosition>(
    `SELECT position_id, entry_price, exit_price, quantity, realized_pnl, position_side, multiplier
     FROM refactored_positions
     WHERE status = 'closed'
       AND exit_price IS NOT NULL
       AND entry_price IS NOT NULL
       AND quantity > 0`
  );

  const positions = result.rows;
  console.log(`Found ${positions.length} closed positions.\n`);

  let updated = 0;
  for (const p of positions) {
    const mult = Number(p.multiplier ?? 100);
    const side = (p.position_side ?? 'LONG').toUpperCase();
    const computed = calculateRealizedPnL({
      entry_price: Number(p.entry_price),
      exit_price: Number(p.exit_price),
      quantity: p.quantity,
      multiplier: mult,
      position_side: side,
    });
    const stored = Number(p.realized_pnl ?? 0);
    const diff = Math.abs(computed - stored);

    if (diff > TOLERANCE) {
      await db.query(
        `UPDATE refactored_positions SET realized_pnl = $1 WHERE position_id = $2`,
        [computed, p.position_id]
      );
      console.log(
        `  Updated ${p.position_id}: stored=${stored.toFixed(2)} -> computed=${computed.toFixed(2)} (diff=${diff.toFixed(2)})`
      );
      updated += 1;
    }
  }

  console.log(`\nRecompute complete. Updated ${updated} position(s).`);
}

run().catch((err) => {
  console.error('Recompute failed:', err);
  process.exit(1);
});
