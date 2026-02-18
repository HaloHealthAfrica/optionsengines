/**
 * EOD Audit Runner — Produces full end-of-day trading + platform audit report.
 * Usage: DATABASE_URL='...' tsx scripts/run-eod-audit.ts [YYYY-MM-DD]
 */

import 'dotenv/config';
import { db } from '../src/services/database.service.js';
import { runTradeAudit } from '../src/services/trade-audit.service.js';

const AUDIT_DATE = process.argv[2] || new Date().toISOString().slice(0, 10);

async function runQuery<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await db.query(sql, params || []);
  return result.rows as T[];
}

function section(title: string, content: string): string {
  return `\n## ${title}\n\n${content}\n`;
}

async function main() {
  const lines: string[] = [];
  lines.push('# OPTIONSENGINE — EOD TRADING + PLATFORM AUDIT REPORT');
  lines.push('');
  lines.push(`**Trading Date**: ${AUDIT_DATE}`);
  lines.push(`**Timezone**: America/New_York`);
  lines.push(`**Generated**: ${new Date().toISOString()}`);
  lines.push('');

  try {
    // 1. EXECUTIVE SUMMARY
    const totalPnl = await runQuery<{ total_pnl: string }>(
      `SELECT COALESCE(SUM(realized_pnl), 0)::text AS total_pnl
       FROM refactored_positions
       WHERE exit_timestamp::date = $1::date AND status = 'closed' AND COALESCE(is_test, false) = false`,
      [AUDIT_DATE]
    );
    const perf = await runQuery<{ closed_trades: string; win_rate: string; avg_win_r: string; avg_loss_r: string }>(
      `SELECT COUNT(*)::text AS closed_trades,
        COALESCE(SUM(CASE WHEN pnl_r > 0 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0)::text AS win_rate,
        COALESCE(AVG(CASE WHEN pnl_r > 0 THEN pnl_r END), 0)::text AS avg_win_r,
        COALESCE(AVG(CASE WHEN pnl_r < 0 THEN pnl_r END), 0)::text AS avg_loss_r
       FROM bias_trade_performance
       WHERE created_at::date = $1::date AND COALESCE(source, 'live') = 'live'`,
      [AUDIT_DATE]
    );
    const tradesOpened = await runQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM refactored_positions
       WHERE entry_timestamp::date = $1::date AND COALESCE(is_test, false) = false`,
      [AUDIT_DATE]
    );
    const tradesClosed = await runQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM refactored_positions
       WHERE exit_timestamp::date = $1::date AND status = 'closed' AND COALESCE(is_test, false) = false`,
      [AUDIT_DATE]
    );
    const tradesRejected = await runQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM signals
       WHERE created_at::date = $1::date AND status = 'rejected' AND COALESCE(is_test, false) = false`,
      [AUDIT_DATE]
    );

    const pnl = parseFloat(totalPnl[0]?.total_pnl || '0');
    const p = perf[0];
    const closed = parseInt(p?.closed_trades || '0', 10);
    const winRate = parseFloat(p?.win_rate || '0');
    const avgWinR = parseFloat(p?.avg_win_r || '0');
    const avgLossR = parseFloat(p?.avg_loss_r || '0');
    const opened = parseInt(tradesOpened[0]?.count || '0', 10);
    const closedCount = parseInt(tradesClosed[0]?.count || '0', 10);
    const rejected = parseInt(tradesRejected[0]?.count || '0', 10);

    lines.push(section('1. EXECUTIVE SUMMARY', [
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Total P&L ($) | ${pnl.toFixed(2)} |`,
      `| Closed trades (bias_trade_performance) | ${closed} |`,
      `| Win rate | ${(winRate * 100).toFixed(1)}% |`,
      `| Avg win R | ${avgWinR.toFixed(2)} |`,
      `| Avg loss R | ${avgLossR.toFixed(2)} |`,
      `| Trades opened | ${opened} |`,
      `| Trades closed | ${closedCount} |`,
      `| Trades rejected (signals) | ${rejected} |`,
    ].join('\n')));

    // 2. PIPELINE FUNNEL
    const webhooksReceived = await runQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM webhook_events
       WHERE created_at::date = $1::date AND COALESCE(is_test, false) = false`,
      [AUDIT_DATE]
    );
    const validWebhooks = await runQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM webhook_events
       WHERE created_at::date = $1::date AND status = 'accepted' AND COALESCE(is_test, false) = false`,
      [AUDIT_DATE]
    );
    const invalidByStatus = await runQuery<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text AS count FROM webhook_events
       WHERE created_at::date = $1::date AND COALESCE(is_test, false) = false
         AND status IN ('invalid_signature', 'invalid_payload', 'error', 'duplicate')
       GROUP BY status ORDER BY count DESC`,
      [AUDIT_DATE]
    );
    const signalsCreated = await runQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM signals
       WHERE created_at::date = $1::date AND COALESCE(is_test, false) = false`,
      [AUDIT_DATE]
    );
    const engineVariants = await runQuery<{ variant: string; count: string }>(
      `SELECT e.variant, COUNT(*)::text AS count FROM experiments e
       JOIN signals s ON s.signal_id = e.signal_id
       WHERE s.created_at::date = $1::date AND COALESCE(s.is_test, false) = false
       GROUP BY e.variant`,
      [AUDIT_DATE]
    );
    const ordersCreated = await runQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM orders o
       JOIN signals s ON s.signal_id = o.signal_id
       WHERE s.created_at::date = $1::date AND COALESCE(s.is_test, false) = false`,
      [AUDIT_DATE]
    );
    const ordersFilled = await runQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM trades t
       JOIN orders o ON o.order_id = t.order_id
       JOIN signals s ON s.signal_id = o.signal_id
       WHERE s.created_at::date = $1::date AND COALESCE(s.is_test, false) = false`,
      [AUDIT_DATE]
    );
    const rejectionReasons = await runQuery<{ reason: string; count: string }>(
      `SELECT COALESCE(s.rejection_reason, 'unknown') AS reason, COUNT(*)::text AS count
       FROM signals s
       WHERE s.created_at::date = $1::date AND s.status = 'rejected' AND COALESCE(s.is_test, false) = false
       GROUP BY s.rejection_reason ORDER BY count DESC`,
      [AUDIT_DATE]
    );

    const wr = parseInt(webhooksReceived[0]?.count || '0', 10);
    const vw = parseInt(validWebhooks[0]?.count || '0', 10);
    const sc = parseInt(signalsCreated[0]?.count || '0', 10);
    const oc = parseInt(ordersCreated[0]?.count || '0', 10);
    const of = parseInt(ordersFilled[0]?.count || '0', 10);

    lines.push(section('2. PIPELINE FUNNEL', [
      `| Stage | Count | % of Webhooks |`,
      `|-------|-------|---------------|`,
      `| 1. Webhooks received | ${wr} | 100% |`,
      `| 2. Valid webhooks (accepted) | ${vw} | ${wr ? ((vw / wr) * 100).toFixed(1) : 0}% |`,
      `| 4. Signals created | ${sc} | ${wr ? ((sc / wr) * 100).toFixed(1) : 0}% |`,
      `| 10. Orders created | ${oc} | ${wr ? ((oc / wr) * 100).toFixed(1) : 0}% |`,
      `| 11. Orders filled | ${of} | ${wr ? ((of / wr) * 100).toFixed(1) : 0}% |`,
      '',
      '**Invalid webhooks by status:**',
      invalidByStatus.length ? invalidByStatus.map(r => `- ${r.status}: ${r.count}`).join('\n') : '- none',
      '',
      '**Engine variants (signals evaluated):**',
      engineVariants.length ? engineVariants.map(r => `- Engine ${r.variant}: ${r.count}`).join('\n') : '- none',
      '',
      '**Rejection reasons:**',
      rejectionReasons.length ? rejectionReasons.map(r => `- ${r.reason}: ${r.count}`).join('\n') : '- none',
    ].join('\n')));

    // 3. TRADING QUALITY (closed trades)
    const closedTrades = await runQuery(
      `SELECT rp.position_id, rp.symbol,
        CASE WHEN rp.type = 'call' THEN 'long' ELSE 'short' END AS direction,
        rp.entry_timestamp, rp.exit_timestamp,
        EXTRACT(EPOCH FROM (rp.exit_timestamp - rp.entry_timestamp)) / 60 AS duration_minutes,
        rp.entry_regime_type, rp.engine, rp.entry_confidence_score,
        rp.strike, rp.expiration, rp.entry_price, rp.current_price,
        rp.exit_reason, rp.realized_pnl, rp.r_multiple
       FROM refactored_positions rp
       WHERE rp.exit_timestamp::date = $1::date AND rp.status = 'closed' AND COALESCE(rp.is_test, false) = false
       ORDER BY rp.exit_timestamp`,
      [AUDIT_DATE]
    );

    if (closedTrades.length > 0) {
      lines.push(section('3. TRADING QUALITY REVIEW (ALL CLOSED TRADES)', [
        '| trade_id | symbol | direction | entry | exit | duration_min | pnl$ | pnlR | exit_reason |',
        '|----------|--------|-----------|-------|------|--------------|------|------|-------------|',
        ...closedTrades.map((r: Record<string, unknown>) =>
          `| ${r.position_id} | ${r.symbol} | ${r.direction} | ${r.entry_timestamp} | ${r.exit_timestamp} | ${Number(r.duration_minutes || 0).toFixed(0)} | ${r.realized_pnl ?? '—'} | ${r.r_multiple ?? '—'} | ${r.exit_reason ?? '—'} |`
        ),
      ].join('\n')));
    } else {
      lines.push(section('3. TRADING QUALITY REVIEW', 'No closed trades for this date.'));
    }

    // 4. TRADE AUDIT (violations, recommendations)
    const tradeAudit = await runTradeAudit(AUDIT_DATE);
    lines.push(section('4. TRADE AUDIT (violations & recommendations)', [
      `**Audit trail rows**: ${tradeAudit.auditTrail.length}`,
      `**Violations**: ${tradeAudit.violations.length}`,
      '',
      '**Violation summary:**',
      Object.entries(tradeAudit.violationSummary).length
        ? Object.entries(tradeAudit.violationSummary).map(([k, v]) => `- ${k}: ${v}`).join('\n')
        : '- none',
      '',
      '**Recommendations:**',
      tradeAudit.recommendations.map(r => `- ${r}`).join('\n'),
    ].join('\n')));

    // 5. WEBHOOK INGESTION (invalid payloads)
    const invalidPayloads = await runQuery(
      `SELECT event_id, status, error_message, symbol, created_at
       FROM webhook_events
       WHERE created_at::date = $1::date AND status IN ('invalid_payload', 'invalid_signature', 'error')
         AND COALESCE(is_test, false) = false
       ORDER BY created_at DESC LIMIT 20`,
      [AUDIT_DATE]
    );
    lines.push(section('5. WEBHOOK INGESTION (invalid/error)', [
      invalidPayloads.length
        ? invalidPayloads.map((r: Record<string, unknown>) =>
            `- ${r.event_id} | ${r.status} | ${r.error_message || '—'} | ${r.symbol || '—'} | ${r.created_at}`
          ).join('\n')
        : '- No invalid/error webhooks for this date.',
    ].join('\n')));

    // 6. INSTRUMENTATION GAPS
    lines.push(section('6. NOTES', [
      '- Sentry issues: Not queried (external). Check Sentry dashboard for errors.',
      '- Provider logs (TwelveData, MarketData.app, UnusualWhales): Not in DB; check application logs.',
      '- Worker/orchestrator logs: Not in DB; check deployment logs.',
    ].join('\n')));

    const report = lines.join('\n');
    console.log(report);

    // Write to file
    const fs = await import('fs/promises');
    const path = await import('path');
    const outDir = path.resolve(process.cwd(), 'tmp');
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `eod-audit-report-${AUDIT_DATE}.md`);
    await fs.writeFile(outPath, report, 'utf8');
    console.error(`\nReport written to: ${outPath}`);
  } catch (err) {
    console.error('Audit failed:', err);
    throw err;
  } finally {
    await db.close?.();
  }
}

main();
