#!/usr/bin/env tsx
/**
 * Full E2E + Sentry Telemetry Validation
 *
 * Runs controlled E2E scenarios, pulls Sentry data via API, correlates with
 * signal lifecycle, and produces a structured diagnostic report.
 *
 * Usage:
 *   npx tsx scripts/run-full-e2e-sentry-validation.ts [options]
 *
 * Options:
 *   --url=URL          Target webhook URL (default: from TARGET_URL or PRODUCTION_URL)
 *   --skip-sentry      Skip Sentry API (E2E + DB correlation only - use when auth fails)
 *   --sentry-only      Skip E2E, only pull Sentry data for last 1h
 *   --skip-failures    Skip controlled failure scenarios
 *   --no-engine-b      Skip Engine B scenario
 *
 * Env:
 *   TARGET_URL / PRODUCTION_URL  - Webhook endpoint
 *   SENTRY_AUTH_TOKEN           - Sentry API token (required for Sentry phase)
 *   SENTRY_ORG_SLUG             - Sentry org slug
 *   SENTRY_PROJECT_SLUG          - Sentry project slug
 *   DATABASE_URL                 - For DB correlation (optional)
 */

import {
  getConfig as getSentryConfig,
  fetchErrors,
  fetchTransactions,
  fetchCustomEvents,
  fetchRedisEvents,
  fetchMarketDataEvents,
  fetchSilentFailurePatterns,
  fetchEventsBySignalId,
  type SentryEvent,
} from './sentry-api-client.js';

function getWebhookUrl(base: string): string {
  const b = base.replace(/\/$/, '');
  return b.includes('/webhook') ? b : `${b}/webhook`;
}

function getBaseUrl(url: string): string {
  return url.replace(/\/webhook\/?$/, '').replace(/\/$/, '') || url;
}

// ─── Types ─────────────────────────────────────────────────────────────────

interface ValidationContext {
  runId: string;
  startTime: number;
  endTime: number;
  signalIds: string[];
  testSessionId: string;
  webhookDetails: WebhookDetail[];
}

interface WebhookDetail {
  step: string;
  payload: Record<string, unknown>;
  response: { status: number; data: Record<string, unknown>; signalId?: string; durationMs: number };
}

interface LifecycleState {
  signal: Record<string, unknown> | null;
  experiment: Record<string, unknown> | null;
  refactoredSignal: Record<string, unknown> | null;
  marketContext: Record<string, unknown> | null;
  recommendations: Record<string, unknown>[];
  orders: Record<string, unknown>[];
  trades: Record<string, unknown>[];
  positions: Record<string, unknown>[];
  exitOrders: Record<string, unknown>[];
  shadowTrades: Record<string, unknown>[];
}

interface CorrelationRow {
  stage: string;
  expected: string;
  db: string;
  sentry: string;
  status: 'OK' | 'PARTIAL' | 'MISSING' | 'N/A';
}

interface SignalLifecycleDetail {
  signalId: string;
  signal: Record<string, unknown> | null;
  experiment: Record<string, unknown> | null;
  refactoredSignal: Record<string, unknown> | null;
  marketContext: Record<string, unknown> | null;
  recommendations: Record<string, unknown>[];
  orders: Record<string, unknown>[];
  trades: Record<string, unknown>[];
  positions: Record<string, unknown>[];
  exitOrders: Record<string, unknown>[];
  shadowTrades: Record<string, unknown>[];
  stagesCompleted: string[];
  stagesMissing: string[];
}

interface ValidationReport {
  bootHealth: Record<string, unknown>;
  workerStability: Record<string, unknown>;
  redisStability: Record<string, unknown>;
  marketDataStability: Record<string, unknown>;
  engineAExecution: Record<string, unknown>;
  engineBExecution: Record<string, unknown>;
  strikeSuccessRate: Record<string, unknown>;
  executionSuccessRate: Record<string, unknown>;
  exitLogicValidation: Record<string, unknown>;
  websocketValidation: Record<string, unknown>;
  silentErrorsFound: Record<string, unknown>;
  performanceBottlenecks: Record<string, unknown>;
  endToEndLatency: Record<string, unknown>;
  failureRootCauses: Record<string, unknown>;
  recommendedFixes: string[];
  correlationTable: CorrelationRow[];
  webhookDetails: WebhookDetail[];
  signalLifecycles: SignalLifecycleDetail[];
}

// ─── E2E Scenarios ─────────────────────────────────────────────────────────

function buildWebhookPayload(options: {
  symbol?: string;
  direction?: 'long' | 'short';
  timeframe?: string;
  testSessionId: string;
  testScenario?: string;
  invalid?: boolean;
}): Record<string, unknown> {
  const { testSessionId, testScenario, invalid } = options;
  const symbol = options.symbol ?? 'SPY';
  const direction = options.direction ?? 'long';
  const timeframe = options.timeframe ?? '5m';

  if (invalid) {
    return { invalid: 'payload', missing: 'symbol' };
  }

  return {
    symbol,
    direction,
    timeframe,
    timestamp: new Date().toISOString(),
    is_test: true,
    test_session_id: testSessionId,
    test_scenario: testScenario ?? 'E2E_VALIDATION',
  };
}

async function sendWebhook(
  payload: Record<string, unknown>,
  targetUrl: string
): Promise<{ status: number; data: Record<string, unknown>; signalId?: string; durationMs: number }> {
  const url = getWebhookUrl(targetUrl);
  const start = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  const durationMs = Date.now() - start;
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  const inner = (data as any).response ?? data;
  const signalId = (inner as any).signal_id ?? (data as any).signal_id;
  return {
    status: res.status,
    data: inner,
    signalId: signalId as string | undefined,
    durationMs,
  };
}

async function fetchLifecycleFromDb(signalId: string): Promise<LifecycleState | null> {
  try {
    const { db } = await import('../src/services/database.service.js');
    const [signalRes, experimentRes, refactoredRes, marketRes, recommendationsRes, ordersRes] =
      await Promise.all([
        db.query(
          `SELECT signal_id, symbol, direction, timeframe, status, processed, created_at, rejection_reason
           FROM signals WHERE signal_id = $1`,
          [signalId]
        ),
        db.query(
          `SELECT experiment_id, variant, created_at FROM experiments WHERE signal_id = $1`,
          [signalId]
        ),
        db.query(
          `SELECT refactored_signal_id, signal_id, rejection_reason, processed_at
           FROM refactored_signals WHERE signal_id = $1`,
          [signalId]
        ),
        db.query(
          `SELECT context_id, signal_id, symbol, current_price, bid, ask, volume, created_at
           FROM market_contexts WHERE signal_id = $1`,
          [signalId]
        ),
        db.query(
          `SELECT recommendation_id, signal_id, engine, is_shadow, created_at
           FROM decision_recommendations WHERE signal_id = $1`,
          [signalId]
        ),
        db.query(
          `SELECT order_id, signal_id, symbol, option_symbol, status, engine, created_at
           FROM orders WHERE signal_id = $1`,
          [signalId]
        ),
      ]);
    const orders = (ordersRes.rows || []) as Record<string, unknown>[];
    const orderIds = orders.map((r: any) => r.order_id).filter(Boolean);
    let trades: Record<string, unknown>[] = [];
    let positions: Record<string, unknown>[] = [];
    let exitOrders: Record<string, unknown>[] = [];
    if (orderIds.length) {
      const tradesRes = await db.query(
        'SELECT trade_id, order_id, fill_timestamp FROM trades WHERE order_id = ANY($1::uuid[])',
        [orderIds]
      );
      trades = (tradesRes.rows || []) as Record<string, unknown>[];
      const optionSymbols = orders.map((r: any) => r.option_symbol).filter(Boolean);
      if (optionSymbols.length) {
        const [posRes, exitRes] = await Promise.all([
          db.query(
            `SELECT position_id, option_symbol, status, entry_timestamp, exit_timestamp, exit_reason
             FROM refactored_positions WHERE option_symbol = ANY($1::text[])`,
            [optionSymbols]
          ),
          db.query(
            `SELECT order_id, option_symbol, status, created_at
             FROM orders WHERE signal_id IS NULL AND option_symbol = ANY($1::text[])`,
            [optionSymbols]
          ),
        ]);
        positions = (posRes.rows || []) as Record<string, unknown>[];
        exitOrders = (exitRes.rows || []) as Record<string, unknown>[];
      }
    }
    const shadowRes = await db.query(
      'SELECT shadow_trade_id, signal_id, entry_timestamp FROM shadow_trades WHERE signal_id = $1',
      [signalId]
    );
    const shadowTrades = (shadowRes.rows || []) as Record<string, unknown>[];

    return {
      signal: (signalRes.rows[0] as Record<string, unknown>) || null,
      experiment: (experimentRes.rows[0] as Record<string, unknown>) || null,
      refactoredSignal: (refactoredRes.rows[0] as Record<string, unknown>) || null,
      marketContext: (marketRes.rows[0] as Record<string, unknown>) || null,
      recommendations: (recommendationsRes.rows || []) as Record<string, unknown>[],
      orders,
      trades,
      positions,
      exitOrders,
      shadowTrades,
    };
  } catch {
    return null;
  }
}

async function computeStagesFromLifecycle(state: LifecycleState): Promise<{
  completed: string[];
  missing: string[];
}> {
  const completed: string[] = [];
  const missing: string[] = [];
  const stages = [
    { name: 'RECEIVED', check: () => !!state.signal },
    { name: 'ENRICHED', check: () => !!state.marketContext },
    { name: 'REFACTORED', check: () => !!state.refactoredSignal },
    { name: 'ENGINE_EVALUATED', check: () => !!state.experiment || state.recommendations.length > 0 },
    { name: 'ORDER_CREATED', check: () => state.orders.length > 0 },
    { name: 'ORDER_FILLED', check: () => state.trades.length > 0 },
    { name: 'POSITION_CREATED', check: () => state.positions.length > 0 },
    { name: 'EXIT_CREATED', check: () => state.exitOrders.length > 0 || state.positions.some((p: any) => p.status === 'closing') },
    { name: 'EXIT_FILLED', check: () => state.positions.some((p: any) => p.status === 'closed') },
    { name: 'SHADOW_EXECUTED', check: () => state.shadowTrades.length > 0 },
  ];
  for (const s of stages) {
    if (s.check()) completed.push(s.name);
    else missing.push(s.name);
  }
  return { completed, missing };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Phase 1: E2E Execution ────────────────────────────────────────────────

async function runPhase1E2E(options: {
  targetUrl: string;
  skipFailures?: boolean;
  skipEngineB?: boolean;
}): Promise<ValidationContext> {
  const runId = `E2E_${Date.now()}`;
  const testSessionId = runId;
  const startTime = Date.now();
  const signalIds: string[] = [];
  const webhookDetails: WebhookDetail[] = [];
  const baseUrl = getBaseUrl(options.targetUrl);

  console.log('\n' + '═'.repeat(70));
  console.log('PHASE 1 — Execute Controlled E2E Scenario');
  console.log('═'.repeat(70));

  // Step 1: Boot verification (assume server is already running)
  console.log('\n📍 Step 1 — Boot verification');
  console.log('   (Assuming server is already running. Check logs for BOOT_COMPLETE.)');
  console.log(`   Target URL: ${baseUrl}`);

  // Step 2: Valid webhook
  console.log('\n📍 Step 2 — Send valid webhook');
  const validPayload = buildWebhookPayload({
    symbol: 'SPY',
    direction: 'long',
    timeframe: '5m',
    testSessionId,
    testScenario: 'VALID_SIGNAL',
  });
  const r1 = await sendWebhook(validPayload, options.targetUrl);
  webhookDetails.push({ step: 'VALID_SIGNAL', payload: validPayload, response: r1 });
  console.log(`   HTTP ${r1.status} | signal_id: ${r1.signalId ?? 'N/A'} | ${r1.durationMs}ms`);
  if (r1.signalId) signalIds.push(r1.signalId);

  await sleep(2000);

  // Step 3: Engine B (if enabled)
  if (!options.skipEngineB) {
    console.log('\n📍 Step 3 — Engine B scenario (second signal)');
    const engineBPayload = buildWebhookPayload({
      symbol: 'QQQ',
      direction: 'short',
      timeframe: '15m',
      testSessionId,
      testScenario: 'ENGINE_B_TEST',
    });
    const r2 = await sendWebhook(engineBPayload, options.targetUrl);
    webhookDetails.push({ step: 'ENGINE_B_TEST', payload: engineBPayload, response: r2 });
    console.log(`   HTTP ${r2.status} | signal_id: ${r2.signalId ?? 'N/A'} | ${r2.durationMs}ms`);
    if (r2.signalId) signalIds.push(r2.signalId);
    await sleep(2000);
  }

  // Step 4: Controlled failures
  if (!options.skipFailures) {
    console.log('\n📍 Step 4 — Controlled failures');
    const invalidPayload = buildWebhookPayload({
      testSessionId,
      testScenario: 'INVALID_PAYLOAD',
      invalid: true,
    });
    const rInvalid = await sendWebhook(invalidPayload, options.targetUrl);
    webhookDetails.push({ step: 'INVALID_PAYLOAD', payload: invalidPayload, response: rInvalid });
    console.log(`   Invalid payload: HTTP ${rInvalid.status} (expected 4xx) | ${rInvalid.durationMs}ms`);
  }

  const endTime = Date.now();
  console.log(`\n   Run ID: ${runId}`);
  console.log(`   Signals: ${signalIds.join(', ') || 'none'}`);
  console.log(`   Window: ${new Date(startTime).toISOString()} — ${new Date(endTime).toISOString()}`);

  return { runId, startTime, endTime, signalIds, testSessionId, webhookDetails };
}

// ─── Phase 2 & 3: Sentry + Correlation ────────────────────────────────────

async function runPhase2And3(
  ctx: ValidationContext,
  skipSentry: boolean = false
): Promise<{
  errors: SentryEvent[];
  transactions: SentryEvent[];
  customEvents: SentryEvent[];
  redisEvents: SentryEvent[];
  marketDataEvents: SentryEvent[];
  silentFailures: ReturnType<typeof fetchSilentFailurePatterns> extends Promise<infer T> ? T : never;
  eventsBySignal: Map<string, SentryEvent[]>;
}> {
  const config = getSentryConfig();
  const statsPeriod = '1h';

  const result = {
    errors: [] as SentryEvent[],
    transactions: [] as SentryEvent[],
    customEvents: [] as SentryEvent[],
    redisEvents: [] as SentryEvent[],
    marketDataEvents: [] as SentryEvent[],
    silentFailures: { unhandledRejection: [], uncaughtException: [], workerErrors: [] } as any,
    eventsBySignal: new Map<string, SentryEvent[]>(),
  };

  if (skipSentry) {
    console.log('\n⏭️  Phase 2 — Sentry skipped (--skip-sentry)');
    return result;
  }

  if (!config) {
    console.log('\n⚠️  Sentry API not configured (SENTRY_AUTH_TOKEN, SENTRY_ORG_SLUG, SENTRY_PROJECT_SLUG)');
    return result;
  }

  console.log('\n' + '═'.repeat(70));
  console.log('PHASE 2 — Pull Data From Sentry');
  console.log('═'.repeat(70));

  try {
    const [errors, transactions, customEvents, redisEvents, marketDataEvents, silentFailures] =
      await Promise.all([
        fetchErrors(config, { statsPeriod }),
        fetchTransactions(config, { statsPeriod }),
        fetchCustomEvents(config, { statsPeriod }),
        fetchRedisEvents(config, { statsPeriod }),
        fetchMarketDataEvents(config, { statsPeriod }),
        fetchSilentFailurePatterns(config, { statsPeriod }),
      ]);

    result.errors = errors;
    result.transactions = transactions;
    result.customEvents = customEvents;
    result.redisEvents = redisEvents;
    result.marketDataEvents = marketDataEvents;
    result.silentFailures = silentFailures;

    console.log(`   Errors: ${errors.length}`);
    console.log(`   Transactions: ${transactions.length}`);
    console.log(`   Custom events: ${customEvents.length}`);
    console.log(`   Redis events: ${redisEvents.length}`);
    console.log(`   Market data events: ${marketDataEvents.length}`);

    for (const signalId of ctx.signalIds) {
      const events = await fetchEventsBySignalId(config, signalId, { statsPeriod });
      result.eventsBySignal.set(signalId, events);
      console.log(`   Events for ${signalId}: ${events.length}`);
    }
  } catch (err: any) {
    console.error('   Sentry fetch error:', err.message);
  }

  return result;
}

// ─── Report Generation ────────────────────────────────────────────────────

async function buildReportAsync(
  ctx: ValidationContext,
  sentryData: Awaited<ReturnType<typeof runPhase2And3>>
): Promise<ValidationReport> {
  const customMessages = new Set(sentryData.customEvents.map((e) => e.message).filter(Boolean));
  const hasEvent = (name: string) =>
    [...customMessages].some((m) => m && String(m).includes(name));

  const correlationTable: CorrelationRow[] = [];
  const signalLifecycles: SignalLifecycleDetail[] = [];

  for (const signalId of ctx.signalIds) {
    const dbState = await fetchLifecycleFromDb(signalId).catch(() => null);
    const events = sentryData.eventsBySignal.get(signalId) || [];
    const eventMessages = new Set(events.map((e) => e.message).filter(Boolean));
    const { completed: stagesCompleted, missing: stagesMissing } = dbState
      ? await computeStagesFromLifecycle(dbState)
      : { completed: [] as string[], missing: ['RECEIVED', 'ENRICHED', 'ENGINE_EVALUATED', 'ORDER_CREATED', 'ORDER_FILLED', 'POSITION_CREATED'] };

    signalLifecycles.push({
      signalId,
      signal: dbState?.signal ?? null,
      experiment: dbState?.experiment ?? null,
      refactoredSignal: dbState?.refactoredSignal ?? null,
      marketContext: dbState?.marketContext ?? null,
      recommendations: dbState?.recommendations ?? [],
      orders: dbState?.orders ?? [],
      trades: dbState?.trades ?? [],
      positions: dbState?.positions ?? [],
      exitOrders: dbState?.exitOrders ?? [],
      shadowTrades: dbState?.shadowTrades ?? [],
      stagesCompleted,
      stagesMissing,
    });

    const stageDefs = [
      { stage: 'RECEIVED', expected: 'Signal stored', db: dbState?.signal ? '✓' : '?', sentry: 'N/A' },
      { stage: 'ENRICHED', expected: 'Market context', db: dbState?.marketContext ? '✓' : '?', sentry: 'N/A' },
      { stage: 'REFACTORED', expected: 'Refactored signal', db: dbState?.refactoredSignal ? '✓' : '?', sentry: 'N/A' },
      { stage: 'ENGINE', expected: 'Engine executed', db: dbState?.experiment || (dbState?.recommendations?.length ?? 0) > 0 ? '✓' : '?', sentry: eventMessages.size ? '✓' : '?' },
      { stage: 'ORDER', expected: 'Order created', db: (dbState?.orders?.length ?? 0) > 0 ? '✓' : '?', sentry: 'N/A' },
      { stage: 'EXECUTION', expected: 'Trade filled', db: (dbState?.trades?.length ?? 0) > 0 ? '✓' : '?', sentry: 'N/A' },
      { stage: 'POSITION', expected: 'Position created', db: (dbState?.positions?.length ?? 0) > 0 ? '✓' : '?', sentry: 'N/A' },
      { stage: 'EXIT', expected: 'Exit created/filled', db: (dbState?.exitOrders?.length ?? 0) > 0 || dbState?.positions?.some((p: any) => p.status === 'closed') ? '✓' : '?', sentry: 'N/A' },
      { stage: 'SHADOW', expected: 'Shadow trade', db: (dbState?.shadowTrades?.length ?? 0) > 0 ? '✓' : '?', sentry: 'N/A' },
    ];
    for (const s of stageDefs) {
      let status: CorrelationRow['status'] = 'OK';
      if (s.db === '?' && s.sentry === '?') status = 'MISSING';
      else if (s.db === '?' || s.sentry === '?') status = 'PARTIAL';
      correlationTable.push({
        stage: `${s.stage} (${signalId.slice(0, 8)})`,
        expected: s.expected,
        db: s.db,
        sentry: s.sentry,
        status,
      });
    }
  }

  const avgDuration =
    sentryData.transactions.length > 0
      ? sentryData.transactions.reduce((sum, t) => {
          const d = (t as any)['transaction.duration'];
          return sum + (typeof d === 'number' ? d : 0);
        }, 0) / sentryData.transactions.length
      : 0;

  const recommendedFixes: string[] = [];
  if (sentryData.silentFailures.unhandledRejection.length > 0)
    recommendedFixes.push('Add global unhandledRejection handler');
  if (sentryData.silentFailures.uncaughtException.length > 0)
    recommendedFixes.push('Add global uncaughtException handler');
  if (sentryData.redisEvents.some((e) => e.level === 'error'))
    recommendedFixes.push('Review Redis connection stability');
  if (sentryData.marketDataEvents.some((e) => e.level === 'error'))
    recommendedFixes.push('Review market data provider fallback logic');

  return {
    bootHealth: {
      bootComplete: hasEvent('BOOT_COMPLETE'),
      workersStarted: hasEvent('WORKER_START'),
      redisConnected: hasEvent('REDIS_CONNECTED'),
      dbConnected: 'N/A (check logs)',
    },
    workerStability: {
      orchestratorWorker: hasEvent('WORKER_START'),
      tradeEngineProcessing: hasEvent('TRADE_ENGINE_PROCESSING'),
      workerErrors: sentryData.silentFailures.workerErrors.length,
    },
    redisStability: {
      connected: sentryData.redisEvents.some((e) => e.message?.includes('REDIS_CONNECTED')),
      errors: sentryData.redisEvents.filter((e) => e.level === 'error').length,
      reconnects: sentryData.redisEvents.filter((e) => e.message?.includes('DISCONNECT')).length,
    },
    marketDataStability: {
      providerUsed: sentryData.marketDataEvents.length > 0 ? 'Tracked' : 'Unknown',
      fallbackTriggered: sentryData.marketDataEvents.some((e) =>
        e.message?.includes('trying next provider')
      ),
      circuitBreakerOpen: sentryData.marketDataEvents.some((e) =>
        e.message?.includes('CIRCUIT_OPEN')
      ),
    },
    engineAExecution: {
      engineASpans: sentryData.transactions.filter((t) =>
        String((t as any).transaction || '').includes('engine')
      ).length,
      strikeSelection: 'N/A (breadcrumbs)',
    },
    engineBExecution: {
      engineBRejected: hasEvent('ENGINE_B_REJECTED'),
      shadowSimulated: hasEvent('SHADOW_TRADE_SIMULATED'),
      shadowSkipped: hasEvent('SHADOW_EXECUTION_SKIPPED'),
    },
    strikeSuccessRate: {
      fromDb: ctx.signalIds.length > 0 ? 'Query orders for approved' : 'N/A',
      fromSentry: 'Breadcrumbs in engine spans',
    },
    executionSuccessRate: {
      fromDb: ctx.signalIds.length > 0 ? 'Query trades' : 'N/A',
      fromSentry: 'N/A',
    },
    exitLogicValidation: {
      fromDb: 'Query refactored_positions status',
      fromSentry: 'N/A',
    },
    websocketValidation: {
      serverStarted: hasEvent('WS_SERVER_STARTED'),
      clientConnected: hasEvent('WS_CLIENT_CONNECTED'),
    },
    silentErrorsFound: {
      unhandledRejection: sentryData.silentFailures.unhandledRejection.length,
      uncaughtException: sentryData.silentFailures.uncaughtException.length,
      workerCrashes: sentryData.silentFailures.workerErrors.length,
    },
    performanceBottlenecks: {
      avgTransactionMs: Math.round(avgDuration),
      transactionCount: sentryData.transactions.length,
      slowestStage: sentryData.transactions.length
        ? 'Review transaction spans in Sentry'
        : 'N/A',
    },
    endToEndLatency: {
      windowMs: ctx.endTime - ctx.startTime,
      signalCount: ctx.signalIds.length,
    },
    failureRootCauses: {
      errorsInWindow: sentryData.errors.length,
      errorSummary: sentryData.errors.slice(0, 5).map((e) => e.message || e.id),
    },
    recommendedFixes,
    correlationTable,
    webhookDetails: ctx.webhookDetails ?? [],
    signalLifecycles,
  };
}

function printReport(report: ValidationReport): void {
  console.log('\n' + '═'.repeat(70));
  console.log('FINAL DELIVERABLE — Structured Diagnostic Report');
  console.log('═'.repeat(70));

  const sections = [
    ['1. Boot Health', report.bootHealth],
    ['2. Worker Stability', report.workerStability],
    ['3. Redis Stability', report.redisStability],
    ['4. Market Data Stability', report.marketDataStability],
    ['5. Engine A Execution', report.engineAExecution],
    ['6. Engine B Execution', report.engineBExecution],
    ['7. Strike Success Rate', report.strikeSuccessRate],
    ['8. Execution Success Rate', report.executionSuccessRate],
    ['9. Exit Logic Validation', report.exitLogicValidation],
    ['10. WebSocket Validation', report.websocketValidation],
    ['11. Silent Errors Found', report.silentErrorsFound],
    ['12. Performance Bottlenecks', report.performanceBottlenecks],
    ['13. End-to-End Latency', report.endToEndLatency],
    ['14. Failure Root Causes', report.failureRootCauses],
  ];

  for (const [title, data] of sections) {
    console.log(`\n## ${title}`);
    console.log(JSON.stringify(data, null, 2));
  }

  console.log('\n## 15. Recommended Fixes');
  for (const fix of report.recommendedFixes) {
    console.log(`   - ${fix}`);
  }
  if (report.recommendedFixes.length === 0) {
    console.log('   (none)');
  }

  console.log('\n## Webhook Details');
  for (const w of report.webhookDetails ?? []) {
    console.log(`\n   Step: ${w.step}`);
    console.log(`   Payload: ${JSON.stringify(w.payload)}`);
    console.log(`   Response: HTTP ${w.response.status} | ${w.response.durationMs}ms`);
    console.log(`   Data: ${JSON.stringify(w.response.data)}`);
  }

  console.log('\n## Per-Signal Lifecycle (Detailed)');
  for (const lc of report.signalLifecycles ?? []) {
    console.log(`\n   Signal: ${lc.signalId}`);
    console.log(`   Stages completed: ${lc.stagesCompleted.join(', ') || 'none'}`);
    console.log(`   Stages missing: ${lc.stagesMissing.join(', ') || 'none'}`);
    if (lc.signal) console.log(`   Signal row: ${JSON.stringify(lc.signal)}`);
    if (lc.experiment) console.log(`   Experiment: ${JSON.stringify(lc.experiment)}`);
    if (lc.refactoredSignal) console.log(`   Refactored: ${JSON.stringify(lc.refactoredSignal)}`);
    if (lc.orders.length) console.log(`   Orders: ${JSON.stringify(lc.orders)}`);
    if (lc.trades.length) console.log(`   Trades: ${JSON.stringify(lc.trades)}`);
    if (lc.positions.length) console.log(`   Positions: ${JSON.stringify(lc.positions)}`);
  }

  console.log('\n## Correlation Table (Stage | Expected | DB | Sentry | Status)');
  for (const row of report.correlationTable) {
    console.log(`   ${row.stage} | ${row.expected} | ${row.db} | ${row.sentry} | ${row.status}`);
  }
  if (report.correlationTable.length === 0) {
    console.log('   (no signals to correlate)');
  }

  console.log('\n' + '═'.repeat(70));
  console.log('Definition of Success — Can we answer definitively?');
  console.log('═'.repeat(70));
  console.log(`
   ✓ Does trade engine run?         ${report.workerStability.tradeEngineProcessing ? 'YES' : 'CHECK'}
   ✓ Are workers stable?            ${(report.workerStability.workerErrors as number) === 0 ? 'YES' : 'CHECK'}
   ✓ Is Redis reliable?             ${(report.redisStability.errors as number) === 0 ? 'YES' : 'CHECK'}
   ✓ Are engines executing?        ${(report.engineAExecution.engineASpans as number) > 0 || report.engineBExecution.shadowSimulated ? 'YES' : 'CHECK'}
   ✓ Is strike selection working?   ${report.strikeSuccessRate.fromDb !== 'N/A' ? 'CHECK DB' : 'N/A'}
   ✓ Are trades executed?           ${report.executionSuccessRate.fromDb !== 'N/A' ? 'CHECK DB' : 'N/A'}
   ✓ Are exits working?             ${report.exitLogicValidation.fromDb ? 'CHECK DB' : 'N/A'}
   ✓ Is UI receiving updates?      ${report.websocketValidation.serverStarted ? 'YES' : 'CHECK'}
   ✓ Hidden async crashes?         ${(report.silentErrorsFound.unhandledRejection as number) + (report.silentErrorsFound.uncaughtException as number) === 0 ? 'NONE' : 'FOUND'}
   ✓ Where is latency?             ${report.performanceBottlenecks.slowestStage}
`);
}

function generateMarkdownReport(report: ValidationReport, runId: string, timestamp: string): string {
  const lines: string[] = [
    `# E2E Validation Report — ${runId}`,
    `Generated: ${timestamp}`,
    '',
    '---',
    '',
    '## 1. Boot Health',
    '```json',
    JSON.stringify(report.bootHealth, null, 2),
    '```',
    '',
    '## 2. Worker Stability',
    '```json',
    JSON.stringify(report.workerStability, null, 2),
    '```',
    '',
    '## 3. Redis Stability',
    '```json',
    JSON.stringify(report.redisStability, null, 2),
    '```',
    '',
    '## 4. Market Data Stability',
    '```json',
    JSON.stringify(report.marketDataStability, null, 2),
    '```',
    '',
    '## 5. Engine A Execution',
    '```json',
    JSON.stringify(report.engineAExecution, null, 2),
    '```',
    '',
    '## 6. Engine B Execution',
    '```json',
    JSON.stringify(report.engineBExecution, null, 2),
    '```',
    '',
    '## 7–10. Strike, Execution, Exit, WebSocket',
    '```json',
    JSON.stringify(report.strikeSuccessRate, null, 2),
    '```',
    '',
    '## 11. Silent Errors Found',
    '```json',
    JSON.stringify(report.silentErrorsFound, null, 2),
    '```',
    '',
    '## 12. Performance Bottlenecks',
    '```json',
    JSON.stringify(report.performanceBottlenecks, null, 2),
    '```',
    '',
    '## 13. End-to-End Latency',
    '```json',
    JSON.stringify(report.endToEndLatency, null, 2),
    '```',
    '',
    '## 14. Failure Root Causes',
    '```json',
    JSON.stringify(report.failureRootCauses, null, 2),
    '```',
    '',
    '## 15. Recommended Fixes',
    ...(report.recommendedFixes.length ? report.recommendedFixes.map((f) => `- ${f}`) : ['(none)']),
    '',
    '---',
    '',
    '## Webhook Details',
    '',
  ];
  for (const w of report.webhookDetails ?? []) {
    lines.push(`### ${w.step}`);
    lines.push(`- **Payload:** \`${JSON.stringify(w.payload)}\``);
    lines.push(`- **Response:** HTTP ${w.response.status} | ${w.response.durationMs}ms`);
    lines.push(`- **Data:** \`${JSON.stringify(w.response.data)}\``);
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('## Per-Signal Lifecycle (Detailed)');
  lines.push('');
  for (const lc of report.signalLifecycles ?? []) {
    lines.push(`### Signal ${lc.signalId}`);
    lines.push(`- **Stages completed:** ${lc.stagesCompleted.join(', ') || 'none'}`);
    lines.push(`- **Stages missing:** ${lc.stagesMissing.join(', ') || 'none'}`);
    if (lc.signal) lines.push(`- **Signal:** \`${JSON.stringify(lc.signal)}\``);
    if (lc.experiment) lines.push(`- **Experiment:** \`${JSON.stringify(lc.experiment)}\``);
    if (lc.refactoredSignal) lines.push(`- **Refactored:** \`${JSON.stringify(lc.refactoredSignal)}\``);
    if (lc.recommendations.length) lines.push(`- **Recommendations:** ${lc.recommendations.length}`);
    if (lc.orders.length) lines.push(`- **Orders:** ${JSON.stringify(lc.orders)}`);
    if (lc.trades.length) lines.push(`- **Trades:** ${JSON.stringify(lc.trades)}`);
    if (lc.positions.length) lines.push(`- **Positions:** ${JSON.stringify(lc.positions)}`);
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('## Correlation Table');
  lines.push('');
  lines.push('| Stage | Expected | DB | Sentry | Status |');
  lines.push('|-------|----------|----|--------|--------|');
  for (const row of report.correlationTable) {
    lines.push(`| ${row.stage} | ${row.expected} | ${row.db} | ${row.sentry} | ${row.status} |`);
  }
  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sentryOnly = args.includes('--sentry-only');
  const skipSentry = args.includes('--skip-sentry');
  const skipFailures = args.includes('--skip-failures');
  const skipEngineB = args.includes('--no-engine-b');

  let url = process.env.TARGET_URL || process.env.PRODUCTION_URL || 'http://localhost:8080';
  for (const arg of args) {
    if (arg.startsWith('--url=')) url = arg.slice(6);
  }

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║     E2E + SENTRY TELEMETRY VALIDATION                                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(`\n   Target: ${url}`);
  console.log(`   Sentry: ${skipSentry ? 'Skipped' : getSentryConfig() ? 'Configured' : 'Not configured'}`);
  console.log(`   Mode: ${sentryOnly ? 'Sentry-only' : skipSentry ? 'E2E + DB only' : 'Full E2E + Sentry'}`);

  const ctx: ValidationContext = sentryOnly
    ? {
        runId: `SENTRY_ONLY_${Date.now()}`,
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
        signalIds: [],
        testSessionId: '',
        webhookDetails: [],
      }
    : await runPhase1E2E({ targetUrl: url, skipFailures, skipEngineB });

  const sentryData = await runPhase2And3(ctx, skipSentry);
  const report = await buildReportAsync(ctx, sentryData);
  printReport(report);

  // Write report to files (JSON + Markdown)
  const timestamp = new Date().toISOString();
  const jsonPath = `tmp/e2e-sentry-validation-${ctx.runId}.json`;
  const mdPath = `tmp/e2e-sentry-validation-${ctx.runId}.md`;
  try {
    const fs = await import('fs');
    const path = await import('path');
    const dir = path.dirname(jsonPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({ runId: ctx.runId, timestamp, report }, null, 2)
    );
    fs.writeFileSync(mdPath, generateMarkdownReport(report, ctx.runId, timestamp));
    console.log(`\n   Report saved: ${jsonPath}`);
    console.log(`   Markdown saved: ${mdPath}`);
  } catch {
    // ignore
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
