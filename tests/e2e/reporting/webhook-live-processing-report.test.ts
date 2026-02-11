import fs from 'fs/promises';
import path from 'path';
import { db } from '../../../src/services/database.service.js';

type StageStatus = 'ok' | 'failed' | 'skipped' | 'pending';

type Stage = {
  name: string;
  status: StageStatus;
  detail?: string;
};

type WebhookDetail = {
  event_id: string;
  request_id: string;
  webhook_status: string;
  error_message: string | null;
  webhook_symbol: string | null;
  webhook_direction: string | null;
  webhook_timeframe: string | null;
  processing_time_ms: number | null;
  webhook_created_at: string;
  signal_id: string | null;
  experiment_id: string | null;
  webhook_variant: string | null;
  signal_symbol: string | null;
  signal_direction: string | null;
  signal_timeframe: string | null;
  signal_status: string | null;
  signal_rejection_reason: string | null;
  signal_processed: boolean | null;
  signal_experiment_id: string | null;
  signal_created_at: string | null;
  raw_payload: any | null;
  enrichment_rejection_reason: string | null;
  enriched_data: any | null;
  risk_check_result: any | null;
  enrichment_processed_at: string | null;
  context_id: string | null;
  market_current_price: number | null;
  market_volume: number | null;
  market_indicators: any | null;
  market_context_hash: string | null;
  market_context_created_at: string | null;
  experiment_variant: string | null;
  experiment_assignment_hash: string | null;
  experiment_split_percentage: string | null;
  experiment_policy_version: string | null;
  experiment_created_at: string | null;
  execution_mode: string | null;
  executed_engine: string | null;
  shadow_engine: string | null;
  policy_reason: string | null;
  policy_version: string | null;
  policy_created_at: string | null;
};

type RecommendationRow = {
  signal_id: string;
  engine: string;
  strike: string | null;
  expiration: string | null;
  quantity: number | null;
  entry_price: string | null;
  is_shadow: boolean | null;
  rationale: any | null;
  created_at: string;
};

type OrderRow = {
  order_id: string;
  signal_id: string | null;
  order_type: string;
  status: string;
  engine: string | null;
  created_at: string;
  option_symbol: string;
};

type TradeRow = {
  order_id: string;
  fill_price: string;
  fill_quantity: number;
  fill_timestamp: string;
};

type Report = {
  generated_at: string;
  report_date: string;
  timezone: string;
  window_start: string;
  window_end: string;
  summary: {
    total_webhooks: number;
    total_signals: number;
    total_webhook_rejections: number;
    total_signal_rejections: number;
    total_processing_gaps: number;
  };
  breakdown: {
    webhook_status_counts: Record<string, number>;
    signal_status_counts: Record<string, number>;
    signal_rejection_reasons: Record<string, number>;
    webhook_error_messages: Record<string, number>;
  };
  processing_gaps: Array<{
    event_id: string;
    request_id: string;
    webhook_status: string;
    signal_id: string | null;
    signal_status: string | null;
    failure_stage: string | null;
    failure_reason: string | null;
  }>;
  orphan_signals: Array<{
    signal_id: string;
    symbol: string;
    timeframe: string;
    status: string;
    rejection_reason: string | null;
    created_at: string;
  }>;
  details: Array<{
    webhook: WebhookDetail;
    stages: Stage[];
    recommendations: RecommendationRow[];
    orders: OrderRow[];
    trades: TradeRow[];
  }>;
};

function formatDateLocal(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateOverride(value?: string | null): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function summarizeKeys(value: any, max: number = 10): string {
  if (!value || typeof value !== 'object') return 'none';
  const keys = Object.keys(value);
  if (keys.length === 0) return 'none';
  const head = keys.slice(0, max);
  const extra = keys.length > max ? ` +${keys.length - max} more` : '';
  return `${head.join(', ')}${extra}`;
}

function formatRiskSummary(risk: any): string {
  if (!risk || typeof risk !== 'object') return 'none';
  const summary = {
    marketOpen: risk.marketOpen,
    openPositions: risk.openPositions,
    openSymbolPositions: risk.openSymbolPositions,
    maxOpenPositions: risk.maxOpenPositions,
    maxPositionsPerSymbol: risk.maxPositionsPerSymbol,
  };
  return JSON.stringify(summary);
}

function extractRejectionReason(detail: WebhookDetail, recommendations: RecommendationRow[]): string | null {
  if (detail.signal_rejection_reason) return detail.signal_rejection_reason;
  if (detail.enrichment_rejection_reason) return detail.enrichment_rejection_reason;
  for (const rec of recommendations) {
    const rationale = rec.rationale || {};
    if (rationale.rejection_reason) {
      return String(rationale.rejection_reason);
    }
  }
  return null;
}

function buildStages(
  detail: WebhookDetail,
  recommendations: RecommendationRow[],
  orders: OrderRow[]
): Stage[] {
  const status = detail.webhook_status;
  const isInvalidSignature = status === 'invalid_signature';
  const isInvalidPayload = status === 'invalid_payload';
  const isDuplicate = status === 'duplicate';
  const isError = status === 'error';
  const stopProcessing = isInvalidSignature || isInvalidPayload || isDuplicate || isError;
  const hasSignal = Boolean(detail.signal_id);
  const hasExperiment = Boolean(detail.experiment_id || detail.signal_experiment_id);
  const hasPolicy = Boolean(detail.execution_mode);
  const hasRecommendations = recommendations.length > 0;
  const hasOrders = orders.length > 0;
  const hasEnrichment =
    Boolean(detail.enriched_data) ||
    Boolean(detail.risk_check_result) ||
    Boolean(detail.context_id) ||
    recommendations.some((rec) => rec.rationale?.enriched_data);
  const rejectionReason = extractRejectionReason(detail, recommendations);

  const stages: Stage[] = [];
  stages.push({
    name: 'webhook_validation',
    status: isInvalidSignature || isInvalidPayload ? 'failed' : 'ok',
    detail: isInvalidSignature
      ? 'invalid_signature'
      : isInvalidPayload
        ? 'invalid_payload'
        : undefined,
  });
  stages.push({
    name: 'deduplication',
    status: isDuplicate ? 'failed' : stopProcessing ? 'skipped' : 'ok',
    detail: isDuplicate ? 'duplicate' : undefined,
  });
  stages.push({
    name: 'signal_persistence',
    status: stopProcessing ? 'skipped' : hasSignal ? 'ok' : 'failed',
    detail: hasSignal ? undefined : 'signal_missing',
  });
  stages.push({
    name: 'enrichment',
    status: stopProcessing ? 'skipped' : hasEnrichment ? 'ok' : 'pending',
    detail: hasEnrichment ? undefined : 'enrichment_missing',
  });
  stages.push({
    name: 'risk_checks',
    status: stopProcessing ? 'skipped' : rejectionReason ? 'failed' : hasEnrichment ? 'ok' : 'pending',
    detail: rejectionReason ? `rejected:${rejectionReason}` : undefined,
  });
  stages.push({
    name: 'experiment_assignment',
    status: stopProcessing ? 'skipped' : hasExperiment ? 'ok' : 'pending',
    detail: hasExperiment ? undefined : 'experiment_missing',
  });
  stages.push({
    name: 'execution_policy',
    status: stopProcessing ? 'skipped' : hasPolicy ? 'ok' : 'pending',
    detail: hasPolicy ? undefined : 'policy_missing',
  });
  stages.push({
    name: 'recommendations',
    status: stopProcessing ? 'skipped' : hasRecommendations ? 'ok' : 'pending',
    detail: hasRecommendations ? undefined : 'recommendations_missing',
  });
  stages.push({
    name: 'order_creation',
    status:
      stopProcessing
        ? 'skipped'
        : detail.signal_status === 'rejected'
          ? 'skipped'
          : hasOrders
            ? 'ok'
            : 'pending',
    detail: hasOrders ? undefined : 'orders_missing',
  });

  return stages;
}

function firstFailure(stages: Stage[]): Stage | null {
  return stages.find((stage) => stage.status === 'failed') || null;
}

function renderReport(report: Report): string {
  const lines: string[] = [];
  lines.push('# Live Webhook Processing Report');
  lines.push('');
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Report Date: ${report.report_date}`);
  lines.push(`Timezone: ${report.timezone}`);
  lines.push(`Window: ${report.window_start} - ${report.window_end}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(`- Total webhooks: ${report.summary.total_webhooks}`);
  lines.push(`- Total signals: ${report.summary.total_signals}`);
  lines.push(`- Webhook rejections: ${report.summary.total_webhook_rejections}`);
  lines.push(`- Signal rejections: ${report.summary.total_signal_rejections}`);
  lines.push(`- Processing gaps: ${report.summary.total_processing_gaps}`);
  lines.push('');
  lines.push('## Webhook Status Breakdown');
  for (const [status, count] of Object.entries(report.breakdown.webhook_status_counts)) {
    lines.push(`- ${status}: ${count}`);
  }
  lines.push('');
  lines.push('## Signal Status Breakdown');
  for (const [status, count] of Object.entries(report.breakdown.signal_status_counts)) {
    lines.push(`- ${status}: ${count}`);
  }
  lines.push('');
  lines.push('## Signal Rejection Reasons');
  if (Object.keys(report.breakdown.signal_rejection_reasons).length === 0) {
    lines.push('- none');
  } else {
    for (const [reason, count] of Object.entries(report.breakdown.signal_rejection_reasons)) {
      lines.push(`- ${reason}: ${count}`);
    }
  }
  lines.push('');
  lines.push('## Webhook Error Messages');
  if (Object.keys(report.breakdown.webhook_error_messages).length === 0) {
    lines.push('- none');
  } else {
    for (const [message, count] of Object.entries(report.breakdown.webhook_error_messages)) {
      lines.push(`- ${message}: ${count}`);
    }
  }
  lines.push('');
  lines.push('## Processing Gaps');
  if (report.processing_gaps.length === 0) {
    lines.push('- none');
  } else {
    for (const gap of report.processing_gaps) {
      lines.push(
        `- ${gap.event_id} status=${gap.webhook_status} signal=${gap.signal_id || 'none'} failure=${gap.failure_stage || 'none'} reason=${gap.failure_reason || 'unknown'}`
      );
    }
  }
  lines.push('');
  lines.push('## Orphan Signals (no webhook event)');
  if (report.orphan_signals.length === 0) {
    lines.push('- none');
  } else {
    for (const signal of report.orphan_signals) {
      lines.push(
        `- ${signal.signal_id} ${signal.symbol} ${signal.timeframe} status=${signal.status} rejection=${signal.rejection_reason || 'none'} created=${signal.created_at}`
      );
    }
  }
  lines.push('');
  lines.push('## Event Details');
  for (const entry of report.details) {
    const detail = entry.webhook;
    const stages = entry.stages;
    const rejectionReason = extractRejectionReason(detail, entry.recommendations);
    lines.push('');
    lines.push(`### ${detail.webhook_created_at} Webhook ${detail.event_id}`);
    lines.push(`- Request ID: ${detail.request_id}`);
    lines.push(`- Status: ${detail.webhook_status}`);
    lines.push(`- Error: ${detail.error_message || 'none'}`);
    lines.push(
      `- Symbol/Timeframe/Direction: ${detail.webhook_symbol || detail.signal_symbol || 'unknown'} ${detail.webhook_timeframe || detail.signal_timeframe || 'unknown'} ${detail.webhook_direction || detail.signal_direction || 'unknown'}`
    );
    lines.push(`- Processing time (ms): ${detail.processing_time_ms ?? 'n/a'}`);
    lines.push(`- Signal: ${detail.signal_id || 'none'} status=${detail.signal_status || 'unknown'} processed=${detail.signal_processed ?? 'n/a'}`);
    lines.push(`- Signal rejection: ${rejectionReason || 'none'}`);
    lines.push(`- Experiment: ${detail.experiment_id || detail.signal_experiment_id || 'none'} variant=${detail.experiment_variant || detail.webhook_variant || 'n/a'}`);
    lines.push(`- Execution policy: ${detail.execution_mode || 'none'} executed=${detail.executed_engine || 'n/a'}`);
    lines.push(`- Enrichment keys: ${summarizeKeys(detail.enriched_data)}`);
    lines.push(`- Risk summary: ${formatRiskSummary(detail.risk_check_result)}`);
    lines.push(`- Market context: ${detail.context_id || 'none'} price=${detail.market_current_price ?? 'n/a'} volume=${detail.market_volume ?? 'n/a'}`);
    lines.push(`- Recommendations: ${entry.recommendations.length}`);
    for (const rec of entry.recommendations) {
      lines.push(
        `- Recommendation ${rec.engine}: strike=${rec.strike || 'n/a'} exp=${rec.expiration || 'n/a'} qty=${rec.quantity ?? 'n/a'} shadow=${rec.is_shadow ?? false}`
      );
    }
    lines.push(`- Orders: ${entry.orders.length}`);
    for (const order of entry.orders) {
      lines.push(
        `- Order ${order.order_id}: type=${order.order_type} status=${order.status} engine=${order.engine || 'n/a'} option=${order.option_symbol}`
      );
    }
    lines.push(`- Trades: ${entry.trades.length}`);
    for (const trade of entry.trades) {
      lines.push(
        `- Trade order=${trade.order_id} qty=${trade.fill_quantity} price=${trade.fill_price} time=${trade.fill_timestamp}`
      );
    }
    lines.push('- Stages:');
    for (const stage of stages) {
      lines.push(`- ${stage.name}: ${stage.status}${stage.detail ? ` (${stage.detail})` : ''}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

describe('Live webhook processing report', () => {
  it('generates a step-by-step report for today', async () => {
    const now = new Date();
    const overrideStart = parseDateOverride(process.env.WEBHOOK_REPORT_DATE);
    const start = overrideStart || new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end = overrideStart
      ? new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999)
      : now;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
    const reportDate = overrideStart ? formatDateLocal(overrideStart) : formatDateLocal(now);
    const detailLimit = Number(process.env.WEBHOOK_REPORT_LIMIT || 0);

    const summaryWebhookStatus = await db.query(
      `SELECT status, COUNT(*)::int AS count
       FROM webhook_events
       WHERE created_at >= $1 AND created_at <= $2
         AND COALESCE(is_test, false) = false
       GROUP BY status`,
      [start, end]
    );
    const summarySignalStatus = await db.query(
      `SELECT status, COUNT(*)::int AS count
       FROM signals
       WHERE created_at >= $1 AND created_at <= $2
         AND COALESCE(is_test, false) = false
       GROUP BY status`,
      [start, end]
    );
    const summarySignalRejections = await db.query(
      `SELECT rejection_reason, COUNT(*)::int AS count
       FROM signals
       WHERE created_at >= $1 AND created_at <= $2
         AND COALESCE(is_test, false) = false
         AND rejection_reason IS NOT NULL
       GROUP BY rejection_reason`,
      [start, end]
    );
    const summaryWebhookErrors = await db.query(
      `SELECT COALESCE(error_message, 'none') AS error_message, COUNT(*)::int AS count
       FROM webhook_events
       WHERE created_at >= $1 AND created_at <= $2
         AND COALESCE(is_test, false) = false
         AND error_message IS NOT NULL
       GROUP BY error_message`,
      [start, end]
    );

    const limitClause = detailLimit > 0 ? `LIMIT ${detailLimit}` : '';
    const webhookDetails = await db.query<WebhookDetail>(
      `SELECT
         we.event_id,
         we.request_id,
         we.status AS webhook_status,
         we.error_message,
         we.symbol AS webhook_symbol,
         we.direction AS webhook_direction,
         we.timeframe AS webhook_timeframe,
         we.processing_time_ms,
         we.created_at AS webhook_created_at,
         we.signal_id,
         we.experiment_id,
         we.variant AS webhook_variant,
         s.symbol AS signal_symbol,
         s.direction AS signal_direction,
         s.timeframe AS signal_timeframe,
         s.status AS signal_status,
         s.rejection_reason AS signal_rejection_reason,
         s.processed AS signal_processed,
         s.experiment_id AS signal_experiment_id,
         s.created_at AS signal_created_at,
         s.raw_payload,
         rs.enriched_data,
         rs.risk_check_result,
         rs.rejection_reason AS enrichment_rejection_reason,
         rs.processed_at AS enrichment_processed_at,
         mc.context_id,
         mc.current_price AS market_current_price,
         mc.volume AS market_volume,
         mc.indicators AS market_indicators,
         mc.context_hash AS market_context_hash,
         mc.created_at AS market_context_created_at,
         e.variant AS experiment_variant,
         e.assignment_hash AS experiment_assignment_hash,
         e.split_percentage AS experiment_split_percentage,
         e.policy_version AS experiment_policy_version,
         e.created_at AS experiment_created_at,
         ep.execution_mode,
         ep.executed_engine,
         ep.shadow_engine,
         ep.reason AS policy_reason,
         ep.policy_version AS policy_version,
         ep.created_at AS policy_created_at
       FROM webhook_events we
       LEFT JOIN signals s ON s.signal_id = we.signal_id
       LEFT JOIN LATERAL (
         SELECT enriched_data, risk_check_result, rejection_reason, processed_at
         FROM refactored_signals rs
         WHERE rs.signal_id = we.signal_id
         ORDER BY processed_at DESC
         LIMIT 1
       ) rs ON true
       LEFT JOIN LATERAL (
         SELECT context_id, current_price, volume, indicators, context_hash, created_at
         FROM market_contexts mc
         WHERE mc.signal_id = we.signal_id
         ORDER BY created_at DESC
         LIMIT 1
       ) mc ON true
       LEFT JOIN experiments e ON e.experiment_id = COALESCE(we.experiment_id, s.experiment_id)
       LEFT JOIN LATERAL (
         SELECT execution_mode, executed_engine, shadow_engine, reason, policy_version, created_at
         FROM execution_policies ep
         WHERE ep.experiment_id = e.experiment_id
         ORDER BY created_at DESC
         LIMIT 1
       ) ep ON true
       WHERE we.created_at >= $1 AND we.created_at <= $2
         AND COALESCE(we.is_test, false) = false
       ORDER BY we.created_at ASC
       ${limitClause}`,
      [start, end]
    );

    const signalIds = Array.from(
      new Set(webhookDetails.rows.map((row) => row.signal_id).filter(Boolean))
    ) as string[];
    const recommendations = signalIds.length
      ? await db.query<RecommendationRow>(
          `SELECT signal_id, engine, strike, expiration, quantity, entry_price, is_shadow, rationale, created_at
           FROM decision_recommendations
           WHERE signal_id = ANY($1::uuid[])
           ORDER BY created_at ASC`,
          [signalIds]
        )
      : { rows: [] as RecommendationRow[] };
    const orders = signalIds.length
      ? await db.query<OrderRow>(
          `SELECT order_id, signal_id, order_type, status, engine, created_at, option_symbol
           FROM orders
           WHERE signal_id = ANY($1::uuid[])
           ORDER BY created_at ASC`,
          [signalIds]
        )
      : { rows: [] as OrderRow[] };
    const trades = signalIds.length
      ? await db.query<TradeRow>(
          `SELECT t.order_id, t.fill_price, t.fill_quantity, t.fill_timestamp
           FROM trades t
           JOIN orders o ON o.order_id = t.order_id
           WHERE o.signal_id = ANY($1::uuid[])
           ORDER BY t.fill_timestamp ASC`,
          [signalIds]
        )
      : { rows: [] as TradeRow[] };

    const recommendationsBySignal = recommendations.rows.reduce((acc, row) => {
      acc[row.signal_id] = acc[row.signal_id] || [];
      acc[row.signal_id].push(row);
      return acc;
    }, {} as Record<string, RecommendationRow[]>);
    const ordersBySignal = orders.rows.reduce((acc, row) => {
      if (!row.signal_id) return acc;
      acc[row.signal_id] = acc[row.signal_id] || [];
      acc[row.signal_id].push(row);
      return acc;
    }, {} as Record<string, OrderRow[]>);
    const tradesByOrder = trades.rows.reduce((acc, row) => {
      acc[row.order_id] = acc[row.order_id] || [];
      acc[row.order_id].push(row);
      return acc;
    }, {} as Record<string, TradeRow[]>);

    const orphanSignals = await db.query(
      `SELECT signal_id, symbol, timeframe, status, rejection_reason, created_at
       FROM signals s
       WHERE created_at >= $1 AND created_at <= $2
         AND COALESCE(is_test, false) = false
         AND NOT EXISTS (
           SELECT 1 FROM webhook_events we WHERE we.signal_id = s.signal_id
         )
       ORDER BY created_at ASC`,
      [start, end]
    );

    const details = webhookDetails.rows.map((row) => {
      const recs = row.signal_id ? recommendationsBySignal[row.signal_id] || [] : [];
      const signalOrders = row.signal_id ? ordersBySignal[row.signal_id] || [] : [];
      const signalTrades = signalOrders.flatMap((order) => tradesByOrder[order.order_id] || []);
      const stages = buildStages(row, recs, signalOrders);
      return {
        webhook: row,
        stages,
        recommendations: recs,
        orders: signalOrders,
        trades: signalTrades,
      };
    });

    const processingGaps = details
      .map((entry) => {
        const failure = firstFailure(entry.stages);
        if (!failure) return null;
        const reason = extractRejectionReason(entry.webhook, entry.recommendations);
        return {
          event_id: entry.webhook.event_id,
          request_id: entry.webhook.request_id,
          webhook_status: entry.webhook.webhook_status,
          signal_id: entry.webhook.signal_id,
          signal_status: entry.webhook.signal_status,
          failure_stage: failure.name,
          failure_reason: failure.detail || reason || entry.webhook.error_message,
        };
      })
      .filter(Boolean) as Report['processing_gaps'];

    const report: Report = {
      generated_at: new Date().toISOString(),
      report_date: reportDate,
      timezone,
      window_start: start.toISOString(),
      window_end: end.toISOString(),
      summary: {
        total_webhooks: webhookDetails.rows.length,
        total_signals: signalIds.length,
        total_webhook_rejections: webhookDetails.rows.filter((row) =>
          ['invalid_signature', 'invalid_payload', 'error', 'duplicate'].includes(row.webhook_status)
        ).length,
        total_signal_rejections: webhookDetails.rows.filter(
          (row) => row.signal_status === 'rejected'
        ).length,
        total_processing_gaps: processingGaps.length,
      },
      breakdown: {
        webhook_status_counts: summaryWebhookStatus.rows.reduce((acc, row) => {
          acc[row.status] = row.count;
          return acc;
        }, {} as Record<string, number>),
        signal_status_counts: summarySignalStatus.rows.reduce((acc, row) => {
          acc[row.status] = row.count;
          return acc;
        }, {} as Record<string, number>),
        signal_rejection_reasons: summarySignalRejections.rows.reduce((acc, row) => {
          const key = row.rejection_reason || 'unknown';
          acc[key] = row.count;
          return acc;
        }, {} as Record<string, number>),
        webhook_error_messages: summaryWebhookErrors.rows.reduce((acc, row) => {
          const key = row.error_message || 'none';
          acc[key] = row.count;
          return acc;
        }, {} as Record<string, number>),
      },
      processing_gaps: processingGaps,
      orphan_signals: orphanSignals.rows.map((row) => ({
        signal_id: row.signal_id,
        symbol: row.symbol,
        timeframe: row.timeframe,
        status: row.status,
        rejection_reason: row.rejection_reason,
        created_at: row.created_at,
      })),
      details,
    };

    const outputDir = path.resolve(process.cwd(), 'tmp');
    await fs.mkdir(outputDir, { recursive: true });
    const baseName = `webhook-processing-report-${reportDate}`;
    await fs.writeFile(
      path.join(outputDir, `${baseName}.json`),
      JSON.stringify(report, null, 2),
      'utf8'
    );
    await fs.writeFile(
      path.join(outputDir, `${baseName}.md`),
      renderReport(report),
      'utf8'
    );

    expect(report.summary.total_webhooks).toBeGreaterThanOrEqual(0);
  });
});
