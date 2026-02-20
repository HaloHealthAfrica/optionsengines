/**
 * Trace successful (closed) trades from webhook through to position.
 * Validates: webhook → signal → enrichment → experiment → decision → order → trade → position
 *
 * Usage: npx tsx scripts/trace-successful-trades.ts [YYYY-MM-DD] [--limit N] [--out FILE]
 *   --out FILE  Write report to file (default: stdout)
 */

import 'dotenv/config';
import { db } from '../src/services/database.service.js';

const DATE_ARG = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const LIMIT_ARG = process.argv.includes('--limit')
  ? parseInt(process.argv[process.argv.indexOf('--limit') + 1] || '5', 10)
  : 5;
const AUDIT_DATE = DATE_ARG || new Date().toISOString().slice(0, 10);

interface TraceRow {
  layer: string;
  id: string;
  data: Record<string, unknown>;
  valid: boolean;
  gap?: string;
}

function formatRow(row: Record<string, unknown>): string {
  return Object.entries(row)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `    ${k}: ${v}`)
    .join('\n');
}

async function tracePosition(positionId: string, signalId: string): Promise<TraceRow[]> {
  const rows: TraceRow[] = [];

  // 1. Webhook
  const webhook = await db.query(
    `SELECT event_id, request_id, signal_id, status, symbol, direction, timeframe, error_message, created_at
     FROM webhook_events WHERE signal_id = $1`,
    [signalId]
  );
  const wh = webhook.rows[0] as Record<string, unknown> | undefined;
  rows.push({
    layer: '1. WEBHOOK',
    id: wh?.request_id as string,
    data: wh || {},
    valid: !!wh && wh.status === 'accepted',
    gap: !wh ? 'No webhook for signal' : wh.status !== 'accepted' ? `status=${wh.status}` : undefined,
  });

  // 2. Signal
  const signal = await db.query(
    `SELECT signal_id, symbol, direction, timeframe, status, rejection_reason, processed, experiment_id, created_at
     FROM signals WHERE signal_id = $1`,
    [signalId]
  );
  const sig = signal.rows[0] as Record<string, unknown> | undefined;
  rows.push({
    layer: '2. SIGNAL',
    id: signalId,
    data: sig || {},
    valid: !!sig && sig.status === 'approved',
    gap: !sig ? 'Signal missing' : sig.status !== 'approved' ? `status=${sig.status} reason=${sig.rejection_reason}` : undefined,
  });

  // 3. Refactored (enrichment)
  const refactored = await db.query(
    `SELECT refactored_signal_id, signal_id, risk_check_result, rejection_reason, processed_at
     FROM refactored_signals WHERE signal_id = $1`,
    [signalId]
  );
  const ref = refactored.rows[0] as Record<string, unknown> | undefined;
  rows.push({
    layer: '3. ENRICHMENT',
    id: ref?.refactored_signal_id as string,
    data: ref || {},
    valid: !!ref && !ref.rejection_reason,
    gap: !ref ? 'No refactored_signal' : ref.rejection_reason ? `rejected: ${ref.rejection_reason}` : undefined,
  });

  // 4. Experiment
  const exp = await db.query(
    `SELECT experiment_id, signal_id, variant, assignment_hash, created_at
     FROM experiments WHERE signal_id = $1`,
    [signalId]
  );
  const expRow = exp.rows[0] as Record<string, unknown> | undefined;
  rows.push({
    layer: '4. EXPERIMENT',
    id: expRow?.experiment_id as string,
    data: expRow || {},
    valid: !!expRow,
    gap: !expRow ? 'No experiment' : undefined,
  });

  // 5. Decision recommendation
  const rec = await db.query(
    `SELECT recommendation_id, signal_id, engine, strike, expiration, quantity, entry_price, rationale, created_at
     FROM decision_recommendations WHERE signal_id = $1`,
    [signalId]
  );
  const recRows = rec.rows as Record<string, unknown>[];
  rows.push({
    layer: '5. DECISION',
    id: recRows[0]?.recommendation_id as string,
    data: recRows[0] || { count: recRows.length },
    valid: recRows.length > 0,
    gap: recRows.length === 0 ? 'No decision recommendation' : undefined,
  });

  // 6. Order
  const ord = await db.query(
    `SELECT order_id, signal_id, symbol, option_symbol, strike, expiration, type, quantity, status, engine, created_at
     FROM orders WHERE signal_id = $1`,
    [signalId]
  );
  const ordRows = ord.rows as Record<string, unknown>[];
  rows.push({
    layer: '6. ORDER',
    id: ordRows[0]?.order_id as string,
    data: ordRows[0] || { count: ordRows.length },
    valid: ordRows.length > 0 && ordRows.some((o) => o.status === 'filled' || o.status === 'executed'),
    gap: ordRows.length === 0 ? 'No order' : ordRows.every((o) => o.status !== 'filled' && o.status !== 'executed') ? `statuses: ${ordRows.map((o) => o.status).join(', ')}` : undefined,
  });

  // 7. Trade (fill)
  const trd = await db.query(
    `SELECT t.trade_id, t.order_id, t.fill_price, t.fill_quantity, t.fill_timestamp
     FROM trades t JOIN orders o ON o.order_id = t.order_id WHERE o.signal_id = $1`,
    [signalId]
  );
  const trdRows = trd.rows as Record<string, unknown>[];
  rows.push({
    layer: '7. TRADE',
    id: trdRows[0]?.trade_id as string,
    data: trdRows[0] || { count: trdRows.length },
    valid: trdRows.length > 0,
    gap: trdRows.length === 0 ? 'No trade fill' : undefined,
  });

  // 8. Position (already have it)
  const pos = await db.query(
    `SELECT position_id, symbol, option_symbol, strike, expiration, entry_price, exit_price, quantity, status, realized_pnl, entry_timestamp, exit_timestamp
     FROM refactored_positions WHERE position_id = $1`,
    [positionId]
  );
  const posRow = pos.rows[0] as Record<string, unknown>;
  rows.push({
    layer: '8. POSITION',
    id: positionId,
    data: posRow || {},
    valid: !!posRow && posRow.status === 'closed',
    gap: !posRow ? 'Position missing' : posRow.status !== 'closed' ? `status=${posRow.status}` : undefined,
  });

  return rows;
}

async function main() {
  const positions = await db.query(
    `WITH recent AS (
       SELECT position_id, symbol, type, option_symbol, experiment_id, entry_timestamp, exit_timestamp, realized_pnl, status
       FROM refactored_positions
       WHERE status = 'closed' AND COALESCE(is_test, false) = false AND exit_timestamp::date = $1::date
       ORDER BY exit_timestamp DESC LIMIT $2
     )
     SELECT r.position_id, COALESCE(o.signal_id, e.signal_id) AS signal_id, COALESCE(s.direction, CASE WHEN r.type = 'call' THEN 'long' ELSE 'short' END) AS direction, r.symbol, r.type, r.entry_timestamp, r.exit_timestamp, r.realized_pnl, r.status
     FROM recent r
     LEFT JOIN orders o ON o.option_symbol = r.option_symbol
     LEFT JOIN experiments e ON e.experiment_id = r.experiment_id
     LEFT JOIN signals s ON s.signal_id = COALESCE(o.signal_id, e.signal_id)`,
    [AUDIT_DATE, LIMIT_ARG]
  );

  const rows = positions.rows as Array<{ position_id: string; signal_id: string | null; direction: string; symbol: string; type: string; entry_timestamp: Date; exit_timestamp: Date; realized_pnl: number | null; status: string }>;
  const seen = new Set<string>();
  const uniqueRows = rows.filter((r) => {
    if (seen.has(r.position_id)) return false;
    seen.add(r.position_id);
    return true;
  }).filter((r) => r.signal_id != null) as Array<{ position_id: string; signal_id: string; direction: string; symbol: string; type: string; entry_timestamp: Date; exit_timestamp: Date; realized_pnl: number | null; status: string }>;

  if (uniqueRows.length === 0) {
    console.log(`\nNo closed positions for ${AUDIT_DATE}. Trying last 7 days...\n`);
    const fallback = await db.query(
      `WITH recent AS (
         SELECT position_id, symbol, type, option_symbol, experiment_id, entry_timestamp, exit_timestamp, realized_pnl, status
         FROM refactored_positions
         WHERE status = 'closed' AND COALESCE(is_test, false) = false
         ORDER BY exit_timestamp DESC LIMIT $1
       )
       SELECT r.position_id, COALESCE(o.signal_id, e.signal_id) AS signal_id, COALESCE(s.direction, CASE WHEN r.type = 'call' THEN 'long' ELSE 'short' END) AS direction, r.symbol, r.type, r.entry_timestamp, r.exit_timestamp, r.realized_pnl, r.status
       FROM recent r
       LEFT JOIN orders o ON o.option_symbol = r.option_symbol
       LEFT JOIN experiments e ON e.experiment_id = r.experiment_id
       LEFT JOIN signals s ON s.signal_id = COALESCE(o.signal_id, e.signal_id)`,
      [LIMIT_ARG]
    );
    const fallbackRows = fallback.rows as Array<{ position_id: string; signal_id: string | null; direction: string; symbol: string; type: string; entry_timestamp: Date; exit_timestamp: Date; realized_pnl: number | null; status: string }>;
    const seenFb = new Set<string>();
    const uniqueFallback = fallbackRows
      .filter((r) => {
        if (seenFb.has(r.position_id)) return false;
        seenFb.add(r.position_id);
        return true;
      })
      .filter((r) => r.signal_id != null) as Array<{ position_id: string; signal_id: string; direction: string; symbol: string; type: string; entry_timestamp: Date; exit_timestamp: Date; realized_pnl: number | null; status: string }>;
    if (uniqueFallback.length === 0) {
      const seenAny = new Set<string>();
      const totalPositions = fallbackRows.filter((r) => {
        if (seenAny.has(r.position_id)) return false;
        seenAny.add(r.position_id);
        return true;
      }).length;
      if (totalPositions > 0) {
        console.log(`${totalPositions} closed position(s) found but signal_id not resolvable via orders/experiments join.`);
        console.log('Use EOD report for trade details. Trace requires order.option_symbol = position.option_symbol.');
      } else {
        console.log('No closed positions found in database.');
      }
      process.exit(0);
      return;
    }
    console.log(`Using ${uniqueFallback.length} most recent closed positions:\n`);
    for (const p of uniqueFallback) {
      const traces = await tracePosition(p.position_id, p.signal_id);
      const allValid = traces.every((t) => t.valid);
      const icon = allValid ? '✅' : '⚠️';
      console.log('═'.repeat(70));
      console.log(`${icon} ${p.symbol} ${p.direction} | PnL=${p.realized_pnl ?? '—'} | exit=${p.exit_timestamp}`);
      console.log(`   position_id=${p.position_id} signal_id=${p.signal_id}`);
      for (const t of traces) {
        const v = t.valid ? '✓' : '✗';
        console.log(`\n   ${v} ${t.layer} ${t.gap ? `— ${t.gap}` : ''}`);
        if (Object.keys(t.data).length > 0 && Object.keys(t.data).length < 15) {
          console.log(formatRow(t.data));
        }
      }
      console.log('\n');
    }
  } else {
    console.log(`\nTracing ${rows.length} closed positions for ${AUDIT_DATE}:\n`);
    for (const p of rows) {
      const traces = await tracePosition(p.position_id, p.signal_id);
      const allValid = traces.every((t) => t.valid);
      const icon = allValid ? '✅' : '⚠️';
      console.log('═'.repeat(70));
      console.log(`${icon} ${p.symbol} ${p.direction} | PnL=${p.realized_pnl ?? '—'} | exit=${p.exit_timestamp}`);
      console.log(`   position_id=${p.position_id} signal_id=${p.signal_id}`);
      for (const t of traces) {
        const v = t.valid ? '✓' : '✗';
        console.log(`\n   ${v} ${t.layer} ${t.gap ? `— ${t.gap}` : ''}`);
        if (Object.keys(t.data).length > 0 && Object.keys(t.data).length < 15) {
          console.log(formatRow(t.data));
        }
      }
      console.log('\n');
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
