#!/usr/bin/env npx ts-node
/**
 * P&L and Duplicate Trade Audit Script
 *
 * For all closed trades:
 * 1. Recompute P&L using direction-aware formula
 * 2. Compare to stored P&L; flag if difference > 0.01
 * 3. Identify duplicate trades (same symbol, entry, exit, timestamp)
 * 4. Flag price anomalies (extreme P&L, invalid prices)
 *
 * Run: npx ts-node scripts/audit-pnl-and-duplicates.ts
 */

import { db } from '../src/services/database.service.js';

const PNL_TOLERANCE = 0.01;
const EXTREME_PNL_THRESHOLD = 100_000; // Flag P&L > $100k as potential error
const OPTION_PRICE_MAX = 500; // Flag option prices > $500 as suspicious

interface ClosedPosition {
  position_id: string;
  symbol: string;
  option_symbol: string;
  entry_price: number;
  exit_price: number;
  quantity: number;
  realized_pnl: number | null;
  position_side: string | null;
  multiplier: number | null;
  exit_timestamp: Date;
}

function calculateRealizedPnL(
  entry: number,
  exit: number,
  qty: number,
  positionSide: string,
  multiplier: number
): number {
  const side = String(positionSide || 'LONG').toUpperCase();
  if (side === 'LONG') {
    return (exit - entry) * qty * multiplier;
  }
  return (entry - exit) * qty * multiplier;
}

async function runAudit(): Promise<void> {
  console.log('=== P&L and Duplicate Trade Audit ===\n');

  const result = await db.query<ClosedPosition>(
    `SELECT position_id, symbol, option_symbol, entry_price, exit_price, quantity,
            realized_pnl, position_side, multiplier, exit_timestamp
     FROM refactored_positions
     WHERE status = 'closed'
       AND exit_price IS NOT NULL
       AND entry_price IS NOT NULL
       AND quantity > 0
     ORDER BY exit_timestamp DESC`
  );

  const positions = result.rows;
  console.log(`Found ${positions.length} closed positions to audit.\n`);

  const mismatches: Array<{
    position_id: string;
    symbol: string;
    stored_pnl: number;
    computed_pnl: number;
    diff: number;
    position_side: string;
  }> = [];
  const priceAnomalies: Array<{
    position_id: string;
    reason: string;
    value: number;
  }> = [];
  const duplicates: Array<{
    symbol: string;
    entry: number;
    exit: number;
    timestamp: string;
    position_ids: string[];
    count: number;
  }> = [];

  // Group by (symbol, entry, exit, timestamp) to find duplicates
  const groupKey = (p: ClosedPosition) =>
    `${p.symbol}|${p.entry_price}|${p.exit_price}|${p.exit_timestamp?.toISOString()}`;
  const groups = new Map<string, ClosedPosition[]>();
  for (const p of positions) {
    const key = groupKey(p);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  for (const [key, group] of groups) {
    if (group.length > 1) {
      const [symbol, entry, exit, ts] = key.split('|');
      duplicates.push({
        symbol,
        entry: parseFloat(entry),
        exit: parseFloat(exit),
        timestamp: ts,
        position_ids: group.map((p) => p.position_id),
        count: group.length,
      });
    }
  }

  for (const p of positions) {
    const mult = Number(p.multiplier ?? 100);
    const side = (p.position_side ?? 'LONG').toUpperCase();
    const computed = calculateRealizedPnL(
      Number(p.entry_price),
      Number(p.exit_price),
      p.quantity,
      side,
      mult
    );
    const stored = Number(p.realized_pnl ?? 0);
    const diff = Math.abs(computed - stored);

    if (diff > PNL_TOLERANCE) {
      mismatches.push({
        position_id: p.position_id,
        symbol: p.symbol,
        stored_pnl: stored,
        computed_pnl: computed,
        diff,
        position_side: side,
      });
    }

    if (Math.abs(stored) > EXTREME_PNL_THRESHOLD) {
      priceAnomalies.push({
        position_id: p.position_id,
        reason: 'extreme_pnl',
        value: stored,
      });
    }
    if (Number(p.entry_price) > OPTION_PRICE_MAX || Number(p.exit_price) > OPTION_PRICE_MAX) {
      priceAnomalies.push({
        position_id: p.position_id,
        reason: 'suspicious_option_price',
        value: Math.max(Number(p.entry_price), Number(p.exit_price)),
      });
    }
  }

  // Report
  console.log('--- P&L Mismatches (stored vs recomputed) ---');
  if (mismatches.length === 0) {
    console.log('None. All closed positions have consistent P&L.\n');
  } else {
    console.log(`Found ${mismatches.length} mismatch(es):\n`);
    for (const m of mismatches) {
      console.log(
        `  ${m.position_id} | ${m.symbol} | side=${m.position_side} | stored=${m.stored_pnl.toFixed(2)} | computed=${m.computed_pnl.toFixed(2)} | diff=${m.diff.toFixed(2)}`
      );
    }
    console.log('');
  }

  console.log('--- Duplicate Trades (same symbol, entry, exit, timestamp) ---');
  if (duplicates.length === 0) {
    console.log('None.\n');
  } else {
    console.log(`Found ${duplicates.length} duplicate group(s):\n`);
    for (const d of duplicates) {
      console.log(
        `  ${d.symbol} | entry=${d.entry} exit=${d.exit} | ${d.count}x | ids: ${d.position_ids.join(', ')}`
      );
    }
    console.log('');
  }

  console.log('--- Price Anomalies ---');
  if (priceAnomalies.length === 0) {
    console.log('None.\n');
  } else {
    console.log(`Found ${priceAnomalies.length} anomaly(ies):\n`);
    for (const a of priceAnomalies) {
      console.log(`  ${a.position_id} | ${a.reason} | value=${a.value}`);
    }
    console.log('');
  }

  const exitCode =
    mismatches.length > 0 || duplicates.length > 0 || priceAnomalies.length > 0 ? 1 : 0;
  console.log(`Audit complete. Exit code: ${exitCode}`);
  process.exit(exitCode);
}

runAudit().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
