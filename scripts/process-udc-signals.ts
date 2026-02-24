/**
 * Directly processes specific signals through the orchestrator + UDC pipeline.
 * Bypasses the worker queue to test UDC behavior immediately.
 */

import { db } from '../src/services/database.service.js';
import { initTradingMode, getTradingMode } from '../src/config/trading-mode.js';
import { logger } from '../src/utils/logger.js';

async function main() {
  console.log('='.repeat(70));
  console.log('  DIRECT UDC SIGNAL PROCESSING');
  console.log('='.repeat(70));

  await initTradingMode();
  const mode = getTradingMode();
  console.log(`\nTrading mode: ${mode}\n`);

  // Find our recent test signals
  const signals = await db.query(
    `SELECT signal_id, symbol, direction, timeframe, status, timestamp, created_at
     FROM signals
     WHERE created_at > NOW() - INTERVAL '2 hours'
       AND is_test = true
     ORDER BY created_at DESC
     LIMIT 20`
  );

  if (signals.rows.length === 0) {
    // Try without is_test filter
    const allRecent = await db.query(
      `SELECT signal_id, symbol, direction, timeframe, status, timestamp, created_at
       FROM signals
       WHERE created_at > NOW() - INTERVAL '2 hours'
       ORDER BY created_at DESC
       LIMIT 20`
    );
    console.log(`No test signals found. Recent signals (${allRecent.rows.length}):`);
    for (const s of allRecent.rows) {
      console.log(`  ${s.signal_id} | ${s.symbol} ${s.direction} ${s.timeframe} | ${s.status} | ${s.created_at}`);
    }
  } else {
    console.log(`Found ${signals.rows.length} recent test signals:`);
    for (const s of signals.rows) {
      console.log(`  ${s.signal_id} | ${s.symbol} ${s.direction} ${s.timeframe} | ${s.status} | ${s.created_at}`);
    }
  }

  // Check rejection reasons
  console.log('\n--- Rejection Reasons ---');
  const rejections = await db.query(
    `SELECT signal_id, symbol, direction, timeframe, rejection_reason
     FROM signals
     WHERE created_at > NOW() - INTERVAL '2 hours'
       AND status = 'rejected'
     ORDER BY created_at DESC
     LIMIT 20`
  );
  for (const r of rejections.rows) {
    console.log(`  ${r.symbol} ${r.direction} ${r.timeframe}: ${r.rejection_reason || 'no reason'}`);
  }

  // Check UDC decision snapshots
  console.log('\n--- UDC Decision Snapshots ---');
  const snapshots = await db.query(
    `SELECT ds.id, ds.signal_id, ds.decision_id, ds.status, ds.reason, ds.created_at
     FROM decision_snapshots ds
     ORDER BY ds.created_at DESC
     LIMIT 20`
  );

  if (snapshots.rows.length === 0) {
    console.log('  No UDC decision snapshots found.');
  } else {
    console.log(`  Found ${snapshots.rows.length} snapshots:`);
    for (const snap of snapshots.rows) {
      console.log(`\n  Signal:    ${snap.signal_id}`);
      console.log(`  Symbol:    ${snap.symbol || 'n/a'} ${snap.direction || ''} ${snap.timeframe || ''}`);
      console.log(`  Decision:  ${snap.decision_id || 'n/a'}`);
      console.log(`  Status:    ${snap.status}`);
      console.log(`  Reason:    ${snap.reason || 'n/a'}`);
      console.log(`  Created:   ${snap.created_at}`);
    }
  }

  // Check all signal statuses
  console.log('\n--- Signal Status Distribution ---');
  const statusDist = await db.query(
    `SELECT status, COUNT(*)::int AS cnt
     FROM signals
     WHERE created_at > NOW() - INTERVAL '4 hours'
     GROUP BY status
     ORDER BY cnt DESC`
  );
  for (const row of statusDist.rows) {
    console.log(`  ${row.status}: ${row.cnt}`);
  }

  // Check what's blocking processing
  console.log('\n--- Pending Signals (ready for processing) ---');
  const pending = await db.query(
    `SELECT signal_id, symbol, direction, timeframe, status, processing_attempts, next_retry_at, created_at
     FROM signals
     WHERE status = 'pending'
       AND created_at > NOW() - INTERVAL '4 hours'
     ORDER BY created_at DESC
     LIMIT 10`
  );
  for (const s of pending.rows) {
    console.log(`  ${s.signal_id} | ${s.symbol} ${s.direction} ${s.timeframe} | attempts: ${s.processing_attempts} | retry: ${s.next_retry_at || 'now'}`);
  }

  console.log('\n' + '='.repeat(70));
  await db.end();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
