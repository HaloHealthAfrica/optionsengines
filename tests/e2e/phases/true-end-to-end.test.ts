/**
 * True End-to-End Test: Webhook → Routing → Engine Decision → Audit Log
 *
 * Validates that a real webhook request flows through routing,
 * Engine B decisioning, and persists audit logs to the database.
 */

import request from 'supertest';

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
  alpacaApiKey: '',
  alpacaSecretKey: '',
  alpacaPaper: true,
  alpacaBaseUrl: '',
  polygonApiKey: '',
  twelveDataApiKey: '',
  marketDataApiKey: '',
  slowRequestMs: 2000,
  cacheTtlSeconds: 60,
  alpacaRateLimit: 200,
  twelveDataRateLimit: 800,
  signalProcessorInterval: 30000,
  orderCreatorInterval: 30000,
  paperExecutorInterval: 10000,
  positionRefresherInterval: 60000,
  exitMonitorInterval: 60000,
  maxPositionSize: 10,
  maxDailyLoss: 1000,
  maxOpenPositions: 5,
  maxExposurePercent: 20,
  profitTargetPct: 50,
  stopLossPct: 50,
  timeStopDte: 1,
  maxHoldDays: 5,
  abSplitPercentage: 100,
  enableVariantB: true,
  enableOrbSpecialist: false,
  enableStratSpecialist: false,
  enableTtmSpecialist: false,
  enableSatylandSubagent: false,
  enableShadowExecution: false,
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
      rsi: [50],
      macd: [0],
      macdSignal: [0],
      macdHistogram: [0],
      vwma: [450],
      volumeProfile: { poc: 450, vah: 452, val: 448 },
    }),
    getStockPrice: jest.fn().mockResolvedValue(450),
  },
}));

jest.mock('../../../src/services/positioning.service.js', () => ({
  positioningService: {
    getGexSnapshot: jest.fn().mockResolvedValue(null),
    getOptionsFlowSnapshot: jest.fn().mockResolvedValue(null),
  },
}));

describe('True E2E: webhook → routing → decision → audit log', () => {
  let app: typeof import('../../../src/app.js').app;
  let db: typeof import('../../../src/services/database.service.js').db;
  let featureFlags: typeof import('../../../src/services/feature-flag.service.js').featureFlags;

  beforeAll(async () => {
    if (!runE2E) {
      return;
    }
    jest.resetModules();
    ({ app } = await import('../../../src/app.js'));
    ({ db } = await import('../../../src/services/database.service.js'));
    ({ featureFlags } = await import('../../../src/services/feature-flag.service.js'));

    await db.connect();

    await db.query(`UPDATE feature_flags SET enabled = true WHERE name = 'enable_variant_b'`);
    await db.query(`UPDATE feature_flags SET enabled = false WHERE name = 'enable_shadow_execution'`);
    await featureFlags.refreshCache();
  });

  afterAll(async () => {
    if (!runE2E) {
      return;
    }
    featureFlags.stop();
    await db.close();
  });

  beforeEach(async () => {
    if (!runE2E) {
      return;
    }
    await db.query('DELETE FROM agent_decisions');
    await db.query('DELETE FROM experiments');
    await db.query('DELETE FROM signals');
  });

  const testIt = runE2E ? it : it.skip;

  testIt('persists agent decisions for a routed webhook', async () => {
    if (!runE2E) {
      return;
    }
    const payload = {
      symbol: 'SPY',
      timeframe: '5m',
      direction: 'long',
      timestamp: new Date().toISOString(),
    };

    const response = await request(app).post('/webhook').send(payload);
    expect(response.status).toBe(201);
    expect(response.body.variant).toBe('B');

    const signalId = response.body.signal_id;
    const experimentId = response.body.experiment_id;

    const signalResult = await db.query('SELECT signal_id FROM signals WHERE signal_id = $1', [signalId]);
    expect(signalResult.rows.length).toBe(1);

    const experimentResult = await db.query(
      'SELECT experiment_id, variant FROM experiments WHERE experiment_id = $1',
      [experimentId]
    );
    expect(experimentResult.rows.length).toBe(1);
    expect(experimentResult.rows[0].variant).toBe('B');

    const decisionsResult = await db.query(
      `SELECT agent_name FROM agent_decisions WHERE signal_id = $1 ORDER BY created_at ASC`,
      [signalId]
    );
    expect(decisionsResult.rows.length).toBeGreaterThan(0);
    expect(decisionsResult.rows.map((row) => row.agent_name)).toContain('meta_decision');
  });
});
