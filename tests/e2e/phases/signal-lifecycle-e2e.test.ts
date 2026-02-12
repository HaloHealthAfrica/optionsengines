/**
 * E2E Signal Lifecycle Tests
 * Validates: Webhook → Orchestrator → Engines → Orders → Execution → Positions → Exit → WS
 */

import request from 'supertest';
import http from 'http';
import WebSocket from 'ws';
import crypto from 'crypto';
import {
  computeStages,
  fetchLifecycleState,
  formatStageReport,
  waitForStage,
} from '../helpers/lifecycle.js';

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const runE2E = Boolean(databaseUrl);

const testConfig = {
  port: 8080,
  nodeEnv: 'test',
  appMode: 'PAPER',
  databaseUrl: databaseUrl || 'postgres://invalid',
  dbPoolMax: 5,
  jwtSecret: 'test-secret-test-secret-test-secret-test',
  hmacSecret: 'change-this-to-another-secure-random-string-for-webhooks',
  marketDataProvider: 'alpaca',
  marketDataProviderPriority: ['alpaca', 'twelvedata'],
  alpacaApiKey: '',
  alpacaSecretKey: '',
  alpacaPaper: true,
  alpacaBaseUrl: '',
  polygonApiKey: '',
  polygonBaseUrl: '',
  polygonRateLimit: 5,
  polygonWsEnabled: false,
  twelveDataApiKey: '',
  marketDataApiKey: '',
  unusualWhalesApiKey: '',
  unusualWhalesGammaUrl: '',
  slowRequestMs: 2000,
  cacheTtlSeconds: 60,
  alpacaRateLimit: 200,
  twelveDataRateLimit: 800,
  unusualWhalesRateLimitPerMinute: 120,
  unusualWhalesRateLimitPerDay: 15000,
  signalProcessorInterval: 30000,
  orderCreatorInterval: 30000,
  paperExecutorInterval: 10000,
  paperExecutorBatchSize: 10,
  positionRefresherInterval: 60000,
  exitMonitorInterval: 60000,
  orchestratorIntervalMs: 30000,
  orchestratorBatchSize: 20,
  orchestratorConcurrency: 2,
  orchestratorSignalTimeoutMs: 30000,
  orchestratorRetryDelayMs: 60000,
  processingQueueDepthAlert: 20,
  processingQueueDepthDurationSec: 60,
  maxPositionSize: 2,
  maxDailyLoss: 1000,
  maxOpenPositions: 5,
  maxExposurePercent: 20,
  allowPremarket: true,
  allowAfterhours: true,
  marketCloseGraceMinutes: 10,
  signalMaxAgeMinutes: 60,
  maxDailyTrades: 100,
  positionReplacementEnabled: false,
  minConfidenceForReplacement: 70,
  autoCloseNearTarget: false,
  autoCloseNearTargetThresholdPct: 80,
  closeAgedPositions: false,
  closeAgedAfterHours: 2,
  closeAgedBelowPnlPercent: 10,
  profitTargetPct: 50,
  stopLossPct: 50,
  timeStopDte: 1,
  maxHoldDays: 1,
  abSplitPercentage: 100,
  enableVariantB: true,
  enableOrbSpecialist: false,
  enableStratSpecialist: false,
  enableTtmSpecialist: false,
  enableSatylandSubagent: false,
  enableShadowExecution: false,
  enableOrchestrator: true,
  enableDualPaperTrading: false,
  redisUrl: '',
  enableMarketWebhookPipeline: false,
  logLevel: 'info',
};

jest.mock('../../../src/config/index.js', () => ({
  config: testConfig,
  validateConfig: jest.fn(),
}));

jest.mock('../../../src/services/market-data.js', () => ({
  marketData: {
    getMarketHours: jest.fn().mockResolvedValue({
      isMarketOpen: true,
      minutesUntilClose: 120,
      nextOpen: new Date(),
      nextClose: new Date(Date.now() + 3600000),
    }),
    getCandles: jest.fn().mockResolvedValue([
      { timestamp: new Date(), open: 450, high: 451, low: 449, close: 450.5, volume: 1000000 },
    ]),
    getIndicators: jest.fn().mockResolvedValue({
      ema8: [450],
      ema13: [450],
      ema21: [449],
      ema48: [448],
      ema200: [440],
      atr: [1],
      bollingerBands: { upper: [452], middle: [450], lower: [448] },
      keltnerChannels: { upper: [452], middle: [450], lower: [448] },
      ttmSqueeze: { state: 'off', momentum: 0 },
    }),
    getStockPrice: jest.fn().mockResolvedValue(450),
    getOptionPrice: jest.fn().mockResolvedValue(5),
  },
}));

jest.mock('../../../src/services/positioning.service.js', () => ({
  positioningService: {
    getGexSnapshot: jest.fn().mockResolvedValue(null),
    getOptionsFlowSnapshot: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../../../src/services/market-intel/market-intel.service.js', () => ({
  marketIntelService: {
    getMarketIntelContext: jest.fn().mockResolvedValue(null),
  },
}));

describe('E2E Signal Lifecycle', () => {
  let app: typeof import('../../../src/app.js').app;
  let db: typeof import('../../../src/services/database.service.js').db;
  let orchestrator: typeof import('../../../src/orchestrator/container.js').createOrchestratorService;
  let createEngineAInvoker: typeof import('../../../src/orchestrator/engine-invokers.js').createEngineAInvoker;
  let createEngineBInvoker: typeof import('../../../src/orchestrator/engine-invokers.js').createEngineBInvoker;
  let PaperExecutorWorker: typeof import('../../../src/workers/paper-executor.js').PaperExecutorWorker;
  let PositionRefresherWorker: typeof import('../../../src/workers/position-refresher.js').PositionRefresherWorker;
  let ExitMonitorWorker: typeof import('../../../src/workers/exit-monitor.js').ExitMonitorWorker;
  let startRealtimeWebSocketServer: typeof import('../../../src/services/realtime-websocket.service.js').startRealtimeWebSocketServer;
  let stopRealtimeWebSocketServer: typeof import('../../../src/services/realtime-websocket.service.js').stopRealtimeWebSocketServer;

  let server: http.Server | null = null;
  let wsClient: WebSocket | null = null;
  let wsMessages: Array<{ type: string; data: any }> = [];

  const testIt = runE2E ? it : it.skip;

  beforeAll(async () => {
    if (!runE2E) {
      return;
    }
    jest.resetModules();
    ({ app } = await import('../../../src/app.js'));
    ({ db } = await import('../../../src/services/database.service.js'));
    ({ createOrchestratorService: orchestrator } = await import('../../../src/orchestrator/container.js'));
    ({ createEngineAInvoker, createEngineBInvoker } = await import('../../../src/orchestrator/engine-invokers.js'));
    ({ PaperExecutorWorker } = await import('../../../src/workers/paper-executor.js'));
    ({ PositionRefresherWorker } = await import('../../../src/workers/position-refresher.js'));
    ({ ExitMonitorWorker } = await import('../../../src/workers/exit-monitor.js'));
    ({ startRealtimeWebSocketServer, stopRealtimeWebSocketServer } = await import(
      '../../../src/services/realtime-websocket.service.js'
    ));

    await db.connect();

    server = app.listen(0);
    startRealtimeWebSocketServer(server);
    const address = server.address();
    if (address && typeof address !== 'string') {
      wsClient = new WebSocket(`ws://127.0.0.1:${address.port}/v1/realtime?symbol=SPY`);
      wsClient.on('message', (data) => {
        try {
          wsMessages.push(JSON.parse(data.toString()));
        } catch {
          // ignore parse failures
        }
      });
      await new Promise<void>((resolve) => {
        wsClient?.once('open', () => resolve());
      });
    }
  });

  afterAll(async () => {
    if (!runE2E) {
      return;
    }
    wsClient?.close();
    wsClient = null;
    wsMessages = [];
    stopRealtimeWebSocketServer();
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    }
    await db.close();
  });

  beforeEach(async () => {
    if (!runE2E) {
      return;
    }
    wsMessages = [];
    await db.query('DELETE FROM trades');
    await db.query('DELETE FROM orders');
    await db.query('DELETE FROM refactored_positions');
    await db.query('DELETE FROM shadow_positions');
    await db.query('DELETE FROM shadow_trades');
    await db.query('DELETE FROM decision_recommendations');
    await db.query('DELETE FROM execution_policies');
    await db.query('DELETE FROM experiments');
    await db.query('DELETE FROM market_contexts');
    await db.query('DELETE FROM signals');
    await db.query('DELETE FROM webhook_events');
    await db.query('DELETE FROM exit_rules');
    await db.query(
      `INSERT INTO exit_rules (rule_name, profit_target_percent, stop_loss_percent, max_hold_time_hours, min_dte_exit, enabled)
       VALUES ('test-exit', 999, 999, 0, 0, true)`
    );
  });

  function buildPayload(overrides: Record<string, any> = {}) {
    return {
      symbol: 'SPY',
      direction: 'long',
      timeframe: '5m',
      timestamp: new Date().toISOString(),
      ...overrides,
    };
  }

  async function forceExperimentVariant(signalId: string, variant: 'A' | 'B') {
    const signalRow = await db.query(
      `SELECT signal_hash FROM signals WHERE signal_id = $1`,
      [signalId]
    );
    const signalHash = signalRow.rows[0]?.signal_hash;
    const assignmentHash = crypto
      .createHash('sha256')
      .update(`${signalId}:${signalHash}`)
      .digest('hex');
    await db.query(
      `INSERT INTO experiments (signal_id, variant, assignment_hash, split_percentage, policy_version)
       VALUES ($1, $2, $3, $4, $5)`,
      [signalId, variant, assignmentHash, 0.5, 'v1.0']
    );
  }

  testIt('Happy path: full trade lifecycle through exit + WS', async () => {
    const response = await request(app).post('/webhook').send(buildPayload());
    expect(response.status).toBe(200);
    const signalId = response.body.signal_id as string;

    await forceExperimentVariant(signalId, 'A');

    const orchestratorService = orchestrator({
      engineA: createEngineAInvoker(),
      engineB: createEngineBInvoker(),
    });
    await orchestratorService.processSignals(1, [signalId]);
    await waitForStage(signalId, 'ORDER_CREATED');

    const paperExecutor = new PaperExecutorWorker();
    await paperExecutor.run();
    await waitForStage(signalId, 'ORDER_FILLED');

    const positionRefresher = new PositionRefresherWorker();
    await positionRefresher.run();
    await waitForStage(signalId, 'POSITION_CREATED');

    const exitMonitor = new ExitMonitorWorker();
    await exitMonitor.run();
    await waitForStage(signalId, 'EXIT_CREATED');

    await paperExecutor.run();
    await waitForStage(signalId, 'EXIT_FILLED');

    const lifecycle = await fetchLifecycleState(signalId);
    const stages = computeStages(lifecycle);
    console.log(formatStageReport(signalId, stages));

    expect(lifecycle.orders.length).toBeGreaterThan(0);
    expect(lifecycle.trades.length).toBeGreaterThan(0);
    expect(lifecycle.positions.some((p) => p.status === 'closed')).toBe(true);
    expect(wsMessages.some((msg) => msg.type === 'position_update')).toBe(true);
  });

  testIt('Engine B path with shadow execution (shadow-only)', async () => {
    const previousMode = testConfig.appMode;
    const previousShadow = testConfig.enableShadowExecution;
    testConfig.appMode = 'LIVE';
    testConfig.enableShadowExecution = true;

    const response = await request(app).post('/webhook').send(buildPayload());
    expect(response.status).toBe(200);
    const signalId = response.body.signal_id as string;

    await forceExperimentVariant(signalId, 'B');

    const orchestratorService = orchestrator({
      engineA: createEngineAInvoker(),
      engineB: createEngineBInvoker(),
    });
    await orchestratorService.processSignals(1, [signalId]);

    await waitForStage(signalId, 'SHADOW_EXECUTED');
    const lifecycle = await fetchLifecycleState(signalId);

    expect(lifecycle.shadowTrades.length).toBeGreaterThan(0);
    expect(lifecycle.orders.length).toBe(0);

    testConfig.appMode = previousMode;
    testConfig.enableShadowExecution = previousShadow;
  });

  testIt('Rejection path: risk rejects, no orders created', async () => {
    const previousMaxOpen = testConfig.maxOpenPositions;
    testConfig.maxOpenPositions = 0;

    const response = await request(app).post('/webhook').send(buildPayload());
    expect(response.status).toBe(200);
    const signalId = response.body.signal_id as string;

    await forceExperimentVariant(signalId, 'A');

    const orchestratorService = orchestrator({
      engineA: createEngineAInvoker(),
      engineB: createEngineBInvoker(),
    });
    await orchestratorService.processSignals(1, [signalId]);

    const lifecycle = await fetchLifecycleState(signalId);
    const stages = computeStages(lifecycle);
    console.log(formatStageReport(signalId, stages));

    expect(lifecycle.orders.length).toBe(0);
    expect(lifecycle.positions.length).toBe(0);

    testConfig.maxOpenPositions = previousMaxOpen;
  });

  testIt('Strike selection failure path: no order created', async () => {
    const { marketData } = await import('../../../src/services/market-data.js');
    const original = marketData.getStockPrice;
    marketData.getStockPrice = jest.fn().mockRejectedValue(new Error('strike_selection_failed'));

    const response = await request(app).post('/webhook').send(buildPayload());
    expect(response.status).toBe(200);
    const signalId = response.body.signal_id as string;

    await forceExperimentVariant(signalId, 'A');

    const orchestratorService = orchestrator({
      engineA: createEngineAInvoker(),
      engineB: createEngineBInvoker(),
    });
    await orchestratorService.processSignals(1, [signalId]);

    const lifecycle = await fetchLifecycleState(signalId);
    expect(lifecycle.orders.length).toBe(0);

    marketData.getStockPrice = original;
  });

  testIt('Execution failure path: order marked failed, no position', async () => {
    const { marketData } = await import('../../../src/services/market-data.js');
    const original = marketData.getOptionPrice;
    marketData.getOptionPrice = jest.fn().mockRejectedValue(new Error('execution_failed'));

    const response = await request(app).post('/webhook').send(buildPayload());
    expect(response.status).toBe(200);
    const signalId = response.body.signal_id as string;

    await forceExperimentVariant(signalId, 'A');

    const orchestratorService = orchestrator({
      engineA: createEngineAInvoker(),
      engineB: createEngineBInvoker(),
    });
    await orchestratorService.processSignals(1, [signalId]);

    const paperExecutor = new PaperExecutorWorker();
    await paperExecutor.run();

    const lifecycle = await fetchLifecycleState(signalId);
    expect(lifecycle.orders.length).toBeGreaterThan(0);
    expect(lifecycle.orders.some((order) => order.status === 'failed')).toBe(true);
    expect(lifecycle.positions.length).toBe(0);

    marketData.getOptionPrice = original;
  });
});
