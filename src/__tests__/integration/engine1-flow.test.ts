/**
 * Integration Test: Webhook → Signal → Order → Trade → Position → Exit
 * Validates: Requirements 1.1 through 7.7 (Engine 1 flow)
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

jest.mock('../../config/index.js', () => ({
  config: testConfig,
  validateConfig: jest.fn(),
}));

jest.mock('../../services/database.service.js', () => ({
  db: { query: jest.fn() },
}));

jest.mock('../../services/market-data.js', () => ({
  marketData: {
    isMarketOpen: jest.fn(),
    getCandles: jest.fn(),
    getIndicators: jest.fn(),
    getStockPrice: jest.fn(),
    getOptionPrice: jest.fn(),
    getMarketHours: jest.fn(),
  },
}));

jest.mock('../../services/strategy-router.service.js', () => ({
  strategyRouter: {
    route: jest.fn(),
  },
}));

jest.mock('../../services/feature-flag.service.js', () => ({
  featureFlags: { isEnabled: jest.fn() },
}));

import { app } from '../../app.js';
import { db } from '../../services/database.service.js';
import { marketData } from '../../services/market-data.js';
import { strategyRouter } from '../../services/strategy-router.service.js';
import { SignalProcessorWorker } from '../../workers/signal-processor.js';
import { OrderCreatorWorker } from '../../workers/order-creator.js';
import { PaperExecutorWorker } from '../../workers/paper-executor.js';
import { PositionRefresherWorker } from '../../workers/position-refresher.js';
import { ExitMonitorWorker } from '../../workers/exit-monitor.js';

type Store = {
  signals: any[];
  orders: any[];
  positions: any[];
  trades: any[];
};

function createStore(): Store {
  return { signals: [], orders: [], positions: [], trades: [] };
}

function setupDbMock(store: Store) {
  let signalId = 1;
  let orderId = 1;
  let positionId = 1;
  let tradeId = 1;

  (db.query as jest.Mock).mockImplementation(async (text: string, params?: any[]) => {
    if (text.includes('INSERT INTO signals')) {
      const row = {
        signal_id: `signal-${signalId++}`,
        symbol: params?.[0],
        direction: params?.[1],
        timeframe: params?.[2],
        timestamp: params?.[3],
        status: params?.[4],
        created_at: new Date(),
      };
      store.signals.push(row);
      return { rows: [{ signal_id: row.signal_id }] };
    }

    if (text.includes('SELECT * FROM signals WHERE status')) {
      const status = params?.[0];
      return { rows: store.signals.filter((s) => s.status === status) };
    }

    if (text.includes('UPDATE signals SET status')) {
      const status = params?.[0];
      const id = params?.[1];
      store.signals = store.signals.map((s) => (s.signal_id === id ? { ...s, status } : s));
      return { rows: [] };
    }

    if (text.includes('INSERT INTO refactored_signals')) {
      return { rows: [] };
    }

    if (text.includes('SELECT * FROM risk_limits')) {
      return { rows: [{ max_positions_per_symbol: 3, max_total_exposure: 10000 }] };
    }

    if (text.includes('COUNT(*)::int AS count, COALESCE')) {
      const exposure = store.positions
        .filter((p) => p.status === 'open' || p.status === 'closing')
        .reduce((sum, p) => sum + p.entry_price * p.quantity * 100, 0);
      return { rows: [{ count: store.positions.length, exposure }] };
    }

    if (text.includes('COUNT(*)::int AS count')) {
      return { rows: [{ count: store.positions.length }] };
    }

    if (text.includes('FROM signals s') && text.includes('LEFT JOIN orders')) {
      const status = params?.[0];
      const approved = store.signals.filter((s) => s.status === status);
      const withoutOrder = approved.filter(
        (s) => !store.orders.some((o) => o.signal_id === s.signal_id)
      );
      return { rows: withoutOrder };
    }

    if (text.includes('INSERT INTO orders')) {
      const row = {
        order_id: `order-${orderId++}`,
        signal_id: params?.[0],
        symbol: params?.[1],
        option_symbol: params?.[2],
        strike: params?.[3],
        expiration: params?.[4],
        type: params?.[5],
        quantity: params?.[6],
        order_type: params?.[7],
        status: params?.[8],
        created_at: new Date(),
      };
      store.orders.push(row);
      return { rows: [{ order_id: row.order_id }] };
    }

    if (text.includes('SELECT * FROM orders WHERE status')) {
      const status = params?.[0];
      const orderType = params?.[1];
      return {
        rows: store.orders.filter((o) => o.status === status && o.order_type === orderType),
      };
    }

    if (text.includes('UPDATE orders SET status')) {
      const status = params?.[0];
      const id = params?.[1];
      store.orders = store.orders.map((o) => (o.order_id === id ? { ...o, status } : o));
      return { rows: [] };
    }

    if (text.includes('INSERT INTO trades')) {
      const row = {
        trade_id: `trade-${tradeId++}`,
        order_id: params?.[0],
        fill_price: params?.[1],
        fill_quantity: params?.[2],
        fill_timestamp: params?.[3],
        commission: params?.[4],
      };
      store.trades.push(row);
      return { rows: [{ trade_id: row.trade_id }] };
    }

    if (text.includes('SELECT * FROM refactored_positions') && text.includes('option_symbol')) {
      const symbol = params?.[0];
      const rows = store.positions.filter(
        (p) => p.option_symbol === symbol && (p.status === 'open' || p.status === 'closing')
      );
      return { rows };
    }

    if (text.includes('INSERT INTO refactored_positions')) {
      const row = {
        position_id: `position-${positionId++}`,
        symbol: params?.[0],
        option_symbol: params?.[1],
        strike: params?.[2],
        expiration: params?.[3],
        type: params?.[4],
        quantity: params?.[5],
        entry_price: params?.[6],
        status: params?.[7],
        entry_timestamp: params?.[8],
        last_updated: params?.[8],
        exit_reason: null,
      };
      store.positions.push(row);
      return { rows: [{ position_id: row.position_id }] };
    }

    if (text.includes('SELECT * FROM refactored_positions WHERE status')) {
      const status = params?.[0];
      return { rows: store.positions.filter((p) => p.status === status) };
    }

    if (text.includes('UPDATE refactored_positions') && text.includes('position_pnl_percent')) {
      const currentPrice = params?.[0];
      const unrealizedPnl = params?.[1];
      const pnlPercent = params?.[2];
      const positionIdParam = params?.[4];
      store.positions = store.positions.map((p) =>
        p.position_id === positionIdParam
          ? { ...p, current_price: currentPrice, unrealized_pnl: unrealizedPnl, position_pnl_percent: pnlPercent }
          : p
      );
      return { rows: [] };
    }

    if (text.includes('SELECT * FROM exit_rules')) {
      return {
        rows: [
          {
            profit_target_percent: 50,
            stop_loss_percent: 50,
            max_hold_time_hours: 120,
            min_dte_exit: 1,
          },
        ],
      };
    }

    if (text.includes('UPDATE refactored_positions') && text.includes('exit_reason')) {
      const status = params?.[0];
      const exitReason = params?.[1];
      const positionIdParam = params?.[3];
      store.positions = store.positions.map((p) =>
        p.position_id === positionIdParam ? { ...p, status, exit_reason: exitReason } : p
      );
      return { rows: [] };
    }

    if (text.includes('UPDATE refactored_positions') && text.includes('realized_pnl')) {
      const status = params?.[0];
      const realizedPnl = params?.[2];
      const positionIdParam = params?.[3];
      store.positions = store.positions.map((p) =>
        p.position_id === positionIdParam ? { ...p, status, realized_pnl: realizedPnl } : p
      );
      return { rows: [] };
    }

    return { rows: [] };
  });
}

describe('Integration: Engine 1 flow', () => {
  beforeAll(() => {
    nock.enableNetConnect();
  });
  beforeEach(() => {
    (db.query as jest.Mock).mockReset();
    (marketData.isMarketOpen as jest.Mock).mockResolvedValue(true);
    (marketData.getMarketHours as jest.Mock).mockResolvedValue({ isMarketOpen: true });
    (marketData.getCandles as jest.Mock).mockResolvedValue([]);
    (marketData.getIndicators as jest.Mock).mockResolvedValue({
      ema8: [],
      ema13: [],
      ema21: [],
      ema48: [],
      ema200: [],
      atr: [],
      bollingerBands: { upper: [], middle: [], lower: [] },
      keltnerChannels: { upper: [], middle: [], lower: [] },
      ttmSqueeze: { state: 'off', momentum: 0 },
    });
    (marketData.getStockPrice as jest.Mock).mockResolvedValue(100);
    let optionCalls = 0;
    (marketData.getOptionPrice as jest.Mock).mockImplementation(async () => {
      optionCalls += 1;
      return optionCalls <= 2 ? 2 : 4;
    });
    (strategyRouter.route as jest.Mock).mockResolvedValue({
      experimentId: 'exp-1',
      variant: 'A',
      assignmentHash: 'hash',
      splitPercentage: 0,
      assignmentReason: 'variant_b_disabled',
    });
  });

  test('processes a full paper trade lifecycle', async () => {
    const store = createStore();
    setupDbMock(store);

    const webhookResponse = await request(app)
      .post('/webhook')
      .send({
        symbol: 'SPY',
        direction: 'long',
        timeframe: '5m',
        timestamp: new Date().toISOString(),
      })
      .expect(201);

    expect(webhookResponse.body.signal_id).toBeDefined();
    expect(webhookResponse.body.variant).toBe('A');

    const signalProcessor = new SignalProcessorWorker();
    const orderCreator = new OrderCreatorWorker();
    const paperExecutor = new PaperExecutorWorker();
    const positionRefresher = new PositionRefresherWorker();
    const exitMonitor = new ExitMonitorWorker();

    await signalProcessor.run();
    await orderCreator.run();
    await paperExecutor.run();
    await positionRefresher.run();
    await exitMonitor.run();
    await paperExecutor.run();

    expect(store.signals[0].status).toBe('approved');
    expect(store.orders.length).toBeGreaterThanOrEqual(2);
    expect(store.positions.length).toBe(1);
    expect(store.positions[0].status).toBe('closed');
  });
});
