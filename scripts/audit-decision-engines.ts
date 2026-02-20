/**
 * Audit decision engines: did they make decisions? If not, why?
 * Usage: npx tsx scripts/audit-decision-engines.ts [YYYY-MM-DD]
 */

import 'dotenv/config';
import { db } from '../src/services/database.service.js';

const AUDIT_DATE = process.argv[2] || new Date().toISOString().slice(0, 10);

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('DECISION ENGINE AUDIT —', AUDIT_DATE);
  console.log('='.repeat(70));

  // 1. Pipeline funnel
  const funnel = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM webhook_events WHERE created_at::date = $1::date AND status = 'accepted' AND COALESCE(is_test, false) = false) AS accepted_webhooks,
       (SELECT COUNT(*) FROM signals WHERE created_at::date = $1::date AND COALESCE(is_test, false) = false) AS signals_total,
       (SELECT COUNT(*) FROM signals WHERE created_at::date = $1::date AND status = 'approved' AND COALESCE(is_test, false) = false) AS signals_approved,
       (SELECT COUNT(*) FROM signals WHERE created_at::date = $1::date AND status = 'rejected' AND COALESCE(is_test, false) = false) AS signals_rejected,
       (SELECT COUNT(*) FROM experiments WHERE created_at::date = $1::date) AS experiments,
       (SELECT COUNT(*) FROM decision_recommendations WHERE created_at::date = $1::date AND is_shadow = false) AS decisions_live,
       (SELECT COUNT(*) FROM decision_recommendations WHERE created_at::date = $1::date AND is_shadow = true) AS decisions_shadow`,
    [AUDIT_DATE]
  );
  const f = funnel.rows[0] as Record<string, string>;
  console.log('\n📊 PIPELINE FUNNEL');
  console.log('  Accepted webhooks:', f.accepted_webhooks);
  console.log('  Signals (total):', f.signals_total);
  console.log('  Signals approved:', f.signals_approved);
  console.log('  Signals rejected:', f.signals_rejected);
  console.log('  Experiments:', f.experiments);
  console.log('  Decision recommendations (live):', f.decisions_live);
  console.log('  Decision recommendations (shadow):', f.decisions_shadow);

  // 2. Rejection reasons (why signals never reached engines)
  const rejections = await db.query(
    `SELECT COALESCE(rejection_reason, 'unknown') AS reason, COUNT(*)::int AS cnt
     FROM signals
     WHERE created_at::date = $1::date AND status = 'rejected' AND COALESCE(is_test, false) = false
     GROUP BY rejection_reason ORDER BY cnt DESC`,
    [AUDIT_DATE]
  );
  console.log('\n🚫 REJECTION REASONS (signals never reached decision engines)');
  if (rejections.rows.length === 0) {
    console.log('  None');
  } else {
    rejections.rows.forEach((r: Record<string, unknown>) => {
      console.log(`  ${r.reason}: ${r.cnt}`);
    });
  }

  // 3. Decisions by engine (if any)
  const byEngine = await db.query(
    `SELECT engine, is_shadow, COUNT(*)::int AS cnt
     FROM decision_recommendations
     WHERE created_at::date = $1::date
     GROUP BY engine, is_shadow ORDER BY engine, is_shadow`,
    [AUDIT_DATE]
  );
  console.log('\n🎯 DECISIONS BY ENGINE');
  if (byEngine.rows.length === 0) {
    console.log('  None');
  } else {
    byEngine.rows.forEach((r: Record<string, unknown>) => {
      console.log(`  Engine ${r.engine} (shadow=${r.is_shadow}): ${r.cnt}`);
    });
  }

  // 4. Experiments without decisions
  const expNoDec = await db.query(
    `SELECT e.experiment_id, e.signal_id, e.variant, e.created_at
     FROM experiments e
     LEFT JOIN decision_recommendations dr ON dr.experiment_id = e.experiment_id AND dr.is_shadow = false
     WHERE e.created_at::date = $1::date
       AND dr.recommendation_id IS NULL
     LIMIT 10`,
    [AUDIT_DATE]
  );
  if (expNoDec.rows.length > 0) {
    console.log('\n⚠️ EXPERIMENTS WITHOUT LIVE DECISIONS (sample)');
    expNoDec.rows.forEach((r: Record<string, unknown>) => {
      console.log(`  ${r.experiment_id} | signal=${r.signal_id} | variant=${r.variant}`);
    });
  }

  // 5. Refactored signals rejection (enrichment-level)
  const refRej = await db.query(
    `SELECT COALESCE(rs.rejection_reason, 'none') AS reason, COUNT(*)::int AS cnt
     FROM refactored_signals rs
     JOIN signals s ON s.signal_id = rs.signal_id
     WHERE s.created_at::date = $1::date AND rs.rejection_reason IS NOT NULL
     GROUP BY rs.rejection_reason`,
    [AUDIT_DATE]
  );
  if (refRej.rows.length > 0) {
    console.log('\n📋 REFACTORED_SIGNALS (enrichment) rejections');
    refRej.rows.forEach((r: Record<string, unknown>) => console.log(`  ${r.reason}: ${r.cnt}`));
  }

  // 6. Root cause summary
  console.log('\n' + '-'.repeat(70));
  console.log('ROOT CAUSE SUMMARY');
  console.log('-'.repeat(70));

  const rejTotal = parseInt(f.signals_rejected || '0', 10);
  const expTotal = parseInt(f.experiments || '0', 10);
  const decTotal = parseInt(f.decisions_live || '0', 10);

  if (rejTotal > 0) {
    const topReason = (rejections.rows[0] as Record<string, unknown>)?.reason as string;
    const topCnt = (rejections.rows[0] as Record<string, unknown>)?.cnt as number;
    console.log(`\n1. ${rejTotal} signals REJECTED before reaching engines.`);
    console.log(`   Top reason: ${topReason} (${topCnt})`);
    if (topReason === 'market_data_unavailable') {
      console.log('   → Price/candles/indicators fetch failed. Check MarketData.app, TwelveData, Polygon API.');
    }
    if (topReason === 'confluence_below_threshold') {
      console.log('   → Options flow + gamma confluence gate failed. Check flow config, GEX data.');
    }
    if (topReason === 'signal_stale') {
      console.log('   → Signal exceeded max age. Check signalMaxAgeMinutes.');
    }
  }

  if (expTotal > 0 && decTotal === 0) {
    console.log(`\n2. ${expTotal} experiments created but 0 decisions persisted.`);
    console.log('   → Engines may have returned null, or persistRecommendation failed.');
    console.log('   → Check logs for "Engine B returned no recommendation" or engine errors.');
  }

  if (expTotal === 0 && parseInt(f.signals_approved || '0', 10) === 0) {
    console.log('\n3. No approved signals → no experiments → no decisions.');
    console.log('   All signals rejected at enrichment/risk stage.');
  }

  console.log('\n');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
