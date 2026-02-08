import { db } from './database.service.js';
import { logger } from '../utils/logger.js';

export async function ensureTestSession(
  testSessionId: string,
  scenario?: string | null,
  totalWebhooks?: number | null
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO test_sessions (test_session_id, scenario, status, total_webhooks, started_at)
       VALUES ($1, $2, 'processing', $3, NOW())
       ON CONFLICT (test_session_id) DO UPDATE
       SET scenario = COALESCE(EXCLUDED.scenario, test_sessions.scenario),
           total_webhooks = COALESCE(EXCLUDED.total_webhooks, test_sessions.total_webhooks)`,
      [testSessionId, scenario || null, totalWebhooks ?? null]
    );
  } catch (error) {
    logger.warn('Failed to ensure test session record', { error, testSessionId });
  }
}

export async function markTestSessionCompleted(testSessionId: string): Promise<void> {
  try {
    await db.query(
      `UPDATE test_sessions
       SET status = 'completed', completed_at = NOW()
       WHERE test_session_id = $1`,
      [testSessionId]
    );
  } catch (error) {
    logger.warn('Failed to mark test session completed', { error, testSessionId });
  }
}

export async function getTestSessionSummary(testSessionId: string): Promise<any> {
  const [session, webhooks, decisions, orders, fills] = await Promise.all([
    db.query(
      `SELECT test_session_id, scenario, status, total_webhooks, started_at, completed_at, created_at
       FROM test_sessions
       WHERE test_session_id = $1
       LIMIT 1`,
      [testSessionId]
    ),
    db.query(
      `SELECT event_id, signal_id, status, symbol, timeframe, processing_time_ms, created_at
       FROM webhook_events
       WHERE test_session_id = $1
       ORDER BY created_at DESC`,
      [testSessionId]
    ),
    db.query(
      `SELECT COUNT(*)::int AS count
       FROM experiments e
       JOIN signals s ON s.signal_id = e.signal_id
       WHERE s.test_session_id = $1`,
      [testSessionId]
    ),
    db.query(
      `SELECT COUNT(*)::int AS count
       FROM orders o
       JOIN signals s ON s.signal_id = o.signal_id
       WHERE s.test_session_id = $1`,
      [testSessionId]
    ),
    db.query(
      `SELECT COUNT(*)::int AS count
       FROM orders o
       JOIN signals s ON s.signal_id = o.signal_id
       WHERE s.test_session_id = $1 AND o.status = 'filled'`,
      [testSessionId]
    ),
  ]);

  const webhookRows = webhooks.rows || [];
  const statusCounts = webhookRows.reduce(
    (acc: Record<string, number>, row: any) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    },
    {}
  );

  const totalProcessingMs = webhookRows.reduce(
    (sum: number, row: any) => sum + (row.processing_time_ms || 0),
    0
  );
  const avgProcessing = webhookRows.length
    ? Math.round(totalProcessingMs / webhookRows.length)
    : 0;

  return {
    test_session_id: testSessionId,
    status: session.rows[0]?.status || (webhookRows.length ? 'processing' : 'unknown'),
    scenario: session.rows[0]?.scenario || null,
    started_at: session.rows[0]?.started_at || session.rows[0]?.created_at || null,
    completed_at: session.rows[0]?.completed_at || null,
    summary: {
      total_webhooks: webhookRows.length,
      accepted: statusCounts.accepted || 0,
      duplicates: statusCounts.duplicate || 0,
      failed:
        (statusCounts.invalid_signature || 0) +
        (statusCounts.invalid_payload || 0) +
        (statusCounts.error || 0),
      decisions_made: decisions.rows[0]?.count || 0,
      orders_created: orders.rows[0]?.count || 0,
      orders_filled: fills.rows[0]?.count || 0,
      avg_processing_time_ms: avgProcessing,
      total_processing_time_ms: totalProcessingMs,
    },
    webhooks: webhookRows.map((row: any) => ({
      webhook_id: row.event_id,
      symbol: row.symbol,
      status: row.status,
      timeframe: row.timeframe,
      decision: null,
      order_id: null,
      timestamp: row.created_at,
    })),
  };
}

export async function clearTestSession(testSessionId: string): Promise<{
  webhooks_removed: number;
  orders_removed: number;
  decisions_removed: number;
}> {
  const orders = await db.query(
    `SELECT o.order_id
     FROM orders o
     JOIN signals s ON s.signal_id = o.signal_id
     WHERE s.test_session_id = $1`,
    [testSessionId]
  );
  const orderIds = orders.rows.map((row: any) => row.order_id);

  if (orderIds.length > 0) {
    await db.query(`DELETE FROM trades WHERE order_id = ANY($1::uuid[])`, [orderIds]);
  }

  await db.query(
    `DELETE FROM orders
     WHERE signal_id IN (SELECT signal_id FROM signals WHERE test_session_id = $1)`,
    [testSessionId]
  );
  await db.query(
    `DELETE FROM execution_policies
     WHERE experiment_id IN (
       SELECT experiment_id FROM experiments
       WHERE signal_id IN (SELECT signal_id FROM signals WHERE test_session_id = $1)
     )`,
    [testSessionId]
  );
  await db.query(
    `DELETE FROM trade_outcomes
     WHERE experiment_id IN (
       SELECT experiment_id FROM experiments
       WHERE signal_id IN (SELECT signal_id FROM signals WHERE test_session_id = $1)
     )`,
    [testSessionId]
  );
  const decisionsRemoved = await db.query(
    `DELETE FROM experiments
     WHERE signal_id IN (SELECT signal_id FROM signals WHERE test_session_id = $1)`,
    [testSessionId]
  );
  await db.query(`DELETE FROM market_contexts WHERE signal_id IN (SELECT signal_id FROM signals WHERE test_session_id = $1)`, [
    testSessionId,
  ]);
  await db.query(`DELETE FROM refactored_signals WHERE signal_id IN (SELECT signal_id FROM signals WHERE test_session_id = $1)`, [
    testSessionId,
  ]);
  const signalsDeleted = await db.query(
    `DELETE FROM signals WHERE test_session_id = $1`,
    [testSessionId]
  );
  const webhooksDeleted = await db.query(
    `DELETE FROM webhook_events WHERE test_session_id = $1`,
    [testSessionId]
  );
  await db.query(`DELETE FROM test_sessions WHERE test_session_id = $1`, [testSessionId]);

  return {
    webhooks_removed: webhooksDeleted.rowCount || 0,
    orders_removed: orderIds.length,
    decisions_removed: decisionsRemoved.rowCount || 0,
  };
}
