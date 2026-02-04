import request from 'supertest';
import nock from 'nock';

const testConfig = {
  port: 8080,
  nodeEnv: 'test',
  appMode: 'PAPER',
  databaseUrl: 'postgres://test',
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
  abSplitPercentage: 0,
  enableVariantB: false,
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

jest.mock('../../../src/services/database.service.js', () => ({
  db: { query: jest.fn() },
}));

import { app } from '../../../src/app.js';

describe('Integration: Options engines API', () => {
  beforeAll(() => {
    nock.enableNetConnect();
  });

  test('POST /api/entry-decision returns decision', async () => {
    const response = await request(app)
      .post('/api/entry-decision')
      .send({
        symbol: 'SPY',
        timestamp: 1700000000000,
        direction: 'CALL',
        setupType: 'SWING',
        signal: { confidence: 80, pattern: 'BREAKOUT', timeframe: '15m' },
        marketContext: {
          price: 450,
          regime: 'BULL',
          gexState: 'NEUTRAL',
          volatility: 0.2,
          ivPercentile: 50,
        },
        timingContext: {
          session: 'MORNING',
          minutesFromOpen: 45,
          liquidityState: 'NORMAL',
        },
        riskContext: {
          dailyPnL: 100,
          openTradesCount: 2,
          portfolioDelta: 50,
          portfolioTheta: -20,
        },
      })
      .expect(200);

    expect(response.body.action).toBeDefined();
    expect(response.body.triggeredRules).toBeDefined();
  });

  test('POST /api/entry-decision rejects invalid payload', async () => {
    const response = await request(app).post('/api/entry-decision').send({}).expect(400);
    expect(response.body.success).toBe(false);
  });

  test('POST /api/strike-selection returns selection', async () => {
    const response = await request(app)
      .post('/api/strike-selection')
      .send({
        symbol: 'SPY',
        spotPrice: 450,
        direction: 'CALL',
        setupType: 'SWING',
        signalConfidence: 75,
        expectedHoldTime: 7200,
        expectedMovePercent: 2,
        regime: 'BULL',
        gexState: 'NEUTRAL',
        ivPercentile: 40,
        eventRisk: [],
        riskBudget: { maxPremiumLoss: 500, maxCapitalAllocation: 2000 },
        optionChain: [
          {
            expiry: '2025-06-21',
            dte: 30,
            strike: 450,
            bid: 2.4,
            ask: 2.6,
            mid: 2.5,
            openInterest: 500,
            volume: 200,
            greeks: { delta: 0.32, gamma: 0.01, theta: -0.03, vega: 0.08 },
            iv: 0.2,
          },
        ],
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.tradeContract).toBeDefined();
  });

  test('POST /api/exit-decision returns decision', async () => {
    const response = await request(app)
      .post('/api/exit-decision')
      .send({
        tradePosition: {
          id: 'pos-1',
          symbol: 'SPY',
          direction: 'CALL',
          setupType: 'SWING',
        },
        entryData: {
          timestamp: 1700000000000,
          underlyingEntryPrice: 450,
          optionEntryPrice: 2.5,
          contracts: 2,
        },
        contractDetails: {
          expiry: '2025-06-21',
          dteAtEntry: 30,
          strike: 450,
          greeksAtEntry: { delta: 0.32, gamma: 0.01, theta: -0.03, vega: 0.08 },
          ivAtEntry: 0.2,
        },
        guardrails: {
          maxHoldTime: 20160,
          timeStops: [10080],
          progressChecks: [{ atMinute: 4320, minProfitPercent: 10 }],
          thetaBurnLimit: 30,
          invalidationLevels: { stopLoss: -25, thesisInvalidation: -20 },
        },
        targets: {
          partialTakeProfitPercent: [25, 50],
          fullTakeProfitPercent: 80,
          stopLossPercent: 25,
        },
        liveMarket: {
          timestamp: 1700000000000 + 3600000,
          underlyingPrice: 452,
          optionBid: 2.6,
          optionAsk: 2.8,
          optionMid: 2.7,
          currentGreeks: { delta: 0.3, gamma: 0.009, theta: -0.028, vega: 0.075 },
          currentIV: 0.19,
          currentDTE: 29,
          spreadPercent: 8,
          regime: 'BULL',
          gexState: 'NEUTRAL',
        },
      })
      .expect(200);

    expect(response.body.action).toBeDefined();
    expect(response.body.metrics).toBeDefined();
  });
});
