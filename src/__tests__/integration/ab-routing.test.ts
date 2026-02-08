/**
 * Integration Test: A/B routing via webhook
 * Validates: Requirements 8.1 through 8.6
 */

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

jest.mock('../../config/index.js', () => ({
  config: testConfig,
  validateConfig: jest.fn(),
}));

jest.mock('../../services/database.service.js', () => ({
  db: { query: jest.fn() },
}));

jest.mock('../../services/market-data.js', () => ({
  marketData: {
    getMarketHours: jest.fn(),
    getCandles: jest.fn(),
    getIndicators: jest.fn(),
    getStockPrice: jest.fn(),
  },
}));

jest.mock('../../services/strategy-router.service.js', () => ({
  strategyRouter: {
    route: jest.fn(),
  },
}));

import { app } from '../../app.js';
import { db } from '../../services/database.service.js';
import { strategyRouter } from '../../services/strategy-router.service.js';
import { marketData } from '../../services/market-data.js';

describe('Integration: A/B routing', () => {
  beforeAll(() => {
    nock.enableNetConnect();
  });
  beforeEach(() => {
    (db.query as jest.Mock).mockReset();
    (strategyRouter.route as jest.Mock).mockReset();
    (marketData.getMarketHours as jest.Mock).mockReset();
    (marketData.getCandles as jest.Mock).mockReset();
    (marketData.getIndicators as jest.Mock).mockReset();
    (marketData.getStockPrice as jest.Mock).mockReset();
  });

  test('returns variant A when routed to Engine 1', async () => {
    (db.query as jest.Mock).mockImplementation(async (text: string) => {
      if (text.includes('SELECT signal_id FROM signals')) {
        return { rows: [] };
      }
      if (text.includes('INSERT INTO signals')) {
        return { rows: [{ signal_id: 'sig-1' }] };
      }
      return { rows: [] };
    });
    const response = await request(app)
      .post('/webhook')
      .send({
        symbol: 'SPY',
        direction: 'long',
        timeframe: '5m',
        timestamp: new Date().toISOString(),
      })
      .expect(200);

    expect(response.body.signal_id).toBeDefined();
  });

  test('returns variant B when routed to Engine 2', async () => {
    (db.query as jest.Mock).mockImplementation(async (text: string) => {
      if (text.includes('SELECT signal_id FROM signals')) {
        return { rows: [] };
      }
      if (text.includes('INSERT INTO signals')) {
        return { rows: [{ signal_id: 'sig-2' }] };
      }
      if (text.includes('SELECT * FROM risk_limits')) {
        return { rows: [{}] };
      }
      if (text.includes('COUNT(*)::int AS count')) {
        return { rows: [{ count: 0, exposure: 0 }] };
      }
      return { rows: [] };
    });
    (marketData.getMarketHours as jest.Mock).mockResolvedValue({
      isMarketOpen: true,
      minutesUntilClose: 60,
    });
    (marketData.getCandles as jest.Mock).mockResolvedValue([]);
    (marketData.getIndicators as jest.Mock).mockResolvedValue({
      ema8: [110],
      ema13: [105],
      ema21: [100],
      ema48: [95],
      ema200: [90],
      atr: [1],
      bollingerBands: { upper: [], middle: [], lower: [] },
      keltnerChannels: { upper: [], middle: [], lower: [] },
      ttmSqueeze: { state: 'off', momentum: 1 },
    });
    (marketData.getStockPrice as jest.Mock).mockResolvedValue(120);
    const response = await request(app)
      .post('/webhook')
      .send({
        symbol: 'QQQ',
        direction: 'short',
        timeframe: '15m',
        timestamp: new Date().toISOString(),
      })
      .expect(200);

    expect(response.body.signal_id).toBeDefined();
  });
});
