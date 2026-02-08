import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
import { db } from '../services/database.service.js';
import { marketData } from '../services/market-data.js';
import { rateLimiter } from '../services/rate-limiter.service.js';
import { marketDataStream } from '../services/market-data-stream.service.js';
import { errorTracker } from '../services/error-tracker.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

type AuthPayload = {
  userId: string;
  email: string;
  role: 'admin' | 'researcher' | 'user';
};

function requireAuth(req: Request, res: Response, next: NextFunction): Response | void {
  const token = authService.extractTokenFromHeader(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = authService.verifyToken(token) as AuthPayload | null;
  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  (req as Request & { user?: AuthPayload }).user = payload;
  return next();
}

router.get('/status', requireAuth, async (req: Request, res: Response) => {
  const limitParam = Number(req.query.limit);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 25) : 10;
  const windowHoursParam = Number(req.query.windowHours);
  const windowHours = Number.isFinite(windowHoursParam) && windowHoursParam > 0 ? windowHoursParam : 24;
  const testFilter = String(req.query.testFilter || 'all').toLowerCase();

  const webhookFilter =
    testFilter === 'test'
      ? 'AND we.is_test = TRUE'
      : testFilter === 'production'
        ? 'AND COALESCE(we.is_test, false) = FALSE'
        : '';
  const signalsFilter =
    testFilter === 'test'
      ? 'AND s.is_test = TRUE'
      : testFilter === 'production'
        ? 'AND COALESCE(s.is_test, false) = FALSE'
        : '';
  const ordersFilter =
    testFilter === 'test'
      ? 'AND COALESCE(s.is_test, false) = TRUE'
      : testFilter === 'production'
        ? 'AND COALESCE(s.is_test, false) = FALSE'
        : '';

  let recentEvents = { rows: [] as any[] };
  let summaryRows = { rows: [] as any[] };
  let engineRows = { rows: [] as any[] };
  let signalSummaryRows = { rows: [] as any[] };
  let orderSummaryRows = { rows: [] as any[] };
  let recentSignals = { rows: [] as any[] };
  let recentRejections = { rows: [] as any[] };
  let activityRows = { rows: [] as any[] };
  let decisionLogRows = { rows: [] as any[] };
  let decisionBreakdownSymbol = { rows: [] as any[] };
  let decisionBreakdownOutcome = { rows: [] as any[] };
  let decisionBreakdownTimeframe = { rows: [] as any[] };
  let decisionBreakdownDecision = { rows: [] as any[] };
  let decisionOverview = { rows: [] as any[] };
  let decisionByEngine = { rows: [] as any[] };
  let decisionQueue = { rows: [] as any[] };

  try {
    [recentEvents, summaryRows, engineRows, signalSummaryRows, orderSummaryRows, recentSignals, recentRejections, activityRows,
      decisionLogRows, decisionBreakdownSymbol, decisionBreakdownOutcome, decisionBreakdownTimeframe, decisionBreakdownDecision,
      decisionOverview, decisionByEngine, decisionQueue] =
      await Promise.all([
      db.query(
        `SELECT we.event_id, we.request_id, we.signal_id, we.experiment_id, we.variant, we.status, we.error_message,
                we.symbol, we.direction, we.timeframe, we.processing_time_ms, we.created_at, we.is_test, we.test_session_id
         FROM webhook_events we
       WHERE we.created_at > NOW() - ($2::int || ' hours')::interval
         ${webhookFilter}
         ORDER BY we.created_at DESC
       LIMIT $1`,
        [limit, windowHours]
      ),
      db.query(
        `SELECT we.status, COUNT(*)::int AS count
         FROM webhook_events we
       WHERE we.created_at > NOW() - ($1::int || ' hours')::interval
         ${webhookFilter}
         GROUP BY we.status`,
        [windowHours]
      ),
      db.query(
        `SELECT e.variant, COUNT(*)::int AS count
         FROM experiments e
         JOIN signals s ON s.signal_id = e.signal_id
       WHERE e.created_at > NOW() - ($1::int || ' hours')::interval
         ${signalsFilter}
         GROUP BY e.variant`,
        [windowHours]
      ),
      db.query(
        `SELECT s.status, COUNT(*)::int AS count
         FROM signals s
       WHERE s.created_at > NOW() - ($1::int || ' hours')::interval
         ${signalsFilter}
         GROUP BY s.status`,
        [windowHours]
      ),
      db.query(
        `SELECT o.status, COUNT(*)::int AS count
         FROM orders o
         LEFT JOIN signals s ON s.signal_id = o.signal_id
       WHERE o.created_at > NOW() - ($1::int || ' hours')::interval
         ${ordersFilter}
         GROUP BY o.status`,
        [windowHours]
      ),
      db.query(
        `SELECT s.signal_id, s.symbol, s.direction, s.timeframe, s.status, s.created_at
         FROM signals s
         WHERE 1=1
         ${signalsFilter}
         ORDER BY s.created_at DESC
         LIMIT 10`
      ),
      db.query(
        `SELECT s.signal_id, s.symbol, s.direction, s.timeframe, rs.rejection_reason, s.created_at
         FROM signals s
         JOIN refactored_signals rs ON rs.signal_id = s.signal_id
         WHERE s.status = 'rejected'
         ${signalsFilter}
         ORDER BY s.created_at DESC
         LIMIT 10`
      ),
      db.query(
        `SELECT 
           (SELECT MAX(s.created_at) FROM signals s WHERE 1=1 ${signalsFilter}) AS last_signal_at,
           (SELECT MAX(o.created_at)
            FROM orders o
            LEFT JOIN signals s ON s.signal_id = o.signal_id
            WHERE 1=1 ${ordersFilter}) AS last_order_at,
           (SELECT MAX(fill_timestamp) FROM trades) AS last_trade_at,
           (SELECT MAX(created_at) FROM refactored_positions) AS last_position_at`
      ),
      db.query(
        `SELECT o.order_id,
                o.engine,
                o.experiment_id,
                o.signal_id,
                o.status AS order_status,
                o.created_at AS order_created_at,
                o.quantity,
                o.order_type,
                s.symbol,
                s.timeframe,
                s.direction,
                we.processing_time_ms
         FROM orders o
         LEFT JOIN signals s ON s.signal_id = o.signal_id
         LEFT JOIN webhook_events we ON we.signal_id = o.signal_id
         WHERE o.created_at > NOW() - ($1::int || ' hours')::interval
         ${ordersFilter}
         ORDER BY o.created_at DESC
         LIMIT 50`,
        [windowHours]
      ),
      db.query(
        `SELECT s.symbol, COUNT(*)::int AS count
         FROM orders o
         LEFT JOIN signals s ON s.signal_id = o.signal_id
         WHERE o.created_at > NOW() - ($1::int || ' hours')::interval
         ${ordersFilter}
         GROUP BY s.symbol
         ORDER BY count DESC
         LIMIT 10`,
        [windowHours]
      ),
      db.query(
        `SELECT o.status, COUNT(*)::int AS count
         FROM orders o
         LEFT JOIN signals s ON s.signal_id = o.signal_id
         WHERE o.created_at > NOW() - ($1::int || ' hours')::interval
         ${ordersFilter}
         GROUP BY o.status`,
        [windowHours]
      ),
      db.query(
        `SELECT s.timeframe, COUNT(*)::int AS count
         FROM orders o
         LEFT JOIN signals s ON s.signal_id = o.signal_id
         WHERE o.created_at > NOW() - ($1::int || ' hours')::interval
         ${ordersFilter}
         GROUP BY s.timeframe
         ORDER BY count DESC`,
        [windowHours]
      ),
      db.query(
        `SELECT s.direction, COUNT(*)::int AS count
         FROM orders o
         LEFT JOIN signals s ON s.signal_id = o.signal_id
         WHERE o.created_at > NOW() - ($1::int || ' hours')::interval
         ${ordersFilter}
         GROUP BY s.direction`,
        [windowHours]
      ),
      db.query(
        `SELECT COUNT(*)::int AS total,
                SUM(CASE WHEN o.status = 'filled' THEN 1 ELSE 0 END)::int AS filled,
                SUM(CASE WHEN o.status = 'failed' THEN 1 ELSE 0 END)::int AS failed,
                AVG(COALESCE(we.processing_time_ms, 0))::float AS avg_latency
         FROM orders o
         LEFT JOIN webhook_events we ON we.signal_id = o.signal_id
         LEFT JOIN signals s ON s.signal_id = o.signal_id
         WHERE o.created_at > NOW() - ($1::int || ' hours')::interval
         ${ordersFilter}`,
        [windowHours]
      ),
      db.query(
        `SELECT o.engine, COUNT(*)::int AS count,
                SUM(CASE WHEN o.status = 'filled' THEN 1 ELSE 0 END)::int AS filled,
                AVG(COALESCE(we.processing_time_ms, 0))::float AS avg_latency
         FROM orders o
         LEFT JOIN webhook_events we ON we.signal_id = o.signal_id
         LEFT JOIN signals s ON s.signal_id = o.signal_id
         WHERE o.created_at > NOW() - ($1::int || ' hours')::interval
         ${ordersFilter}
         GROUP BY o.engine`,
        [windowHours]
      ),
      db.query(
        `SELECT o.engine, COUNT(*)::int AS count
         FROM orders o
         LEFT JOIN signals s ON s.signal_id = o.signal_id
         WHERE o.status = 'pending_execution'
         ${ordersFilter}
         GROUP BY o.engine`
      ),
    ]);
  } catch (error) {
    // If migrations aren't applied yet, return empty webhook data
    logger.warn('Monitoring query failed, returning empty webhook data', { error });
    recentEvents = { rows: [] };
    summaryRows = { rows: [] };
    engineRows = { rows: [] };
    signalSummaryRows = { rows: [] };
    orderSummaryRows = { rows: [] };
    recentSignals = { rows: [] };
    recentRejections = { rows: [] };
    activityRows = { rows: [] };
    decisionLogRows = { rows: [] };
    decisionBreakdownSymbol = { rows: [] };
    decisionBreakdownOutcome = { rows: [] };
    decisionBreakdownTimeframe = { rows: [] };
    decisionBreakdownDecision = { rows: [] };
    decisionOverview = { rows: [] };
    decisionByEngine = { rows: [] };
    decisionQueue = { rows: [] };
  }

  const webhookSummary = summaryRows.rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row.count;
    return acc;
  }, {});

  const engineSummary = engineRows.rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.variant] = row.count;
    return acc;
  }, {});

  const signalSummary = signalSummaryRows.rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row.count;
    return acc;
  }, {});

  const orderSummary = orderSummaryRows.rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row.count;
    return acc;
  }, {});

  const activity = activityRows.rows[0] || {};
  const decisionOverviewRow = decisionOverview.rows[0] || {};
  const totalDecisions = decisionOverviewRow.total || 0;
  const windowMinutes = windowHours * 60;
  const decisionsPerMin = windowMinutes ? Math.round((totalDecisions / windowMinutes) * 10) / 10 : 0;
  const decisionsPerHour = windowHours ? Math.round((totalDecisions / windowHours) * 10) / 10 : 0;
  const successRate = totalDecisions
    ? Math.round(((decisionOverviewRow.filled || 0) / totalDecisions) * 1000) / 10
    : 0;
  const failureRate = totalDecisions
    ? Math.round(((decisionOverviewRow.failed || 0) / totalDecisions) * 1000) / 10
    : 0;
  const engineStats = decisionByEngine.rows.reduce<Record<string, any>>((acc, row) => {
    acc[row.engine || 'unknown'] = {
      decisions: row.count,
      success_rate: row.count ? Math.round((row.filled / row.count) * 1000) / 10 : 0,
      avg_latency_ms: row.avg_latency ? Math.round(row.avg_latency) : 0,
    };
    return acc;
  }, {});
  const queueDepths = decisionQueue.rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.engine || 'unknown'] = row.count;
    return acc;
  }, {});

  const signalsCount = Object.values(signalSummary).reduce((sum, value) => sum + value, 0) || 0;
  const experimentsCount = engineRows.rows.reduce((sum, row) => sum + row.count, 0) || 0;
  let stuckStage = 'None';
  if (signalsCount > experimentsCount) {
    stuckStage = 'Decisioning';
  } else if (experimentsCount > totalDecisions) {
    stuckStage = 'Order placement';
  }

  const circuitBreakers = marketData.getCircuitBreakerStatus();
  const downProviders = Object.entries(circuitBreakers)
    .filter(([, status]) => status.state === 'open')
    .map(([provider]) => provider);

  return res.json({
    timestamp: new Date().toISOString(),
    webhooks: {
      recent: recentEvents.rows,
      summary_24h: {
        total:
          Object.values(webhookSummary).reduce((sum, value) => sum + value, 0) || 0,
        accepted: webhookSummary.accepted || 0,
        duplicate: webhookSummary.duplicate || 0,
        invalid_signature: webhookSummary.invalid_signature || 0,
        invalid_payload: webhookSummary.invalid_payload || 0,
        error: webhookSummary.error || 0,
      },
    },
    engines: {
      by_variant_24h: {
        A: engineSummary.A || 0,
        B: engineSummary.B || 0,
      },
    },
    decision_engine: {
      overview: {
        decisions_per_min: decisionsPerMin,
        decisions_per_hour: decisionsPerHour,
        success_rate: successRate,
        failure_rate: failureRate,
        avg_latency_ms: decisionOverviewRow.avg_latency ? Math.round(decisionOverviewRow.avg_latency) : 0,
        utilization_pct: signalsCount ? Math.round((totalDecisions / signalsCount) * 100) : 0,
        failures_24h: decisionOverviewRow.failed || 0,
        total_decisions: totalDecisions,
      },
      comparison: {
        A: {
          decisions: engineStats.A?.decisions || 0,
          success_rate: engineStats.A?.success_rate || 0,
          avg_latency_ms: engineStats.A?.avg_latency_ms || 0,
          queue_depth: queueDepths.A || 0,
          volume_label: (engineStats.A?.decisions || 0) > (engineStats.B?.decisions || 0) ? 'Primary' : 'Low activity',
          volume_reason: (engineStats.A?.decisions || 0) > (engineStats.B?.decisions || 0) ? 'Higher decision volume' : 'Lower decision volume',
        },
        B: {
          decisions: engineStats.B?.decisions || 0,
          success_rate: engineStats.B?.success_rate || 0,
          avg_latency_ms: engineStats.B?.avg_latency_ms || 0,
          queue_depth: queueDepths.B || 0,
          volume_label: (engineStats.B?.decisions || 0) > (engineStats.A?.decisions || 0) ? 'Primary' : 'Low activity',
          volume_reason: (engineStats.B?.decisions || 0) > (engineStats.A?.decisions || 0) ? 'Higher decision volume' : 'Lower decision volume',
        },
      },
      pipeline: {
        signals_received: signalsCount,
        decisions_made: experimentsCount,
        orders_placed: totalDecisions,
        queue_depth_a: queueDepths.A || 0,
        queue_depth_b: queueDepths.B || 0,
        stuck_stage: stuckStage,
      },
      breakdown: {
        by_symbol: decisionBreakdownSymbol.rows.map((row) => ({
          label: row.symbol || 'Unknown',
          value: row.count,
        })),
        by_decision: decisionBreakdownDecision.rows.map((row) => ({
          label: row.direction === 'long' ? 'Buy' : row.direction === 'short' ? 'Sell' : 'Hold',
          value: row.count,
        })),
        by_outcome: decisionBreakdownOutcome.rows.map((row) => ({
          label: row.status,
          value: row.count,
        })),
        by_timeframe: decisionBreakdownTimeframe.rows.map((row) => ({
          label: row.timeframe || 'Unknown',
          value: row.count,
        })),
      },
      decision_log: decisionLogRows.rows.map((row) => ({
        id: row.order_id,
        timestamp: row.order_created_at,
        symbol: row.symbol,
        timeframe: row.timeframe,
        decision: row.direction === 'long' ? 'Buy' : row.direction === 'short' ? 'Sell' : 'Hold',
        confidence: null,
        outcome: row.order_status,
        processing_ms: row.processing_time_ms ?? null,
        engine: row.engine || 'A',
        signal_id: row.signal_id,
        experiment_id: row.experiment_id,
      })),
    },
    pipeline: {
      signals_24h: {
        total: Object.values(signalSummary).reduce((sum, value) => sum + value, 0) || 0,
        pending: signalSummary.pending || 0,
        approved: signalSummary.approved || 0,
        rejected: signalSummary.rejected || 0,
      },
      orders_24h: {
        total: Object.values(orderSummary).reduce((sum, value) => sum + value, 0) || 0,
        pending_execution: orderSummary.pending_execution || 0,
        filled: orderSummary.filled || 0,
        failed: orderSummary.failed || 0,
        cancelled: orderSummary.cancelled || 0,
      },
      recent_signals: recentSignals.rows,
      recent_rejections: recentRejections.rows,
      last_activity: {
        signal: activity.last_signal_at || null,
        order: activity.last_order_at || null,
        trade: activity.last_trade_at || null,
        position: activity.last_position_at || null,
      },
      worker_errors: errorTracker.getStats(),
    },
    websocket: marketDataStream.getStatus(),
    providers: {
      circuit_breakers: circuitBreakers,
      down: downProviders,
      rate_limits: rateLimiter.getAllStats(),
    },
  });
});

router.get('/details', requireAuth, async (req: Request, res: Response) => {
  const type = String(req.query.type || '').toLowerCase();
  const id = String(req.query.id || '');
  const relatedHours = Number(req.query.relatedHours) || 24;

  if (!type || !id) {
    return res.status(400).json({ error: 'type and id are required' });
  }

  const detail: any = {
    webhook_id: null,
    timestamp: null,
    status: null,
    processing_time_ms: null,
    signal_data: null,
    decision_engine: null,
    order_data: null,
    experiment: null,
    errors: [],
    warnings: [],
    raw_webhook_payload: null,
    audit_trail: [],
  };

  const webhookRow =
    type === 'webhook'
      ? await db.query(
          `SELECT * FROM webhook_events WHERE event_id = $1 LIMIT 1`,
          [id]
        )
      : { rows: [] as any[] };

  let signalId: string | null = null;
  let experimentId: string | null = null;
  let orderId: string | null = null;

  if (type === 'webhook' && webhookRow.rows.length > 0) {
    const row = webhookRow.rows[0];
    detail.webhook_id = row.event_id;
    detail.timestamp = row.created_at;
    detail.status = row.status;
    detail.processing_time_ms = row.processing_time_ms;
    signalId = row.signal_id;
    experimentId = row.experiment_id;
    if (row.status === 'duplicate') {
      detail.warnings.push('Duplicate webhook');
    }
    if (row.status?.includes('invalid') || row.status === 'error') {
      detail.errors.push(row.error_message || 'Webhook processing failed');
    }
  }

  if (type === 'signal') {
    signalId = id;
  }

  if (type === 'order') {
    orderId = id;
  }

  if (type === 'decision') {
    experimentId = id;
  }

  if (orderId) {
    const orderResult = await db.query(
      `SELECT o.*, t.fill_price, t.fill_quantity, t.fill_timestamp, t.commission
       FROM orders o
       LEFT JOIN trades t ON t.order_id = o.order_id
       WHERE o.order_id = $1
       LIMIT 1`,
      [orderId]
    );
    const order = orderResult.rows[0];
    if (order) {
      orderId = order.order_id;
      signalId = order.signal_id;
      experimentId = order.experiment_id;
      detail.order_data = {
        order_id: order.order_id,
        order_type: order.order_type,
        quantity: order.quantity,
        price: null,
        limit_price: null,
        stop_loss: null,
        take_profit: null,
        order_status: order.status,
        placed_at: order.created_at,
        filled_at: order.fill_timestamp,
        fill_price: order.fill_price,
        fill_quantity: order.fill_quantity,
        commission: order.commission,
        slippage: null,
        engine: order.engine,
        experiment_id: order.experiment_id,
        signal_id: order.signal_id,
      };
    }
  }

  if (signalId) {
    const signalResult = await db.query(
      `SELECT * FROM signals WHERE signal_id = $1 LIMIT 1`,
      [signalId]
    );
    const signal = signalResult.rows[0];
    if (signal) {
      detail.signal_data = {
        signal_id: signal.signal_id,
        symbol: signal.symbol,
        timeframe: signal.timeframe,
        variant: null,
        signal_type: signal.direction === 'long' ? 'buy' : 'sell',
        price: null,
        indicator_values: {},
        is_test: signal.is_test || false,
        test_session_id: signal.test_session_id || null,
      };
      detail.raw_webhook_payload = signal.raw_payload || null;
      detail.timestamp = detail.timestamp || signal.created_at;
      detail.status = detail.status || signal.status;
    }
  }

  if (experimentId) {
    const experimentResult = await db.query(
      `SELECT * FROM experiments WHERE experiment_id = $1 LIMIT 1`,
      [experimentId]
    );
    const experiment = experimentResult.rows[0];
    if (experiment) {
      detail.experiment = {
        experiment_id: experiment.experiment_id,
        experiment_name: 'Decision experiment',
        variant: experiment.variant,
        control_group: experiment.variant === 'A',
      };
      if (detail.signal_data) {
        detail.signal_data.variant = experiment.variant;
      }
      detail.signal_data = detail.signal_data || {
        signal_id: experiment.signal_id,
      };
      detail.decision_engine = {
        engine: experiment.variant === 'A' ? 'Engine A' : 'Engine B',
        decision: detail.signal_data?.signal_type || 'hold',
        confidence_score: null,
        strategy_used: null,
        decision_time_ms: detail.processing_time_ms,
        decision_timestamp: experiment.created_at,
        decision_factors: [],
        thresholds_met: null,
        risk_checks_passed: null,
      };
    }
  }

  if (!detail.decision_engine && detail.order_data) {
    detail.decision_engine = {
      engine: detail.order_data.engine === 'B' ? 'Engine B' : 'Engine A',
      decision: detail.signal_data?.signal_type || 'hold',
      confidence_score: null,
      strategy_used: null,
      decision_time_ms: detail.processing_time_ms,
      decision_timestamp: detail.order_data.placed_at,
      decision_factors: [],
      thresholds_met: null,
      risk_checks_passed: null,
    };
  }

  if (!detail.order_data && signalId) {
    const orderResult = await db.query(
      `SELECT o.*, t.fill_price, t.fill_quantity, t.fill_timestamp, t.commission
       FROM orders o
       LEFT JOIN trades t ON t.order_id = o.order_id
       WHERE o.signal_id = $1
       ORDER BY o.created_at DESC
       LIMIT 1`,
      [signalId]
    );
    const order = orderResult.rows[0];
    if (order) {
      detail.order_data = {
        order_id: order.order_id,
        order_type: order.order_type,
        quantity: order.quantity,
        price: null,
        limit_price: null,
        stop_loss: null,
        take_profit: null,
        order_status: order.status,
        placed_at: order.created_at,
        filled_at: order.fill_timestamp,
        fill_price: order.fill_price,
        fill_quantity: order.fill_quantity,
        commission: order.commission,
        slippage: null,
        engine: order.engine,
        experiment_id: order.experiment_id,
        signal_id: order.signal_id,
      };
    }
  }

  if (detail.status === 'duplicate' && detail.signal_data?.symbol) {
    const dupResult = await db.query(
      `SELECT event_id, created_at
       FROM webhook_events
       WHERE symbol = $1
         AND timeframe = $2
         AND created_at > NOW() - ($3::int || ' hours')::interval
         AND event_id <> $4
       ORDER BY created_at DESC
       LIMIT 1`,
      [detail.signal_data.symbol, detail.signal_data.timeframe || '5m', relatedHours, id]
    );
    const dup = dupResult.rows[0];
    if (dup) {
      detail.duplicate = {
        original_webhook_id: dup.event_id,
        original_timestamp: dup.created_at,
        duplicate_detection_method: 'signal_id_match',
      };
    }
  }

  if (detail.status && ['invalid_signature', 'invalid_payload', 'error'].includes(detail.status)) {
    detail.error_code = 'WEBHOOK_FAILED';
    detail.error_message = detail.errors[0] || 'Webhook failed';
    detail.error_timestamp = detail.timestamp;
    detail.validation_failures = [];
    detail.retry_attempts = 0;
    detail.can_retry = false;
  }

  const auditTrail: Array<{ timestamp: string; event: string; system: string }> = [];
  if (detail.timestamp) {
    auditTrail.push({ timestamp: detail.timestamp, event: 'Webhook received', system: 'API Gateway' });
  }
  if (signalId) {
    auditTrail.push({ timestamp: detail.timestamp, event: 'Signal validated', system: 'Signal Processor' });
  }
  if (experimentId) {
    auditTrail.push({ timestamp: detail.timestamp, event: 'Decision made', system: detail.decision_engine?.engine || 'Engine' });
  }
  if (detail.order_data?.placed_at) {
    auditTrail.push({ timestamp: detail.order_data.placed_at, event: 'Order placed', system: 'Order Manager' });
  }
  if (detail.order_data?.filled_at) {
    auditTrail.push({ timestamp: detail.order_data.filled_at, event: 'Order filled', system: 'Broker API' });
  }
  detail.audit_trail = auditTrail;

  return res.json(detail);
});

router.get('/related', requireAuth, async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || '');
  const timeframe = String(req.query.timeframe || '');
  const hoursParam = Number(req.query.hours);
  const hours = Number.isFinite(hoursParam) && hoursParam > 0 ? hoursParam : 24;
  if (!symbol || !timeframe) {
    return res.status(400).json({ error: 'symbol and timeframe are required' });
  }

  const related = await db.query(
    `SELECT event_id, status, symbol, timeframe, created_at
     FROM webhook_events
     WHERE symbol = $1 AND timeframe = $2 AND created_at > NOW() - ($3::int || ' hours')::interval
     ORDER BY created_at DESC
     LIMIT 50`,
    [symbol, timeframe, hours]
  );

  return res.json({
    related_webhooks: related.rows,
    total_count: related.rows.length,
  });
});

export default router;
