/**
 * Diagnose why webhooks aren't reaching decision engines.
 * Run: npx tsx scripts/diagnose-webhook-to-decision.ts
 */

import { db } from '../src/services/database.service.js';
import { config } from '../src/config/index.js';

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('WEBHOOK → DECISION ENGINE DIAGNOSTIC');
  console.log('='.repeat(70));

  // 1. Config
  const enableCron = process.env.ENABLE_CRON_PROCESSING !== 'false';
  const isVercel = !!process.env.VERCEL;
  console.log('\n📋 CONFIG');
  console.log('  ENABLE_ORCHESTRATOR:', config.enableOrchestrator);
  console.log('  NODE_ENV:', config.nodeEnv, config.nodeEnv === 'test' ? '⚠️ Workers disabled in test!' : '');
  console.log('  Orchestrator interval:', config.orchestratorIntervalMs, 'ms');
  console.log('  Batch size:', config.orchestratorBatchSize);
  if (isVercel) {
    console.log('  VERCEL detected — workers do NOT run in serverless. Use cron: POST /api/cron/process-queue');
    console.log('  ENABLE_CRON_PROCESSING:', enableCron ? 'enabled' : 'disabled (cron will skip)');
  }

  // 2. Webhook events (recent)
  const webhooks = await db.query(
    `SELECT status, COUNT(*)::int AS cnt
     FROM webhook_events
     WHERE created_at > NOW() - INTERVAL '24 hours'
       AND COALESCE(is_test, false) = false
     GROUP BY status`
  );
  console.log('\n📥 WEBHOOK EVENTS (last 24h, prod only)');
  if (webhooks.rows.length === 0) {
    console.log('  No webhook events found.');
  } else {
    webhooks.rows.forEach((r: any) => console.log(`  ${r.status}: ${r.cnt}`));
  }

  // 3. Signals - pending vs processed
  const signals = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE processed = FALSE AND (status IS NULL OR status = 'pending')) AS pending,
       COUNT(*) FILTER (WHERE processed = TRUE) AS processed,
       COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
       COUNT(*) FILTER (WHERE processing_lock = TRUE) AS locked,
       COUNT(*) FILTER (WHERE queued_until IS NOT NULL AND queued_until > NOW()) AS queued,
       COUNT(*) FILTER (WHERE next_retry_at IS NOT NULL AND next_retry_at > NOW()) AS retry_scheduled
     FROM signals
     WHERE created_at > NOW() - INTERVAL '24 hours'
       AND COALESCE(is_test, false) = false`
  );
  const s = signals.rows[0] as any;
  console.log('\n📊 SIGNALS (last 24h, prod only)');
  console.log('  Pending (eligible for orchestrator):', s?.pending ?? 0);
  console.log('  Processed:', s?.processed ?? 0);
  console.log('  Rejected:', s?.rejected ?? 0);
  console.log('  Stuck (processing_lock=TRUE):', s?.locked ?? 0);
  console.log('  Queued (market closed):', s?.queued ?? 0);
  console.log('  Retry scheduled:', s?.retry_scheduled ?? 0);

  // 4. Why pending signals might not be picked up
  const eligible = await db.query(
    `SELECT COUNT(*)::int AS cnt
     FROM signals
     WHERE processed = FALSE
       AND processing_lock = FALSE
       AND (status IS NULL OR status = 'pending')
       AND (queued_until IS NULL OR queued_until <= NOW())
       AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       AND created_at > NOW() - INTERVAL '24 hours'
       AND COALESCE(is_test, false) = false`
  );
  const eligibleCount = eligible.rows[0]?.cnt ?? 0;
  console.log('\n  ✅ Eligible for orchestrator pickup:', eligibleCount);

  if (eligibleCount > 0 && config.enableOrchestrator) {
    const sample = await db.query(
      `SELECT signal_id, symbol, direction, timeframe, status, processed, processing_lock,
              queued_until, next_retry_at, created_at
       FROM signals
       WHERE processed = FALSE
         AND processing_lock = FALSE
         AND (status IS NULL OR status = 'pending')
         AND (queued_until IS NULL OR queued_until <= NOW())
         AND (next_retry_at IS NULL OR next_retry_at <= NOW())
         AND created_at > NOW() - INTERVAL '24 hours'
         AND COALESCE(is_test, false) = false
       ORDER BY created_at ASC
       LIMIT 3`
    );
    console.log('\n  Sample eligible signals:');
    sample.rows.forEach((r: any) => {
      console.log(`    ${r.signal_id} | ${r.symbol} ${r.direction} ${r.timeframe} | created ${r.created_at}`);
    });
  }

  // 5. Experiments & decisions
  const experiments = await db.query(
    `SELECT COUNT(*)::int AS cnt FROM experiments
     WHERE created_at > NOW() - INTERVAL '24 hours'`
  );
  const decisions = await db.query(
    `SELECT COUNT(*)::int AS cnt FROM decision_recommendations
     WHERE created_at > NOW() - INTERVAL '24 hours'`
  );
  console.log('\n🧪 EXPERIMENTS (last 24h):', experiments.rows[0]?.cnt ?? 0);
  console.log('🎯 DECISION RECOMMENDATIONS (last 24h):', decisions.rows[0]?.cnt ?? 0);

  // 6. Verdict
  console.log('\n' + '-'.repeat(70));
  console.log('VERDICT');
  console.log('-'.repeat(70));

  if (config.nodeEnv === 'test') {
    console.log('\n❌ NODE_ENV=test — Workers do NOT start. Use NODE_ENV=development or production.');
    process.exit(1);
  }
  if (isVercel && enableCron) {
    console.log('\n⚠️ On Vercel: Ensure a cron job calls POST /api/cron/process-queue every 2–3 min.');
    console.log('   Set CRON_SECRET and pass it in Authorization: Bearer <secret> or x-cron-secret header.');
  }
  if (!config.enableOrchestrator) {
    console.log('\n❌ ENABLE_ORCHESTRATOR=false — Orchestrator worker is disabled.');
    process.exit(1);
  }
  if ((webhooks.rows.find((r: any) => r.status === 'accepted')?.cnt ?? 0) === 0) {
    console.log('\n⚠️ No accepted webhooks in last 24h. Webhooks may be failing validation or are test-only.');
  }
  if (eligibleCount > 0 && (experiments.rows[0]?.cnt ?? 0) === 0) {
    console.log('\n❌ Pending signals exist but no experiments — Orchestrator is NOT picking them up.');
    console.log('   Check: Is the server running? Are workers started? Check logs for "Orchestrator batch processed".');
    console.log('   Stuck locks: Run "UPDATE signals SET processing_lock = FALSE WHERE processing_lock = TRUE" if needed.');
  }
  if (eligibleCount === 0 && (s?.pending ?? 0) > 0) {
    console.log('\n⚠️ Signals are pending but NOT eligible (queued, locked, or retry scheduled).');
    if ((s?.queued ?? 0) > 0) {
      console.log('   → Some signals are queued until market open (queued_until > NOW()).');
    }
    if ((s?.locked ?? 0) > 0) {
      console.log('   → Some signals have processing_lock=TRUE (orchestrator may have crashed mid-run).');
    }
  }
  if (eligibleCount === 0 && (s?.pending ?? 0) === 0 && (webhooks.rows.find((r: any) => r.status === 'accepted')?.cnt ?? 0) > 0) {
    console.log('\n✅ All accepted webhooks have been processed (or rejected).');
    console.log('   If decisions are still missing, check: enrichment rejection, risk veto, engine errors.');
  }

  console.log('\n');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
