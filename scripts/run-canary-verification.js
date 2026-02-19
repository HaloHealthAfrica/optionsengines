#!/usr/bin/env node
/**
 * Phase 4: Canary verification script.
 * Run after enabling Engine B to verify routing and detect issues.
 *
 * Usage: node scripts/run-canary-verification.js [--hours N]
 * Default: 24 hours
 * Requires: DATABASE_URL
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const hours = parseInt(
  process.argv.find((a) => a.startsWith('--hours='))?.split('=')[1] ?? process.env.CANARY_HOURS ?? '24',
  10
);
const interval = `INTERVAL '${hours} hours'`;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  console.log(`\n=== Phase 4 Canary Verification (last ${hours}h) ===\n`);

  let passed = true;

  // 1. Experiments by variant
  const experiments = await pool.query(
    `SELECT variant, COUNT(*)::int AS cnt
     FROM experiments
     WHERE created_at >= NOW() - ${interval}
     GROUP BY variant
     ORDER BY variant`
  );
  const bExperiments = experiments.rows.find((r) => r.variant === 'B')?.cnt ?? 0;
  const aExperiments = experiments.rows.find((r) => r.variant === 'A')?.cnt ?? 0;

  console.log('--- Experiments by variant ---');
  console.table(experiments.rows);
  if (process.env.ENABLE_VARIANT_B === 'true' && Number(process.env.AB_SPLIT_PERCENTAGE ?? 0) > 0) {
    if (bExperiments === 0) {
      console.log('FAIL: Engine B enabled but 0 B experiments (routing may be broken)\n');
      passed = false;
    } else {
      console.log(`PASS: B experiments = ${bExperiments}\n`);
    }
  } else {
    console.log('(Engine B disabled; B=0 expected)\n');
  }

  // 2. Orders by engine
  const orders = await pool.query(
    `SELECT engine, COUNT(*)::int AS cnt
     FROM orders
     WHERE created_at >= NOW() - ${interval}
     GROUP BY engine
     ORDER BY engine`
  );
  const bOrders = orders.rows.find((r) => r.engine === 'B')?.cnt ?? 0;
  const aOrders = orders.rows.find((r) => r.engine === 'A')?.cnt ?? 0;

  console.log('--- Orders by engine ---');
  console.table(orders.rows);
  if (process.env.ENABLE_VARIANT_B === 'true' && Number(process.env.AB_SPLIT_PERCENTAGE ?? 0) > 0) {
    if (bOrders === 0 && bExperiments > 0) {
      console.log('WARN: B experiments exist but 0 B orders (B may be shadow-only)\n');
    } else if (bOrders > 0) {
      console.log(`PASS: B orders = ${bOrders}\n`);
    }
  } else {
    console.log('(Engine B disabled; B=0 expected)\n');
  }

  // 3. Duplicate orders check
  const duplicates = await pool.query(
    `SELECT signal_id, COUNT(*)::int AS order_count
     FROM orders
     WHERE created_at >= NOW() - ${interval}
       AND signal_id IS NOT NULL
     GROUP BY signal_id
     HAVING COUNT(*) > 1`
  );
  const dupCount = duplicates.rows.length;
  if (dupCount > 0) {
    console.log('--- Duplicate orders (FAIL) ---');
    console.table(duplicates.rows);
    console.log(`FAIL: ${dupCount} signal(s) with duplicate orders\n`);
    passed = false;
  } else {
    console.log('--- Duplicate orders ---');
    console.log('PASS: 0 duplicate orders per signal\n');
  }

  // 4. Failed orders
  const failed = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM orders
     WHERE created_at >= NOW() - ${interval}
       AND status = 'failed'`
  );
  const failedCnt = failed.rows[0]?.cnt ?? 0;
  const totalOrders = aOrders + bOrders;
  const failRate = totalOrders > 0 ? (failedCnt / totalOrders) * 100 : 0;
  console.log('--- Failed orders ---');
  console.log(`Failed: ${failedCnt} (${failRate.toFixed(1)}% of ${totalOrders} total)`);
  if (totalOrders > 0 && failRate > 10) {
    console.log('WARN: Failure rate > 10%\n');
  } else {
    console.log('PASS\n');
  }

  console.log('--- Summary ---');
  console.log(passed ? 'Overall: PASS' : 'Overall: FAIL');
  console.log('');

  await pool.end();
  process.exit(passed ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
