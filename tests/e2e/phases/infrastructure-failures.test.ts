/**
 * E2E Infrastructure Failure Tests
 * Validates Redis disconnect handling and DB transaction rollback.
 */

import crypto from 'crypto';
import { redisCache } from '../../../src/services/redis-cache.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const runE2E = Boolean(databaseUrl);

jest.mock('../../../src/config/index.js', () => {
  const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  const cfg = {
    port: 8080,
    nodeEnv: 'test',
    appMode: 'PAPER',
    databaseUrl: dbUrl || 'postgres://invalid',
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
  (globalThis as typeof globalThis & { __e2e_test_config?: typeof cfg }).__e2e_test_config = cfg;
  return {
    get config() {
      return (globalThis as typeof globalThis & { __e2e_test_config?: typeof cfg }).__e2e_test_config!;
    },
    validateConfig: jest.fn(),
  };
});

describe('E2E Infrastructure Failures', () => {
  const testIt = runE2E ? it : it.skip;
  let db: typeof import('../../../src/services/database.service.js').db;

  beforeAll(async () => {
    if (!runE2E) {
      return;
    }
    jest.resetModules();
    ({ db } = await import('../../../src/services/database.service.js'));
    await db.connect();
  });

  afterAll(async () => {
    if (!runE2E) {
      return;
    }
    await db.close();
  });

  testIt('Redis down: connect fails gracefully', async () => {
    await redisCache.connect('redis://127.0.0.1:1');
    expect(redisCache.isAvailable()).toBe(false);
  });

  testIt('DB transaction rollback leaves no partial state', async () => {
    const signalId = crypto.randomUUID();
    await expect(
      db.transaction(async (client) => {
        await client.query(
          `INSERT INTO signals (signal_id, symbol, direction, timeframe, timestamp, status)
           VALUES ($1, 'SPY', 'long', '5m', NOW(), 'pending')`,
          [signalId]
        );
        throw new Error('forced_failure');
      })
    ).rejects.toThrow('forced_failure');

    const result = await db.query(
      `SELECT signal_id FROM signals WHERE signal_id = $1`,
      [signalId]
    );
    expect(result.rows.length).toBe(0);
  });
});
