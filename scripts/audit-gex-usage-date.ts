/**
 * Audit GEX/Gamma usage for a specific date.
 * Usage: npx tsx scripts/audit-gex-usage-date.ts [YYYY-MM-DD]
 * Default: 2026-02-17
 */
import { db } from '../src/services/database.service.js';

const TARGET_DATE = process.argv[2] || '2026-02-17';

async function main() {
  console.log(`\n=== GEX/Gamma Usage Audit for ${TARGET_DATE} ===\n`);

  // 1. GEX snapshots persisted on target date
  const { rows: gexSnaps } = await db.query(`
    SELECT symbol, source, net_gex, zero_gamma_level, dealer_position, created_at
    FROM gex_snapshots
    WHERE created_at >= $1::date AND created_at < $1::date + interval '1 day'
    ORDER BY created_at DESC
  `, [TARGET_DATE]);

  console.log('1. GEX Snapshots (persisted to gex_snapshots):');
  if (gexSnaps.length === 0) {
    console.log('   None found for this date.\n');
  } else {
    console.log(`   Count: ${gexSnaps.length}`);
    for (const g of gexSnaps.slice(0, 15)) {
      console.log(`   - ${g.symbol} | source: ${g.source} | net_gex: ${g.net_gex} | dealer: ${g.dealer_position} | ${g.created_at}`);
    }
    if (gexSnaps.length > 15) console.log(`   ... and ${gexSnaps.length - 15} more\n`);
    else console.log('');
  }

  // 2. Signals with GEX in enrichment (refactored_signals)
  const { rows: signalsWithGex } = await db.query(`
    SELECT rs.signal_id, s.symbol, rs.processed_at,
           rs.enriched_data->'gex'->>'netGex' as net_gex,
           rs.enriched_data->'gex'->>'dealerPosition' as dealer_position,
           rs.enriched_data->'gex'->>'source' as gex_source
    FROM refactored_signals rs
    JOIN signals s ON s.signal_id = rs.signal_id
    WHERE rs.enriched_data->'gex' IS NOT NULL
      AND rs.processed_at >= $1::date AND rs.processed_at < $1::date + interval '1 day'
    ORDER BY rs.processed_at DESC
    LIMIT 20
  `, [TARGET_DATE]);

  console.log('2. Signals with GEX in enrichment (refactored_signals):');
  if (signalsWithGex.length === 0) {
    console.log('   None found for this date.\n');
  } else {
    console.log(`   Count: ${signalsWithGex.length}`);
    for (const s of signalsWithGex.slice(0, 10)) {
      console.log(`   - ${s.signal_id?.slice(0, 8)}... | ${s.symbol} | net_gex: ${s.net_gex} | dealer: ${s.dealer_position} | ${s.processed_at}`);
    }
    if (signalsWithGex.length > 10) console.log(`   ... and ${signalsWithGex.length - 10} more\n`);
    else console.log('');
  }

  // 3. Webhook events processed on target date (signals that triggered enrichment)
  const { rows: webhookStats } = await db.query(`
    SELECT status, COUNT(*)::int as cnt
    FROM webhook_events
    WHERE created_at >= $1::date AND created_at < $1::date + interval '1 day'
    GROUP BY status
  `, [TARGET_DATE]);

  const { rows: webhookTotal } = await db.query(`
    SELECT COUNT(*)::int as total
    FROM webhook_events
    WHERE created_at >= $1::date AND created_at < $1::date + interval '1 day'
  `, [TARGET_DATE]);

  console.log('3. Webhook events on target date:');
  console.log(`   Total: ${webhookTotal[0]?.total ?? 0}`);
  for (const w of webhookStats) {
    console.log(`   - ${w.status}: ${w.cnt}`);
  }
  console.log('');

  // 4. Refactored signals total for date
  const { rows: signalStats } = await db.query(`
    SELECT COUNT(*)::int as total,
           COUNT(*) FILTER (WHERE enriched_data->'gex' IS NOT NULL) as with_gex
    FROM refactored_signals
    WHERE processed_at >= $1::date AND processed_at < $1::date + interval '1 day'
  `, [TARGET_DATE]);

  console.log('4. Refactored signals on target date:');
  console.log(`   Total: ${signalStats[0]?.total ?? 0}`);
  console.log(`   With GEX in enrichment: ${signalStats[0]?.with_gex ?? 0}`);
  console.log('');

  // 5. Check source of GEX fetches (non-zero vs all-zero)
  const { rows: gexSourceBreakdown } = await db.query(`
    SELECT source, 
           COUNT(*)::int as cnt,
           COUNT(*) FILTER (WHERE net_gex != 0) as non_zero
    FROM gex_snapshots
    WHERE created_at >= $1::date AND created_at < $1::date + interval '1 day'
    GROUP BY source
  `, [TARGET_DATE]);

  console.log('5. GEX source breakdown:');
  for (const g of gexSourceBreakdown) {
    console.log(`   - ${g.source}: ${g.cnt} total, ${g.non_zero} with non-zero net_gex`);
  }
  console.log('');

  // 6. Agent decisions / engine invocations (if gammaDecision used)
  const hasAgentDecisions = await db.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'agent_decisions'
    )
  `);
  if (hasAgentDecisions.rows[0]?.exists) {
    const { rows: agentStats } = await db.query(`
      SELECT COUNT(*)::int as total
      FROM agent_decisions
      WHERE created_at >= $1::date AND created_at < $1::date + interval '1 day'
    `, [TARGET_DATE]);
    console.log('6. Agent decisions on target date:');
    console.log(`   Total: ${agentStats[0]?.total ?? 0}`);
    console.log('');
  }

  // Summary
  console.log('=== Summary ===');
  const gexUsed = (gexSnaps.length > 0) || (signalsWithGex.length > 0);
  console.log(`GEX/Gamma was ${gexUsed ? 'USED' : 'NOT USED'} on ${TARGET_DATE}.`);
  if (gexSnaps.length > 0) {
    console.log(`- ${gexSnaps.length} GEX snapshot(s) persisted`);
  }
  if (signalsWithGex.length > 0) {
    console.log(`- ${signalsWithGex.length} signal(s) had GEX in enrichment`);
  }
  if (!gexUsed && (webhookTotal[0]?.total ?? 0) > 0) {
    console.log('- Webhooks were processed but no GEX data was captured (enrichment may have failed or bypassed)');
  }
  if (!gexUsed && (webhookTotal[0]?.total ?? 0) === 0) {
    console.log('- No webhook events for this date');
  }
  console.log('');

  process.exit(0);
}

main().catch((e) => {
  console.error('Audit failed:', e.message);
  process.exit(1);
});
